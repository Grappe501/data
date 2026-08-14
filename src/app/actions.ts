"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminAction } from "@/lib/auth";
import { createContactIntelImportJob } from "@/lib/contact-intel/jobs";
import { buildContactIntelMappingFromForm, guessContactIntelMapping } from "@/lib/contact-intel/mapping";
import { CONTACT_INTEL_MAX_UPLOAD_BYTES } from "@/lib/contact-intel/parse";
import { applyContactIntelMappingAndPreview, commitContactIntelImport } from "@/lib/contact-intel/pipeline";

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
  } catch {
    redirect("/import?error=parse");
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
