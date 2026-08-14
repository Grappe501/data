import { createHash } from "node:crypto";

export type ContactIntelAddressCandidate = {
  line: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  original: { line?: string; city?: string; state?: string; postalCode?: string };
  fingerprint: string;
};

export type ContactIntelTagCandidate = {
  name: string;
  key: string;
  original: string;
};

export type ContactIntelCustomCandidate = {
  key: string;
  original: string;
  normalized: string;
};

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeAddressLine(value: string): string {
  return collapse(value).toLowerCase();
}

export function normalizeAddressCity(value: string): string {
  return collapse(value).toLowerCase();
}

/** 2-letter codes become uppercase. Longer values collapse + lowercase for fingerprinting only. */
export function normalizeAddressState(value: string): string {
  const t = collapse(value);
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return t.toLowerCase();
}

/** 5-digit ZIP, or ZIP+4 as #####-####. */
export function normalizeAddressPostal(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 9) return `${digits.slice(0, 5)}-${digits.slice(5, 9)}`;
  if (digits.length >= 5) return digits.slice(0, 5);
  return digits;
}

export function contactIntelAddressFingerprint(parts: {
  line?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): string {
  const payload = [
    parts.line ? normalizeAddressLine(parts.line) : "",
    parts.city ? normalizeAddressCity(parts.city) : "",
    parts.state ? normalizeAddressState(parts.state) : "",
    parts.postalCode ? normalizeAddressPostal(parts.postalCode) : "",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function assembleContactIntelAddress(parts: {
  line?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): ContactIntelAddressCandidate | null {
  const original: ContactIntelAddressCandidate["original"] = {};
  if (parts.line?.trim()) original.line = parts.line;
  if (parts.city?.trim()) original.city = parts.city;
  if (parts.state?.trim()) original.state = parts.state;
  if (parts.postalCode?.trim()) original.postalCode = parts.postalCode;
  if (Object.keys(original).length === 0) return null;

  const line = parts.line?.trim() ? collapse(parts.line) : null;
  const city = parts.city?.trim() ? collapse(parts.city) : null;
  const state = parts.state?.trim() ? normalizeAddressState(parts.state) : null;
  const postalCode = parts.postalCode?.trim() ? normalizeAddressPostal(parts.postalCode) || collapse(parts.postalCode) : null;

  return {
    line,
    city,
    state,
    postalCode,
    original,
    fingerprint: contactIntelAddressFingerprint({ line, city, state, postalCode }),
  };
}

export function normalizeContactIntelTagKey(value: string): string {
  return collapse(value).toLowerCase();
}

/** Split on comma or semicolon only — not spaces. */
export function splitContactIntelTags(value: string): ContactIntelTagCandidate[] {
  const seen = new Set<string>();
  const out: ContactIntelTagCandidate[] = [];
  for (const token of value.split(/[,;]+/)) {
    const original = token.trim();
    if (!original) continue;
    const key = normalizeContactIntelTagKey(original);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: collapse(original), key, original });
  }
  return out;
}

export function normalizeCustomFieldKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function normalizeCustomFieldValue(value: string): string {
  return collapse(value).slice(0, 500);
}

export function formatAddressPreview(address: ContactIntelAddressCandidate | null): string {
  if (!address) return "";
  return [address.line, address.city, address.state, address.postalCode].filter(Boolean).join(", ");
}
