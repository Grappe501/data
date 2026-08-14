import { normalizeEmail } from "@/lib/normalize";
import {
  assembleContactIntelAddress,
  normalizeCustomFieldKey,
  normalizeCustomFieldValue,
  splitContactIntelTags,
  type ContactIntelAddressCandidate,
  type ContactIntelCustomCandidate,
  type ContactIntelTagCandidate,
} from "@/lib/contact-intel/enrichment";

export function normalizeContactIntelPhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

export const CONTACT_INTEL_FIELD_TARGETS = [
  "ignore",
  "email",
  "phone",
  "full_name",
  "first_name",
  "last_name",
  "address",
  "city",
  "state",
  "zip",
  "tag",
] as const;

export type ContactIntelFixedTarget = (typeof CONTACT_INTEL_FIELD_TARGETS)[number];
export type ContactIntelFieldTarget = ContactIntelFixedTarget | `custom:${string}`;

export type ContactIntelCustomFieldDraft = {
  key: string;
  label: string;
  type: "TEXT";
};

export type ContactIntelMapping = {
  columns: Record<string, ContactIntelFieldTarget>;
  customFields?: ContactIntelCustomFieldDraft[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseContactIntelTarget(raw: string): ContactIntelFieldTarget {
  if (raw.startsWith("custom:")) {
    const key = normalizeCustomFieldKey(raw.slice(7));
    return key ? `custom:${key}` : "ignore";
  }
  if ((CONTACT_INTEL_FIELD_TARGETS as readonly string[]).includes(raw)) {
    return raw as ContactIntelFixedTarget;
  }
  return "ignore";
}

export function customKeyFromTarget(target: ContactIntelFieldTarget): string | null {
  return target.startsWith("custom:") ? target.slice(7) : null;
}

export function guessContactIntelTarget(header: string): ContactIntelFieldTarget {
  const h = header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (/e[\s-]?mail/.test(h) || h === "email" || /^email\s*\d*$/.test(h)) return "email";
  if (/phone|mobile|cell|\btel\b|telephone/.test(h)) return "phone";
  if (/first\s*name|firstname|given name|\bgiven\b/.test(h)) return "first_name";
  if (/last\s*name|lastname|surname|family name/.test(h)) return "last_name";
  if (/^(full\s*)?name$/.test(h) || h === "display name" || h === "contact name") return "full_name";
  if (/^(street|address(\s*1)?|addr|address\s*line)$/.test(h)) return "address";
  if (/^city$/.test(h)) return "city";
  if (/^state$/.test(h)) return "state";
  if (/^(zip|zip\s*code|postal|postal\s*code)$/.test(h)) return "zip";
  if (/^(tag|tags|labels)$/.test(h)) return "tag";
  return "ignore";
}

export function guessContactIntelMapping(headers: string[]): ContactIntelMapping {
  const columns: Record<string, ContactIntelFieldTarget> = {};
  for (const h of headers) columns[h] = guessContactIntelTarget(h);
  return { columns, customFields: [] };
}

export function buildContactIntelMappingFromForm(
  headers: string[],
  get: (key: string) => string,
): ContactIntelMapping {
  const columns: Record<string, ContactIntelFieldTarget> = {};
  const customFields: ContactIntelCustomFieldDraft[] = [];
  const seen = new Set<string>();
  for (const header of headers) {
    const raw = get(`map:${header}`);
    if (raw === "custom") {
      const existing = get(`customExisting:${header}`);
      const key = normalizeCustomFieldKey(existing || get(`customKey:${header}`) || header);
      const label = get(`customLabel:${header}`) || header.trim() || key;
      if (!key) {
        columns[header] = "ignore";
        continue;
      }
      columns[header] = `custom:${key}`;
      if (!seen.has(key)) {
        customFields.push({ key, label, type: "TEXT" });
        seen.add(key);
      }
    } else {
      columns[header] = parseContactIntelTarget(raw);
    }
  }
  return { columns, customFields };
}

export type ExtractedMethod = { original: string; normalized: string };

export type ContactIntelExtractedRow = {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  emails: ExtractedMethod[];
  phones: ExtractedMethod[];
  address: ContactIntelAddressCandidate | null;
  tags: ContactIntelTagCandidate[];
  custom: ContactIntelCustomCandidate[];
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
  let line: string | null = null;
  let city: string | null = null;
  let state: string | null = null;
  let postalCode: string | null = null;
  const tags: ContactIntelTagCandidate[] = [];
  const custom: ContactIntelCustomCandidate[] = [];

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
        const normalized = normalizeContactIntelPhone(part);
        if (normalized) phones.push({ original: part, normalized });
      }
    } else if (target === "full_name") {
      fullName = value;
    } else if (target === "first_name") {
      firstName = value;
    } else if (target === "last_name") {
      lastName = value;
    } else if (target === "address") {
      line = value;
    } else if (target === "city") {
      city = value;
    } else if (target === "state") {
      state = value;
    } else if (target === "zip") {
      postalCode = value;
    } else if (target === "tag") {
      tags.push(...splitContactIntelTags(value));
    } else if (target.startsWith("custom:")) {
      const key = customKeyFromTarget(target);
      const normalized = normalizeCustomFieldValue(value);
      if (key && normalized) custom.push({ key, original: value, normalized });
    }
  }

  const tagSeen = new Set<string>();
  const uniqTags = tags.filter((t) => {
    if (tagSeen.has(t.key)) return false;
    tagSeen.add(t.key);
    return true;
  });
  const customSeen = new Set<string>();
  const uniqCustom = custom.filter((c) => {
    if (customSeen.has(c.key)) return false;
    customSeen.add(c.key);
    return true;
  });

  const composed = [firstName, lastName].filter(Boolean).join(" ").trim() || null;
  const displayName = fullName || composed || emails[0]?.normalized || phones[0]?.original || null;

  return {
    displayName,
    firstName,
    lastName,
    emails: uniqMethods(emails),
    phones: uniqMethods(phones),
    address: assembleContactIntelAddress({ line, city, state, postalCode }),
    tags: uniqTags,
    custom: uniqCustom,
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
