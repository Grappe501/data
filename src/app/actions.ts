"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminAction } from "@/lib/auth";
import { createContactIntelImportJob } from "@/lib/contact-intel/jobs";
import { buildContactIntelMappingFromForm, guessContactIntelMapping } from "@/lib/contact-intel/mapping";
import { CONTACT_INTEL_MAX_UPLOAD_BYTES, ContactIntelUploadError } from "@/lib/contact-intel/parse";

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
import { applyContactIntelMappingAndPreview, commitContactIntelImport } from "@/lib/contact-intel/pipeline";
import {
  dismissContactIntelConflict,
  markContactIntelVoterNoMatch,
  saveContactIntelVoterId,
} from "@/lib/contact-intel/review";
import { markContactIntelPeopleReview, tagContactIntelPeople } from "@/lib/contact-intel/working-set";

function trim(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function uploadContactIntelFileAction(fd: FormData): Promise<void> {
  await requireAdminAction();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) redirect("/import?error=file");
  if (file.size > CONTACT_INTEL_MAX_UPLOAD_BYTES) redirect("/import?error=size");
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const jobId = await createContactIntelImportJob({
      filename: file.name || "upload.csv",
      buffer: buf,
      sourceLabel: trim(fd, "sourceLabel") || null,
    });
    revalidatePath("/");
    revalidatePath("/import");
    redirect(`/import/${jobId}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    const code = err instanceof ContactIntelUploadError ? err.code : "parse";
    redirect(`/import?error=${code}`);
  }
}

export async function previewContactIntelMappingAction(fd: FormData): Promise<void> {
  await requireAdminAction();
  const jobId = trim(fd, "jobId");
  if (!jobId) redirect("/import?error=job");
  const headersRaw = trim(fd, "headers");
  let headers: string[] = [];
  try {
    headers = JSON.parse(headersRaw) as string[];
  } catch {
    headers = [];
  }
  const mapping =
    headers.length > 0
      ? buildContactIntelMappingFromForm(headers, (key) => trim(fd, key))
      : guessContactIntelMapping([]);
  await applyContactIntelMappingAndPreview(jobId, mapping);
  revalidatePath(`/import/${jobId}`);
  revalidatePath("/");
}

export async function commitContactIntelImportAction(fd: FormData): Promise<void> {
  await requireAdminAction();
  const jobId = trim(fd, "jobId");
  if (!jobId) redirect("/import?error=job");
  await commitContactIntelImport(jobId);
  revalidatePath(`/import/${jobId}`);
  revalidatePath("/");
  redirect(`/import/${jobId}?committed=1`);
}

export async function dismissContactIntelConflictAction(fd: FormData): Promise<void> {
  await requireAdminAction();
  const id = trim(fd, "conflictId");
  if (!id) return;
  await dismissContactIntelConflict(id);
  revalidatePath("/review/dedupe");
  revalidatePath("/");
}

export async function saveContactIntelVoterIdAction(fd: FormData): Promise<void> {
  await requireAdminAction();
  const personId = trim(fd, "personId");
  const voterId = trim(fd, "voterId");
  if (!personId) return;
  await saveContactIntelVoterId({ personId, voterId, note: trim(fd, "note") || null });
  revalidatePath(`/contacts/${personId}`);
  revalidatePath("/review/voters");
  revalidatePath("/");
}

export async function markContactIntelVoterNoMatchAction(fd: FormData): Promise<void> {
  await requireAdminAction();
  const personId = trim(fd, "personId");
  if (!personId) return;
  await markContactIntelVoterNoMatch(personId);
  revalidatePath(`/contacts/${personId}`);
  revalidatePath("/review/voters");
  revalidatePath("/");
}

function safeReturnTo(raw: string): string {
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

function personIdsFrom(fd: FormData): string[] {
  return fd.getAll("personId").map((v) => String(v).trim()).filter(Boolean);
}

export async function tagContactIntelWorkingSetAction(fd: FormData): Promise<void> {
  await requireAdminAction();
  const returnTo = safeReturnTo(trim(fd, "returnTo"));
  try {
    await tagContactIntelPeople(personIdsFrom(fd), trim(fd, "tag"));
  } catch {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}set=empty`);
  }
  revalidatePath("/");
  revalidatePath("/review/set");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}set=tagged`);
}

export async function markContactIntelReviewAction(fd: FormData): Promise<void> {
  await requireAdminAction();
  const returnTo = safeReturnTo(trim(fd, "returnTo"));
  try {
    await markContactIntelPeopleReview(personIdsFrom(fd));
  } catch {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}set=empty`);
  }
  revalidatePath("/");
  revalidatePath("/review/set");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}set=reviewed`);
}
