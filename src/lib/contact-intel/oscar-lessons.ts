import { prisma } from "@/lib/db";
import type { ContactIntelCustomFieldDraft, ContactIntelFieldTarget } from "@/lib/contact-intel/mapping";
import { parseContactIntelTarget } from "@/lib/contact-intel/mapping";
import { oscarHeaderFingerprint, oscarHeaderJaccard, oscarShapeId } from "@/lib/contact-intel/oscar-headers";

export type OscarLesson = {
  jobId: string;
  filename: string;
  sourceLabel: string | null;
  headers: string[];
  columns: Record<string, ContactIntelFieldTarget>;
  customFields: ContactIntelCustomFieldDraft[];
  score: number;
  exact: boolean;
};

function asHeaders(json: unknown): string[] {
  return Array.isArray(json) ? json.map((v) => String(v)).filter(Boolean) : [];
}

function asColumns(json: unknown): Record<string, ContactIntelFieldTarget> {
  if (!json || typeof json !== "object") return {};
  const columns = (json as { columns?: Record<string, unknown> }).columns ?? {};
  const out: Record<string, ContactIntelFieldTarget> = {};
  for (const [header, target] of Object.entries(columns)) {
    if (typeof target === "string") out[header] = parseContactIntelTarget(target);
  }
  return out;
}

function asCustomFields(json: unknown): ContactIntelCustomFieldDraft[] {
  if (!json || typeof json !== "object") return [];
  const raw = (json as { customFields?: unknown }).customFields;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rec = item as { key?: unknown; label?: unknown };
      if (typeof rec.key !== "string" || !rec.key) return null;
      return { key: rec.key, label: String(rec.label ?? rec.key), type: "TEXT" as const };
    })
    .filter((v): v is ContactIntelCustomFieldDraft => Boolean(v));
}

export async function findOscarLessons(headers: string[]): Promise<OscarLesson[]> {
  const jobs = await prisma.contactIntelImportJob.findMany({
    where: { status: { in: ["PREVIEWED", "COMMITTED"] } },
    orderBy: { updatedAt: "desc" },
    take: 80,
    select: {
      id: true,
      originalFilename: true,
      sourceLabel: true,
      headerJson: true,
      mappingJson: true,
    },
  });
  const fingerprint = oscarHeaderFingerprint(headers);
  const scored = jobs
    .map((job) => {
      const lessonHeaders = asHeaders(job.headerJson);
      const columns = asColumns(job.mappingJson);
      if (lessonHeaders.length === 0 || Object.keys(columns).length === 0) return null;
      const score = oscarHeaderJaccard(headers, lessonHeaders);
      if (score < 0.45) return null;
      return {
        jobId: job.id,
        filename: job.originalFilename,
        sourceLabel: job.sourceLabel,
        headers: lessonHeaders,
        columns,
        customFields: asCustomFields(job.mappingJson),
        score,
        exact: oscarHeaderFingerprint(lessonHeaders) === fingerprint,
      } satisfies OscarLesson;
    })
    .filter((v): v is OscarLesson => Boolean(v))
    .sort((a, b) => b.score - a.score || (b.exact === a.exact ? 0 : b.exact ? 1 : -1));
  return scored.slice(0, 8);
}

export type OscarSheetMemory = {
  shapeId: string;
  title: string;
  aliases: string[];
  headers: string[];
  columns: Record<string, ContactIntelFieldTarget>;
  customFields: ContactIntelCustomFieldDraft[];
  seen: number;
  taught: boolean;
  lastJobId: string;
  lastFilename: string;
  lastAt: string;
  jobs: { id: string; filename: string; sourceLabel: string | null; status: string; createdAt: string }[];
};

function mappingCounts(columns: Record<string, ContactIntelFieldTarget>) {
  const values = Object.values(columns);
  return {
    mapped: values.filter((t) => t !== "ignore").length,
    custom: values.filter((t) => t.startsWith("custom:")).length,
    ignored: values.filter((t) => t === "ignore").length,
  };
}

export function oscarMappingCounts(columns: Record<string, ContactIntelFieldTarget>) {
  return mappingCounts(columns);
}

export async function listOscarSheetMemory(): Promise<OscarSheetMemory[]> {
  const jobs = await prisma.contactIntelImportJob.findMany({
    where: { status: { in: ["PREVIEWED", "COMMITTED"] } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      originalFilename: true,
      sourceLabel: true,
      status: true,
      headerJson: true,
      mappingJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const groups = new Map<string, OscarSheetMemory>();
  for (const job of jobs) {
    const headers = asHeaders(job.headerJson);
    const columns = asColumns(job.mappingJson);
    if (headers.length === 0 || Object.keys(columns).length === 0) continue;
    const shapeId = oscarShapeId(headers);
    const title = job.sourceLabel?.trim() || job.originalFilename;
    const existing = groups.get(shapeId);
    const entry = {
      id: job.id,
      filename: job.originalFilename,
      sourceLabel: job.sourceLabel,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
    };
    if (!existing) {
      groups.set(shapeId, {
        shapeId,
        title,
        aliases: [title],
        headers,
        columns,
        customFields: asCustomFields(job.mappingJson),
        seen: 1,
        taught: true,
        lastJobId: job.id,
        lastFilename: job.originalFilename,
        lastAt: job.updatedAt.toISOString(),
        jobs: [entry],
      });
      continue;
    }
    existing.seen += 1;
    existing.jobs.push(entry);
    if (title && !existing.aliases.includes(title)) existing.aliases.push(title);
  }
  return [...groups.values()].sort((a, b) => b.seen - a.seen || b.lastAt.localeCompare(a.lastAt));
}

export async function getOscarSheetMemory(shapeId: string): Promise<OscarSheetMemory | null> {
  const all = await listOscarSheetMemory();
  return all.find((item) => item.shapeId === shapeId) ?? null;
}
