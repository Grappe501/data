import type { ContactIntelSourceRowStatus } from "@/generated/prisma";
import type { ContactIntelAddressCandidate, ContactIntelCustomCandidate, ContactIntelTagCandidate } from "@/lib/contact-intel/enrichment";
import {
  extractContactIntelRow,
  isValidContactIntelExtract,
  splitFullName,
  type ContactIntelMapping,
  type ExtractedMethod,
} from "@/lib/contact-intel/mapping";

export type MethodIndex = Map<string, string>;

export function contactIntelMethodKey(kind: "EMAIL" | "PHONE", normalized: string): string {
  return `${kind}:${normalized}`;
}

export type ContactIntelPreviewStats = {
  total: number;
  invalid: number;
  newCount: number;
  updateCount: number;
  conflictCount: number;
  skippedCount: number;
};

export type ClassifiedContactIntelRow = {
  rowNumber: number;
  status: ContactIntelSourceRowStatus;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  emails: ExtractedMethod[];
  phones: ExtractedMethod[];
  address: ContactIntelAddressCandidate | null;
  tags: ContactIntelTagCandidate[];
  custom: ContactIntelCustomCandidate[];
  matchedPersonId: string | null;
  messages: string[];
};

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

export function personIdsForExtract(
  extract: { emails: ExtractedMethod[]; phones: ExtractedMethod[] },
  index: MethodIndex,
): string[] {
  const ids = new Set<string>();
  for (const e of extract.emails) {
    const id = index.get(contactIntelMethodKey("EMAIL", e.normalized));
    if (id) ids.add(id);
  }
  for (const p of extract.phones) {
    const id = index.get(contactIntelMethodKey("PHONE", p.normalized));
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Pure classification. Mutates a working copy of the method index for in-file first-seen matching.
 * Does not write to the database.
 */
export function classifyContactIntelRows(
  rows: { rowNumber: number; raw: Record<string, string>; id?: string }[],
  mapping: ContactIntelMapping,
  existingIndex: MethodIndex,
): { classified: ClassifiedContactIntelRow[]; stats: ContactIntelPreviewStats } {
  const index: MethodIndex = new Map(existingIndex);
  const stats: ContactIntelPreviewStats = {
    total: rows.length,
    invalid: 0,
    newCount: 0,
    updateCount: 0,
    conflictCount: 0,
    skippedCount: 0,
  };
  const classified: ClassifiedContactIntelRow[] = [];

  for (const row of rows) {
    const extract = extractContactIntelRow(row.raw, mapping);
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
        const provisionalId = `pending:${row.id ?? row.rowNumber}`;
        for (const e of extract.emails) index.set(contactIntelMethodKey("EMAIL", e.normalized), provisionalId);
        for (const p of extract.phones) index.set(contactIntelMethodKey("PHONE", p.normalized), provisionalId);
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
          if (!index.has(contactIntelMethodKey("EMAIL", e.normalized))) {
            index.set(contactIntelMethodKey("EMAIL", e.normalized), only);
          }
        }
        for (const p of extract.phones) {
          if (!index.has(contactIntelMethodKey("PHONE", p.normalized))) {
            index.set(contactIntelMethodKey("PHONE", p.normalized), only);
          }
        }
      } else {
        status = "CONFLICT";
        messages.push("Email and phone match different people. Those people were not merged.");
        stats.conflictCount += 1;
      }
    }

    classified.push({
      rowNumber: row.rowNumber,
      status,
      displayName,
      firstName,
      lastName,
      emails: extract.emails,
      phones: extract.phones,
      address: extract.address,
      tags: extract.tags,
      custom: extract.custom,
      matchedPersonId,
      messages,
    });
  }

  return { classified, stats };
}
