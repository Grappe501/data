import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import {
  classifyContactIntelRows,
  contactIntelMethodKey,
  personIdsForExtract,
  type ContactIntelPreviewStats,
  type MethodIndex,
} from "@/lib/contact-intel/classify";
import { formatAddressPreview } from "@/lib/contact-intel/enrichment";
import type { ContactIntelMapping, ExtractedMethod } from "@/lib/contact-intel/mapping";
import type { ClassifiedContactIntelRow } from "@/lib/contact-intel/classify";
import { markOscarLearned } from "@/lib/contact-intel/oscar";
import { writeContactIntelJobProgress } from "@/lib/contact-intel/progress";

export type { ContactIntelPreviewStats };

async function loadMethodIndex(): Promise<MethodIndex> {
  const methods = await prisma.contactIntelMethod.findMany({
    select: { kind: true, normalizedValue: true, personId: true },
  });
  const index: MethodIndex = new Map();
  for (const m of methods) {
    index.set(contactIntelMethodKey(m.kind, m.normalizedValue), m.personId);
  }
  return index;
}

/**
 * Persist mapping + staging classification only. Does not create people or methods.
 */
export async function applyContactIntelMappingAndPreview(jobId: string, mapping: ContactIntelMapping) {
  const job = await prisma.contactIntelImportJob.findUnique({
    where: { id: jobId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!job) throw new Error("Import job not found.");
  if (job.status === "COMMITTED") throw new Error("This import is already committed.");

  const startedAt = new Date().toISOString();
  await writeContactIntelJobProgress(jobId, {
    phase: "preview",
    done: 0,
    total: job.rows.length,
    startedAt,
    message: "Classifying rows…",
  });

  const index = await loadMethodIndex();
  const existingDefs = await prisma.contactIntelCustomFieldDefinition.findMany({
    select: { key: true, label: true },
  });
  const existingKeys = new Set(existingDefs.map((d) => d.key));
  const customPlan = (mapping.customFields ?? []).map((draft) => ({
    key: draft.key,
    label: draft.label,
    type: draft.type,
    action: existingKeys.has(draft.key) ? "reuse" : "create",
  }));
  const { classified, stats } = classifyContactIntelRows(
    job.rows.map((row) => ({
      id: row.id,
      rowNumber: row.rowNumber,
      raw: (row.rawJson ?? {}) as Record<string, string>,
    })),
    mapping,
    index,
  );

  const byNumber = new Map(job.rows.map((r) => [r.rowNumber, r]));
  const staging = classified.flatMap((row) => {
    const persisted = byNumber.get(row.rowNumber);
    if (!persisted) return [];
    return [
      {
        id: persisted.id,
        data: {
          status: row.status,
          displayName: row.displayName,
          firstName: row.firstName,
          lastName: row.lastName,
          emailsJson: row.emails as unknown as Prisma.InputJsonValue,
          phonesJson: row.phones as unknown as Prisma.InputJsonValue,
          personId: row.matchedPersonId,
          messagesJson: row.messages as unknown as Prisma.InputJsonValue,
          enrichmentJson: enrichmentPayload(row) as unknown as Prisma.InputJsonValue,
        },
      },
    ];
  });

  const chunkSize = 40;
  await writeContactIntelJobProgress(jobId, {
    phase: "preview",
    done: 0,
    total: staging.length,
    startedAt,
    message: "Saving preview…",
  });
  for (let i = 0; i < staging.length; i += chunkSize) {
    const slice = staging.slice(i, i + chunkSize);
    await prisma.$transaction(slice.map((item) => prisma.contactIntelSourceRow.update({ where: { id: item.id }, data: item.data })));
    await writeContactIntelJobProgress(jobId, {
      phase: "preview",
      done: Math.min(i + chunkSize, staging.length),
      total: staging.length,
      startedAt,
      message: "Saving preview…",
    });
  }

  await prisma.contactIntelImportJob.update({
    where: { id: jobId },
    data: {
      status: "PREVIEWED",
      mappingJson: mapping as unknown as Prisma.InputJsonValue,
      statsJson: stats as unknown as Prisma.InputJsonValue,
      previewJson: {
        ...markOscarLearned(job.previewJson, mapping),
        generatedAt: new Date().toISOString(),
        customFields: customPlan,
        progress: {
          phase: "done",
          done: staging.length,
          total: staging.length,
          startedAt,
          message: "Preview ready",
        },
      } as unknown as Prisma.InputJsonValue,
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

  const startedAt = new Date().toISOString();
  await writeContactIntelJobProgress(jobId, {
    phase: "commit",
    done: 0,
    total: job.rows.length,
    startedAt,
    message: "Committing rows…",
  });

  try {
    const stats = await prisma.$transaction(
      async (tx) => {
        const methods = await tx.contactIntelMethod.findMany({
          select: { kind: true, normalizedValue: true, personId: true },
        });
        const index: MethodIndex = new Map();
        for (const m of methods) {
          index.set(contactIntelMethodKey(m.kind, m.normalizedValue), m.personId);
        }

        const mapping = (job.mappingJson ?? { columns: {} }) as ContactIntelMapping;
        const { classified, stats: previewStats } = classifyContactIntelRows(
          job.rows.map((row) => ({
            id: row.id,
            rowNumber: row.rowNumber,
            raw: (row.rawJson ?? {}) as Record<string, string>,
          })),
          mapping,
          index,
        );

        const tagCache = new Map<string, string>();
        const defCache = new Map<string, string>();
        const existingTags = await tx.contactIntelTag.findMany({ select: { id: true, key: true } });
        for (const t of existingTags) tagCache.set(t.key, t.id);
        const existingFieldDefs = await tx.contactIntelCustomFieldDefinition.findMany({
          select: { id: true, key: true },
        });
        for (const d of existingFieldDefs) defCache.set(d.key, d.id);
        for (const draft of mapping.customFields ?? []) {
          const current = defCache.get(draft.key);
          if (current) continue;
          const created = await tx.contactIntelCustomFieldDefinition.create({
            data: { key: draft.key, label: draft.label, type: "TEXT" },
          });
          defCache.set(draft.key, created.id);
        }

        let createdPeople = 0;
        let updatedPeople = 0;
        let addedMethods = 0;
        let addedAddresses = 0;
        let addedTagJoins = 0;
        let addedCustomValues = 0;
        let committedRows = 0;
        let conflictRows = 0;
        let invalidRows = 0;
        let processed = 0;
        const bumpProgress = async () => {
          processed += 1;
          if (processed % 40 !== 0 && processed !== classified.length) return;
          await writeContactIntelJobProgress(jobId, {
            phase: "commit",
            done: processed,
            total: classified.length,
            startedAt,
            message: "Committing rows…",
          });
        };

        for (const row of classified) {
          const persisted = job.rows.find((r) => r.rowNumber === row.rowNumber);
          if (!persisted) continue;

          if (row.status === "INVALID") {
            invalidRows += 1;
            await tx.contactIntelSourceRow.update({
              where: { id: persisted.id },
              data: {
                status: "INVALID",
                messagesJson: row.messages as unknown as Prisma.InputJsonValue,
              },
            });
            await bumpProgress();
            continue;
          }

          if (row.status === "CONFLICT") {
            conflictRows += 1;
            const emails = row.emails.length ? row.emails : asMethods(persisted.emailsJson);
            const phones = row.phones.length ? row.phones : asMethods(persisted.phonesJson);
            const ids = personIdsForExtract({ emails, phones }, index).filter((id) => !id.startsWith("pending:"));
            if (ids.length >= 2) {
              await tx.contactIntelConflict.create({
                data: {
                  jobId,
                  sourceRowId: persisted.id,
                  leftPersonId: ids[0]!,
                  rightPersonId: ids[1]!,
                  reason: row.messages.join(" ") || "Identifier conflict",
                },
              });
            }
            await tx.contactIntelSourceRow.update({
              where: { id: persisted.id },
              data: {
                status: "CONFLICT",
                messagesJson: row.messages as unknown as Prisma.InputJsonValue,
              },
            });
            await bumpProgress();
            continue;
          }

          const emails = row.emails;
          const phones = row.phones;
          const personIds = personIdsForExtract({ emails, phones }, index).filter((id) => !id.startsWith("pending:"));

          if (personIds.length > 1) {
            await tx.contactIntelSourceRow.update({
              where: { id: persisted.id },
              data: { status: "CONFLICT", messagesJson: ["Email and phone match different people."] },
            });
            conflictRows += 1;
            await bumpProgress();
            continue;
          }

          let personId = personIds[0] ?? null;
          if (!personId) {
            const created = await tx.contactIntelPerson.create({
              data: {
                displayName: row.displayName?.trim() || emails[0]?.normalized || phones[0]?.original || "Unknown",
                firstName: row.firstName,
                lastName: row.lastName,
              },
            });
            personId = created.id;
            createdPeople += 1;
          } else {
            const existing = await tx.contactIntelPerson.findUnique({ where: { id: personId } });
            if (existing) {
              await tx.contactIntelPerson.update({
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
            const key = contactIntelMethodKey("EMAIL", email.normalized);
            if (index.has(key)) continue;
            await tx.contactIntelMethod.create({
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
            const key = contactIntelMethodKey("PHONE", phone.normalized);
            if (index.has(key)) continue;
            await tx.contactIntelMethod.create({
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

          const attached = await attachContactIntelEnrichment(tx, personId, persisted.id, row, {
            tags: tagCache,
            defs: defCache,
          });
          addedAddresses += attached.addresses;
          addedTagJoins += attached.tagJoins;
          addedCustomValues += attached.customValues;

          await tx.contactIntelSourceRow.update({
            where: { id: persisted.id },
            data: {
              status: "COMMITTED",
              personId,
              enrichmentJson: enrichmentPayload(row) as unknown as Prisma.InputJsonValue,
            },
          });
          committedRows += 1;
          await bumpProgress();
        }

        const stats = {
          createdPeople,
          updatedPeople,
          addedMethods,
          addedAddresses,
          addedTagJoins,
          addedCustomValues,
          committedRows,
          conflictRows,
          invalidRows,
          total: job.rows.length,
          previewNew: previewStats.newCount,
          previewUpdate: previewStats.updateCount,
          previewInvalid: previewStats.invalid,
          previewConflict: previewStats.conflictCount,
        };

        await tx.contactIntelImportJob.update({
          where: { id: jobId },
          data: {
            status: "COMMITTED",
            committedAt: new Date(),
            statsJson: stats,
            errorSummary: null,
          },
        });

        return stats;
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
    await writeContactIntelJobProgress(jobId, {
      phase: "done",
      done: job.rows.length,
      total: job.rows.length,
      startedAt,
      message: "Commit finished",
    });
    return stats;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 400) : "Commit failed.";
    await prisma.contactIntelImportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorSummary: message },
    });
    throw err;
  }
}

function enrichmentPayload(row: ClassifiedContactIntelRow) {
  return {
    address: row.address,
    tags: row.tags,
    custom: row.custom,
    addressPreview: formatAddressPreview(row.address),
  };
}

async function attachContactIntelEnrichment(
  tx: Prisma.TransactionClient,
  personId: string,
  sourceRowId: string,
  row: ClassifiedContactIntelRow,
  caches: { tags: Map<string, string>; defs: Map<string, string> },
) {
  let addresses = 0;
  let tagJoins = 0;
  let customValues = 0;

  if (row.address) {
    const existing = await tx.contactIntelAddress.findUnique({
      where: { personId_fingerprint: { personId, fingerprint: row.address.fingerprint } },
    });
    if (!existing) {
      await tx.contactIntelAddress.create({
        data: {
          personId,
          sourceRowId,
          line: row.address.line,
          city: row.address.city,
          state: row.address.state,
          postalCode: row.address.postalCode,
          originalJson: row.address.original as unknown as Prisma.InputJsonValue,
          fingerprint: row.address.fingerprint,
        },
      });
      addresses += 1;
    }
  }

  for (const tag of row.tags) {
    let tagId = caches.tags.get(tag.key);
    if (!tagId) {
      const created = await tx.contactIntelTag.create({
        data: { key: tag.key, name: tag.name },
      });
      tagId = created.id;
      caches.tags.set(tag.key, tagId);
    }
    const join = await tx.contactIntelPersonTag.findUnique({
      where: { personId_tagId: { personId, tagId } },
    });
    if (!join) {
      await tx.contactIntelPersonTag.create({
        data: { personId, tagId, sourceRowId },
      });
      tagJoins += 1;
    }
  }

  for (const field of row.custom) {
    const definitionId = caches.defs.get(field.key);
    if (!definitionId) continue;
    const current = await tx.contactIntelCustomFieldValue.findUnique({
      where: { personId_definitionId: { personId, definitionId } },
    });
    if (!current) {
      await tx.contactIntelCustomFieldValue.create({
        data: {
          personId,
          definitionId,
          originalValue: field.original,
          normalizedValue: field.normalized,
          sourceRowId,
        },
      });
      customValues += 1;
    } else if (current.normalizedValue !== field.normalized) {
      await tx.contactIntelCustomFieldValue.update({
        where: { id: current.id },
        data: {
          originalValue: field.original,
          normalizedValue: field.normalized,
          sourceRowId,
        },
      });
    }
  }

  return { addresses, tagJoins, customValues };
}
