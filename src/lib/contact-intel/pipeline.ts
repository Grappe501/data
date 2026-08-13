import type { ContactIntelSourceRowStatus, Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import {
  extractContactIntelRow,
  isValidContactIntelExtract,
  splitFullName,
  type ContactIntelMapping,
  type ExtractedMethod,
} from "@/lib/contact-intel/mapping";

type MethodIndex = Map<string, string>;

function methodKey(kind: "EMAIL" | "PHONE", normalized: string): string {
  return `${kind}:${normalized}`;
}

async function loadMethodIndex(): Promise<MethodIndex> {
  const methods = await prisma.contactIntelMethod.findMany({
    select: { kind: true, normalizedValue: true, personId: true },
  });
  const index: MethodIndex = new Map();
  for (const m of methods) {
    index.set(methodKey(m.kind, m.normalizedValue), m.personId);
  }
  return index;
}

function personIdsForExtract(extract: { emails: ExtractedMethod[]; phones: ExtractedMethod[] }, index: MethodIndex): string[] {
  const ids = new Set<string>();
  for (const e of extract.emails) {
    const id = index.get(methodKey("EMAIL", e.normalized));
    if (id) ids.add(id);
  }
  for (const p of extract.phones) {
    const id = index.get(methodKey("PHONE", p.normalized));
    if (id) ids.add(id);
  }
  return [...ids];
}

function buildDisplayName(extract: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  emails: ExtractedMethod[];
  phones: ExtractedMethod[];
}): string {
  if (extract.displayName?.trim()) return extract.displayName.trim();
  const composed = [extract.firstName, extract.lastName].filter(Boolean).join(" ").trim();
  if (composed) return composed;
  if (extract.emails[0]?.normalized) return extract.emails[0].normalized;
  if (extract.phones[0]?.original) return extract.phones[0].original;
  return "Unknown";
}

export type ContactIntelPreviewStats = {
  total: number;
  invalid: number;
  newCount: number;
  updateCount: number;
  conflictCount: number;
  skippedCount: number;
};

