import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { hashContactIntelBuffer, hashContactIntelRow, parseContactIntelUpload } from "@/lib/contact-intel/parse";
import { guessContactIntelMapping } from "@/lib/contact-intel/mapping";

export async function createContactIntelImportJob(input: {
  filename: string;
  buffer: Buffer;
  sourceLabel?: string | null;
  createdByUserId?: string | null;
}) {
  const parsed = parseContactIntelUpload(input.filename, input.buffer);
  if (parsed.headers.length === 0) throw new Error("No header row found.");
  if (parsed.rows.length === 0) throw new Error("No data rows found.");

  const fileHash = hashContactIntelBuffer(input.buffer);
  const mapping = guessContactIntelMapping(parsed.headers);

  const job = await prisma.contactIntelImportJob.create({
    data: {
      originalFilename: input.filename.slice(0, 500),
      fileHash,
      sourceLabel: input.sourceLabel?.trim() || null,
      createdByUserId: input.createdByUserId ?? null,
      mappingJson: mapping as unknown as Prisma.InputJsonValue,
      headerJson: parsed.headers as unknown as Prisma.InputJsonValue,
      statsJson: { uploadedRows: parsed.rows.length },
    },
  });

  const chunkSize = 400;
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
  }

  return job.id;
}
