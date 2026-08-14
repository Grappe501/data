import { createHash } from "node:crypto";

export function normalizeOscarHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function oscarHeaderFingerprint(headers: string[]): string {
  return [...new Set(headers.map(normalizeOscarHeader).filter(Boolean))].sort().join("|");
}

export function oscarShapeId(headers: string[]): string {
  return createHash("sha256").update(oscarHeaderFingerprint(headers)).digest("hex").slice(0, 16);
}

export function oscarHeaderJaccard(a: string[], b: string[]): number {
  const left = new Set(a.map(normalizeOscarHeader).filter(Boolean));
  const right = new Set(b.map(normalizeOscarHeader).filter(Boolean));
  if (left.size === 0 && right.size === 0) return 1;
  let inter = 0;
  for (const h of left) if (right.has(h)) inter += 1;
  const union = left.size + right.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function oscarValueShape(value: string): string {
  const v = value.trim();
  if (!v) return "empty";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "email";
  const digits = v.replace(/\D/g, "");
  if (digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))) return "phone";
  if (/^\d{5}(-\d{4})?$/.test(v)) return "zip";
  if (/^[A-Za-z]{2}$/.test(v)) return "state";
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(v) || /^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
  if (/^-?\d+(\.\d+)?$/.test(v)) return "number";
  if (v.length > 80) return "long-text";
  return "short-text";
}
