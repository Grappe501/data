"use server";

import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken, getAdminSecret } from "@/lib/auth";

function hashEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return ah.length === bh.length && timingSafeEqual(ah, bh);
}

export async function loginAction(formData: FormData) {
  const secret = getAdminSecret();
  if (!secret) redirect("/login?error=config");
  const password = String(formData.get("password") ?? "");
  if (!hashEqual(password, secret)) redirect("/login?error=auth");
  const token = createAdminSessionToken(secret);
  (await cookies()).set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect("/");
}
