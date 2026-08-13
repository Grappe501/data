export function normalizeEmail(email: string): string {
  const t = email.trim().toLowerCase();
  if (!t || !t.includes("@")) return "";
  return t;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  if (digits.length >= 10) return digits.slice(-10);
  return null;
}
