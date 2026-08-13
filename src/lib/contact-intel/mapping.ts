import { normalizeEmail, normalizePhone } from "@/lib/normalize";

export const CONTACT_INTEL_FIELD_TARGETS = [
  "ignore",
  "email",
  "phone",
  "full_name",
  "first_name",
  "last_name",
] as const;

export type ContactIntelFieldTarget = (typeof CONTACT_INTEL_FIELD_TARGETS)[number];

export type ContactIntelMapping = {
  columns: Record<string, ContactIntelFieldTarget>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function guessContactIntelTarget(header: string): ContactIntelFieldTarget {
  const h = header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (/e-?mail/.test(h) || h === "email" || /^email\s*\d*$/.test(h)) return "email";
  if (/phone|mobile|cell|\btel\b|telephone/.test(h)) return "phone";
  if (/first\s*name|firstname|given name|\bgiven\b/.test(h)) return "first_name";
  if (/last\s*name|lastname|surname|family name/.test(h)) return "last_name";
  if (/^(full\s*)?name$/.test(h) || h === "display name" || h === "contact name") return "full_name";
  return "ignore";
}

export function guessContactIntelMapping(headers: string[]): ContactIntelMapping {
  const columns: Record<string, ContactIntelFieldTarget> = {};
  for (const h of headers) columns[h] = guessContactIntelTarget(h);
  return { columns };
}

export type ExtractedMethod = { original: string; normalized: string };

export type ContactIntelExtractedRow = {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  emails: ExtractedMethod[];
  phones: ExtractedMethod[];
};

function splitCell(value: string): string[] {
  return value
    .split(/[,;|/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function uniqMethods(items: ExtractedMethod[]): ExtractedMethod[] {
  const seen = new Set<string>();
  const out: ExtractedMethod[] = [];
  for (const item of items) {
    if (seen.has(item.normalized)) continue;
    seen.add(item.normalized);
    out.push(item);
  }
  return out;
}

export function extractContactIntelRow(
  raw: Record<string, string>,
  mapping: ContactIntelMapping,
): ContactIntelExtractedRow {
  const emails: ExtractedMethod[] = [];
  const phones: ExtractedMethod[] = [];
  let fullName: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;

  for (const [header, target] of Object.entries(mapping.columns)) {
    const value = (raw[header] ?? "").trim();
    if (!value || target === "ignore") continue;
    if (target === "email") {
      for (const part of splitCell(value)) {
        const normalized = normalizeEmail(part);
        if (normalized && EMAIL_RE.test(normalized)) {
          emails.push({ original: part, normalized });
        }
      }
    } else if (target === "phone") {
      for (const part of splitCell(value)) {
        const normalized = normalizePhone(part);
        if (normalized) phones.push({ original: part, normalized });
      }
    } else if (target === "full_name") {
      fullName = value;
    } else if (target === "first_name") {
      firstName = value;
    } else if (target === "last_name") {
      lastName = value;
    }
  }

  const composed = [firstName, lastName].filter(Boolean).join(" ").trim() || null;
  const displayName = fullName || composed || emails[0]?.normalized || phones[0]?.original || null;

  return {
    displayName,
    firstName,
    lastName,
    emails: uniqMethods(emails),
    phones: uniqMethods(phones),
  };
}

export function isValidContactIntelExtract(row: ContactIntelExtractedRow): boolean {
  return row.emails.length > 0 || row.phones.length > 0;
}

export function splitFullName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName?.trim()) return { firstName: null, lastName: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] ?? null, lastName: null };
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null };
}
