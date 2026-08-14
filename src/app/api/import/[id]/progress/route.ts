import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readContactIntelJobProgress } from "@/lib/contact-intel/progress";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  const { id } = await ctx.params;
  const job = await prisma.contactIntelImportJob.findUnique({
    where: { id },
    select: { id: true, status: true, previewJson: true, _count: { select: { rows: true } } },
  });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const progress = readContactIntelJobProgress(job.previewJson);
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    rowCount: job._count.rows,
    phase: progress?.phase ?? "idle",
    done: progress?.done ?? 0,
    total: progress?.total ?? job._count.rows,
    startedAt: progress?.startedAt ?? null,
    message: progress?.message ?? null,
  });
}
