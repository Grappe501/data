import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import {
  ContactIntelUploadError,
  hashContactIntelBuffer,
  hashContactIntelRow,
  parseContactIntelUpload,
} from "@/lib/contact-intel/parse";
import { oscarHasIdentity, proposeOscarMapping } from "@/lib/contact-intel/oscar";
import { writeContactIntelJobProgress } from "@/lib/contact-intel/progress";
import { applyContactIntelMappingAndPreview } from "@/lib/contact-intel/pipeline";

export async function createContactIntelImportJob(input: {
  filename: string;
  buffer: Buffer;
  sourceLabel?: string | null;
  createdByUserId?: string | null;
}) {
  const parsed = parseContactIntelUpload(input.filename, input.buffer);
  if (parsed.headers.length === 0) {
    throw new ContactIntelUploadError("headers", "No header row found.");
  }
  if (parsed.rows.length === 0) {
    throw new ContactIntelUploadError("rows", "No data rows found.");
  }

  const fileHash = hashContactIntelBuffer(input.buffer);
  const existingCustomFields = await prisma.contactIntelCustomFieldDefinition.findMany({
    where: { active: true },
    select: { key: true, label: true },
  });
  const oscar = await proposeOscarMapping({
    filename: input.filename,
    sourceLabel: input.sourceLabel,
    headers: parsed.headers,
    sampleRows: parsed.rows.slice(0, 8),
    existingCustomFields,
  });
  const mapping = oscar.mapping;

  const job = await prisma.contactIntelImportJob.create({
    data: {
      originalFilename: input.filename.slice(0, 500),
      fileHash,
      sourceLabel: input.sourceLabel?.trim() || null,
      createdByUserId: input.createdByUserId ?? null,
      mappingJson: mapping as unknown as Prisma.InputJsonValue,
      headerJson: parsed.headers as unknown as Prisma.InputJsonValue,
      statsJson: { uploadedRows: parsed.rows.length },
      previewJson: { oscar: oscar.report } as unknown as Prisma.InputJsonValue,
    },
  });

  const startedAt = new Date().toISOString();
  const chunkSize = 400;
  await writeContactIntelJobProgress(job.id, {
    phase: "upload",
    done: 0,
    total: parsed.rows.length,
    startedAt,
    message: "Saving uploaded rows…",
  });
  for (let i = 0; i < parsed.rows.length; i += chunkSize) {
    const slice = parsed.rows.slice(i, i + chunkSize);
    await prisma.contactIntelSourceRow.createMany({
      data: slice.map((raw, offset) => ({
        jobId: job.id,
        rowNumber: i + offset + 1,
        rawJson: raw as unknown as Prisma.InputJsonValue,
        rowHash: hashContactIntelRow(raw),
      })),
    });
    await writeContactIntelJobProgress(job.id, {
      phase: "upload",
      done: Math.min(i + chunkSize, parsed.rows.length),
      total: parsed.rows.length,
      startedAt,
      message: "Saving uploaded rows…",
    });
  }

  if (oscar.report.autoApply && !oscar.report.needsReview && oscarHasIdentity(mapping)) {
    try {
      await applyContactIntelMappingAndPreview(job.id, mapping);
    } catch {
      /* leave the job uploaded so the operator can assign columns */
    }
  }

  return job.id;
}
