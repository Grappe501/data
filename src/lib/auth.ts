import { createHmac, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export const ADMIN_SESSION_COOKIE = "data_admin_session";

export function getAdminSecret(): string | undefined {
  const s = process.env.ADMIN_SECRET?.trim();
  return s || undefined;
}

export function createAdminSessionToken(secret: string): string {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyAdminSessionToken(token: string | undefined, secret: string | undefined): boolean {
  if (!token || !secret) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  try {
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return false;
    }
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: number };
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

function isLocalDevHost(hostHeader: string | null): boolean {
  if (process.env.ADMIN_REQUIRE_AUTH_ON_LOCALHOST === "1") return false;
  if (process.env.NODE_ENV === "production") return false;
  const host = (hostHeader ?? "").toLowerCase().split(":")[0].trim();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export async function requireAdminPage(): Promise<void> {
  const h = await headers();
  if (isLocalDevHost(h.get("host"))) return;
  const secret = getAdminSecret();
  if (!secret) redirect("/login?error=config");
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!verifyAdminSessionToken(token, secret)) redirect("/login");
}

export async function requireAdminAction(): Promise<void> {
  const h = await headers();
  if (isLocalDevHost(h.get("host"))) return;
  const secret = getAdminSecret();
  if (!secret) redirect("/login?error=config");
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!verifyAdminSessionToken(token, secret)) redirect("/login");
}