export async function applyContactIntelMappingAndPreview(jobId: string, mapping: ContactIntelMapping) {
  const job = await prisma.contactIntelImportJob.findUnique({
    where: { id: jobId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!job) throw new Error("Import job not found.");
  if (job.status === "COMMITTED") throw new Error("This import is already committed.");

  const index = await loadMethodIndex();
  const stats: ContactIntelPreviewStats = {
    total: job.rows.length,
    invalid: 0,
    newCount: 0,
    updateCount: 0,
    conflictCount: 0,
    skippedCount: 0,
  };

  for (const row of job.rows) {
    const raw = (row.rawJson ?? {}) as Record<string, string>;
    const extract = extractContactIntelRow(raw, mapping);
    const namesFromFull = splitFullName(extract.displayName);
    const firstName = extract.firstName || namesFromFull.firstName;
    const lastName = extract.lastName || namesFromFull.lastName;
    const displayName = buildDisplayName({ ...extract, firstName, lastName });

    let status: ContactIntelSourceRowStatus = "PENDING";
    const messages: string[] = [];
    let matchedPersonId: string | null = null;

    if (!isValidContactIntelExtract(extract)) {
      status = "INVALID";
      messages.push("Row needs a valid email address or phone number.");
      stats.invalid += 1;
    } else {
      const personIds = personIdsForExtract(extract, index);
      if (personIds.length === 0) {
        status = "NEW";
        stats.newCount += 1;
        const provisionalId = `pending:${row.id}`;
        for (const e of extract.emails) index.set(methodKey("EMAIL", e.normalized), provisionalId);
        for (const p of extract.phones) index.set(methodKey("PHONE", p.normalized), provisionalId);
      } else if (personIds.length === 1) {
        const only = personIds[0]!;
        status = "UPDATE";
        if (only.startsWith("pending:")) {
          messages.push("Matches another row in this file.");
        } else {
          matchedPersonId = only;
        }
        stats.updateCount += 1;
        for (const e of extract.emails) {
          if (!index.has(methodKey("EMAIL", e.normalized))) index.set(methodKey("EMAIL", e.normalized), only);
        }
        for (const p of extract.phones) {
          if (!index.has(methodKey("PHONE", p.normalized))) index.set(methodKey("PHONE", p.normalized), only);
        }
      } else {
        status = "CONFLICT";
        messages.push("Email and phone match different people.");
        stats.conflictCount += 1;
      }
    }

    await prisma.contactIntelSourceRow.update({
      where: { id: row.id },
      data: {
        status,
        displayName,
        firstName,
        lastName,
        emailsJson: extract.emails as unknown as Prisma.InputJsonValue,
        phonesJson: extract.phones as unknown as Prisma.InputJsonValue,
        personId: matchedPersonId,
        messagesJson: messages as unknown as Prisma.InputJsonValue,
      },
    });
  }

  await prisma.contactIntelImportJob.update({
    where: { id: jobId },
    data: {
      status: "PREVIEWED",
      mappingJson: mapping as unknown as Prisma.InputJsonValue,
      statsJson: stats as unknown as Prisma.InputJsonValue,
      previewJson: { generatedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
      errorSummary: null,
    },
  });

  return stats;
}

function asMethods(json: Prisma.JsonValue): ExtractedMethod[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rec = item as { original?: unknown; normalized?: unknown };
      if (typeof rec.original !== "string" || typeof rec.normalized !== "string") return null;
      return { original: rec.original, normalized: rec.normalized };
    })
    .filter((v): v is ExtractedMethod => Boolean(v));
}

export async function commitContactIntelImport(jobId: string) {
  const job = await prisma.contactIntelImportJob.findUnique({
    where: { id: jobId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!job) throw new Error("Import job not found.");
  if (job.status === "COMMITTED") throw new Error("This import is already committed.");
  if (job.status !== "PREVIEWED") throw new Error("Preview the mapping before committing.");

  const index = await loadMethodIndex();
  let createdPeople = 0;
  let updatedPeople = 0;
  let addedMethods = 0;
  let committedRows = 0;
  let conflictRows = 0;
  let invalidRows = 0;

  for (const row of job.rows) {
    if (row.status === "INVALID") {
      invalidRows += 1;
      continue;
    }
    if (row.status === "CONFLICT") {
      conflictRows += 1;
      const emails = asMethods(row.emailsJson);
      const phones = asMethods(row.phonesJson);
      const ids = personIdsForExtract({ emails, phones }, index).filter((id) => !id.startsWith("pending:"));
      if (ids.length >= 2) {
        await prisma.contactIntelConflict.create({
          data: {
            jobId,
            sourceRowId: row.id,
            leftPersonId: ids[0]!,
            rightPersonId: ids[1]!,
            reason: Array.isArray(row.messagesJson) ? row.messagesJson.map(String).join(" ") : "Identifier conflict",
          },
        });
      }
      continue;
    }

    const emails = asMethods(row.emailsJson);
    const phones = asMethods(row.phonesJson);
    const personIds = personIdsForExtract({ emails, phones }, index).filter((id) => !id.startsWith("pending:"));

    if (personIds.length > 1) {
      await prisma.contactIntelSourceRow.update({
        where: { id: row.id },
        data: { status: "CONFLICT", messagesJson: ["Email and phone match different people."] },
      });
      conflictRows += 1;
      continue;
    }

    let personId = personIds[0] ?? null;
    if (!personId) {
      const created = await prisma.contactIntelPerson.create({
        data: {
          displayName: row.displayName?.trim() || emails[0]?.normalized || phones[0]?.original || "Unknown",
          firstName: row.firstName,
          lastName: row.lastName,
        },
      });
      personId = created.id;
      createdPeople += 1;
    } else {
      const existing = await prisma.contactIntelPerson.findUnique({ where: { id: personId } });
      if (existing) {
        await prisma.contactIntelPerson.update({
          where: { id: personId },
          data: {
            firstName: existing.firstName || row.firstName,
            lastName: existing.lastName || row.lastName,
            displayName:
              existing.displayName && existing.displayName !== "Unknown"
                ? existing.displayName
                : row.displayName?.trim() || existing.displayName,
          },
        });
      }
      updatedPeople += 1;
    }

    for (const email of emails) {
      const key = methodKey("EMAIL", email.normalized);
      if (index.has(key)) continue;
      await prisma.contactIntelMethod.create({
        data: {
          personId,
          kind: "EMAIL",
          originalValue: email.original,
          normalizedValue: email.normalized,
        },
      });
      index.set(key, personId);
      addedMethods += 1;
    }
    for (const phone of phones) {
      const key = methodKey("PHONE", phone.normalized);
      if (index.has(key)) continue;
      await prisma.contactIntelMethod.create({
        data: {
          personId,
          kind: "PHONE",
          originalValue: phone.original,
          normalizedValue: phone.normalized,
        },
      });
      index.set(key, personId);
      addedMethods += 1;
    }

    await prisma.contactIntelSourceRow.update({
      where: { id: row.id },
      data: { status: "COMMITTED", personId },
    });
    committedRows += 1;
  }

  const stats = {
    createdPeople,
    updatedPeople,
    addedMethods,
    committedRows,
    conflictRows,
    invalidRows,
    total: job.rows.length,
  };

  await prisma.contactIntelImportJob.update({
    where: { id: jobId },
    data: {
      status: "COMMITTED",
      committedAt: new Date(),
      statsJson: stats,
    },
  });

  return stats;
}
