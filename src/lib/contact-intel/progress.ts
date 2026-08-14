import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";

export type ContactIntelJobProgress = {
  phase: "upload" | "preview" | "commit" | "done";
  done: number;
  total: number;
  startedAt: string;
  message?: string;
};

export async function writeContactIntelJobProgress(jobId: string, progress: ContactIntelJobProgress) {
  const job = await prisma.contactIntelImportJob.findUnique({
    where: { id: jobId },
    select: { previewJson: true },
  });
  const prior = job?.previewJson && typeof job.previewJson === "object" && !Array.isArray(job.previewJson)
    ? (job.previewJson as Record<string, unknown>)
    : {};
  await prisma.contactIntelImportJob.update({
    where: { id: jobId },
    data: {
      previewJson: { ...prior, progress } as unknown as Prisma.InputJsonValue,
    },
  });
}

export function readContactIntelJobProgress(previewJson: unknown): ContactIntelJobProgress | null {
  if (!previewJson || typeof previewJson !== "object") return null;
  const raw = (previewJson as { progress?: unknown }).progress;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.done !== "number" || typeof rec.total !== "number" || typeof rec.startedAt !== "string") return null;
  if (rec.phase !== "upload" && rec.phase !== "preview" && rec.phase !== "commit" && rec.phase !== "done") return null;
  return {
    phase: rec.phase,
    done: rec.done,
    total: rec.total,
    startedAt: rec.startedAt,
    message: typeof rec.message === "string" ? rec.message : undefined,
  };
}
