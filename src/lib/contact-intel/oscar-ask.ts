import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { normalizeCustomFieldKey } from "@/lib/contact-intel/enrichment";
import { findOscarQueryLesson, rememberOscarLesson } from "@/lib/contact-intel/oscar-memory";

export type OscarAskIntent = "people" | "catalog";
export type OscarAskCatalog = "custom_fields" | "tags" | "sheets";
export type OscarAskVoter = "unmatched" | "matched" | "no_match" | "needs_review";

export type OscarAskPlan = {
  intent: OscarAskIntent;
  catalog?: OscarAskCatalog;
  hasEmail?: boolean;
  missingEmail?: boolean;
  hasPhone?: boolean;
  missingPhone?: boolean;
  hasAddress?: boolean;
  missingAddress?: boolean;
  tag?: string;
  city?: string;
  state?: string;
  zip?: string;
  source?: string;
  customField?: string;
  customValue?: string;
  voter?: OscarAskVoter;
  nameContains?: string;
  summary: string;
  sourceKind: "heuristic" | "openai";
};

export type OscarAskCatalogRow = { kind: string; key: string; label: string; extra?: string };

const personInclude = {
  methods: { orderBy: { createdAt: "asc" as const } },
  voterMatch: true,
  addresses: { take: 3, orderBy: { createdAt: "desc" as const } },
  personTags: { include: { tag: true }, take: 8 },
  sourceRows: {
    take: 3,
    orderBy: { createdAt: "desc" as const },
    include: { job: { select: { originalFilename: true, sourceLabel: true } } },
  },
} satisfies Prisma.ContactIntelPersonInclude;

function quotedChunks(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"|'([^']+)'/g)].map((m) => (m[1] || m[2] || "").trim()).filter(Boolean);
}

function afterKeyword(text: string, pattern: RegExp): string | undefined {
  const m = text.match(pattern);
  const raw = m?.[1]?.trim();
  if (!raw) return undefined;
  return raw.replace(/[.,;]+$/, "").trim() || undefined;
}

export function parseOscarAskHeuristic(question: string): OscarAskPlan {
  const q = question.trim();
  const lower = q.toLowerCase();
  const quotes = quotedChunks(q);

  if (/\b(custom fields?|what fields|which fields|field catalog)\b/.test(lower)) {
    return { intent: "catalog", catalog: "custom_fields", summary: "Oscar will list every custom field we have created.", sourceKind: "heuristic" };
  }
  if (/\b(tags? we have|what tags|which tags|tag catalog)\b/.test(lower)) {
    return { intent: "catalog", catalog: "tags", summary: "Oscar will list every tag in the library.", sourceKind: "heuristic" };
  }
  if (/\b(sheets?|imports?|files? we (have|know)|what (sheets|files))\b/.test(lower) && /\b(list|show|what|which|catalog)\b/.test(lower)) {
    return { intent: "catalog", catalog: "sheets", summary: "Oscar will list the sheets he has seen.", sourceKind: "heuristic" };
  }

  const plan: OscarAskPlan = {
    intent: "people",
    summary: q,
    sourceKind: "heuristic",
  };

  if (/\b(no|without|missing|don't have|do not have)\b.{0,20}\bphones?\b/.test(lower) || /\bphones?\b.{0,12}\b(missing|none)\b/.test(lower)) {
    plan.missingPhone = true;
  } else if (/\b(with|has|have)\b.{0,12}\bphones?\b/.test(lower)) {
    plan.hasPhone = true;
  }
  if (/\b(no|without|missing|don't have|do not have)\b.{0,20}\bemails?\b/.test(lower)) {
    plan.missingEmail = true;
  } else if (/\b(with|has|have)\b.{0,12}\bemails?\b/.test(lower)) {
    plan.hasEmail = true;
  }
  if (/\b(no|without|missing)\b.{0,20}\b(address|street)\b/.test(lower)) {
    plan.missingAddress = true;
  } else if (/\b(with|has|have)\b.{0,16}\b(address|street)\b/.test(lower)) {
    plan.hasAddress = true;
  }

  if (/\bunmatched\b|\bno voter\b|\bneed(s)? (a )?voter\b|\bwithout (a )?voter id\b/.test(lower)) plan.voter = "unmatched";
  else if (/\bno match\b/.test(lower)) plan.voter = "no_match";
  else if (/\bneeds review\b/.test(lower)) plan.voter = "needs_review";
  else if (/\bmatched\b|\bhas (a )?voter id\b/.test(lower)) plan.voter = "matched";

  plan.tag = afterKeyword(lower, /\btagged\s+([a-z0-9 _-]{2,40})/) || afterKeyword(lower, /\btag(?:ged)?\s+([a-z0-9 _-]{2,40})/);
  plan.city = afterKeyword(q, /\bin\s+([A-Za-z .'-]{2,40})(?:\s+(?:with|and|who|that|from)|$)/i) || afterKeyword(q, /\bcity\s+([A-Za-z .'-]{2,40})/i);
  if (plan.city && /^(the|a|an)$/i.test(plan.city)) plan.city = undefined;
  plan.state = afterKeyword(q, /\bstate\s+([A-Za-z]{2,20})/i);
  plan.zip = afterKeyword(q, /\bzip(?:\s*code)?\s+(\d{5}(?:-\d{4})?)/i);
  plan.source =
    quotes[0] ||
    afterKeyword(q, /\bfrom\s+(?:the\s+)?(.+?)\s+sheet\b/i) ||
    afterKeyword(q, /\bsheet\s+(?:called\s+)?(.+?)(?:\s+with|\s+and|\s+who|$)/i) ||
    afterKeyword(q, /\bimport(?:ed)?\s+(?:from\s+)?(.+?)(?:\s+with|\s+and|$)/i);

  const customHint = afterKeyword(lower, /\b(?:with|has|have|and)\s+(?:an?\s+)?([a-z0-9 _-]{2,40})\b/);
  if (customHint && !/^(email|phone|address|tag|voter|sheet|file|name|city|state|zip)$/.test(customHint)) {
    if (/\b(employer|occupation|church|precinct|party|notes?|company|org)\b/.test(customHint) || /\bcustom\b/.test(lower)) {
      plan.customField = customHint;
    }
  }
  if (/\bemployer\b/.test(lower)) plan.customField = plan.customField || "employer";

  const parts = [
    plan.source ? `from sheet like “${plan.source}”` : null,
    plan.tag ? `tagged ${plan.tag}` : null,
    plan.city ? `in ${plan.city}` : null,
    plan.customField ? `with ${plan.customField}` : null,
    plan.missingPhone ? "missing phone" : plan.hasPhone ? "has phone" : null,
    plan.missingEmail ? "missing email" : plan.hasEmail ? "has email" : null,
    plan.voter ? `voter ${plan.voter.replace("_", " ")}` : null,
  ].filter(Boolean);
  plan.summary = parts.length ? `Oscar heard: ${parts.join(", ")}.` : `Oscar will search people for “${q}”.`;
  if (!parts.length) plan.nameContains = q;
  return plan;
}

async function loadAskCatalog() {
  const [fields, tags, jobs] = await Promise.all([
    prisma.contactIntelCustomFieldDefinition.findMany({ where: { active: true }, select: { key: true, label: true }, take: 80 }),
    prisma.contactIntelTag.findMany({ select: { key: true, name: true }, take: 80, orderBy: { name: "asc" } }),
    prisma.contactIntelImportJob.findMany({
      select: { originalFilename: true, sourceLabel: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);
  return { fields, tags, jobs };
}

async function parseOscarAskOpenAi(question: string, catalog: Awaited<ReturnType<typeof loadAskCatalog>>): Promise<OscarAskPlan | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are Oscar. Turn an operator question into a library filter. Never ask for PII. Use only the provided catalogs for tags, custom fields, and sheet names. Reply JSON {intent:'people'|'catalog', catalog?:'custom_fields'|'tags'|'sheets', hasEmail?, missingEmail?, hasPhone?, missingPhone?, hasAddress?, missingAddress?, tag?, city?, state?, zip?, source?, customField?, customValue?, voter?:'unmatched'|'matched'|'no_match'|'needs_review', nameContains?, summary}.",
          },
          {
            role: "user",
            content: JSON.stringify({
              question,
              customFields: catalog.fields,
              tags: catalog.tags,
              sheets: catalog.jobs.map((j) => ({ filename: j.originalFilename, label: j.sourceLabel })),
            }),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const intent = parsed.intent === "catalog" ? "catalog" : "people";
    const catalogKind =
      parsed.catalog === "custom_fields" || parsed.catalog === "tags" || parsed.catalog === "sheets" ? parsed.catalog : undefined;
    const voter =
      parsed.voter === "unmatched" || parsed.voter === "matched" || parsed.voter === "no_match" || parsed.voter === "needs_review"
        ? parsed.voter
        : undefined;
    return {
      intent,
      catalog: catalogKind,
      hasEmail: parsed.hasEmail === true,
      missingEmail: parsed.missingEmail === true,
      hasPhone: parsed.hasPhone === true,
      missingPhone: parsed.missingPhone === true,
      hasAddress: parsed.hasAddress === true,
      missingAddress: parsed.missingAddress === true,
      tag: typeof parsed.tag === "string" ? parsed.tag : undefined,
      city: typeof parsed.city === "string" ? parsed.city : undefined,
      state: typeof parsed.state === "string" ? parsed.state : undefined,
      zip: typeof parsed.zip === "string" ? parsed.zip : undefined,
      source: typeof parsed.source === "string" ? parsed.source : undefined,
      customField: typeof parsed.customField === "string" ? parsed.customField : undefined,
      customValue: typeof parsed.customValue === "string" ? parsed.customValue : undefined,
      voter,
      nameContains: typeof parsed.nameContains === "string" ? parsed.nameContains : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : "Oscar applied a filter.",
      sourceKind: "openai",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function planOscarAsk(question: string): Promise<OscarAskPlan> {
  const learned = await findOscarQueryLesson(question);
  const raw = learned?.payloadJson;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { intent?: unknown }).intent) {
    const plan = raw as OscarAskPlan;
    if (plan.intent === "people" || plan.intent === "catalog") {
      return { ...plan, summary: `${plan.summary} Oscar reused a learned question.` };
    }
  }
  const heuristic = parseOscarAskHeuristic(question);
  const catalog = await loadAskCatalog();
  const ai = await parseOscarAskOpenAi(question, catalog);
  return ai ?? heuristic;
}

function contains(value: string): Prisma.StringFilter {
  return { contains: value, mode: "insensitive" };
}

export async function runOscarAsk(question: string, take = 100) {
  const plan = await planOscarAsk(question);
  if (plan.intent === "catalog") {
    const rows = await loadOscarCatalog(plan.catalog ?? "custom_fields");
    await rememberOscarLesson({ kind: "query", key: question, label: plan.summary, payload: plan });
    return { plan, people: [], catalog: rows, total: rows.length };
  }

  const and: Prisma.ContactIntelPersonWhereInput[] = [];
  if (plan.hasEmail) and.push({ methods: { some: { kind: "EMAIL" } } });
  if (plan.missingEmail) and.push({ methods: { none: { kind: "EMAIL" } } });
  if (plan.hasPhone) and.push({ methods: { some: { kind: "PHONE" } } });
  if (plan.missingPhone) and.push({ methods: { none: { kind: "PHONE" } } });
  if (plan.hasAddress) and.push({ addresses: { some: {} } });
  if (plan.missingAddress) and.push({ addresses: { none: {} } });
  if (plan.tag) {
    and.push({
      personTags: {
        some: { tag: { OR: [{ name: contains(plan.tag) }, { key: contains(normalizeCustomFieldKey(plan.tag) || plan.tag) }] } },
      },
    });
  }
  if (plan.city) and.push({ addresses: { some: { city: contains(plan.city) } } });
  if (plan.state) and.push({ addresses: { some: { state: contains(plan.state) } } });
  if (plan.zip) and.push({ addresses: { some: { postalCode: contains(plan.zip) } } });
  if (plan.source) {
    and.push({
      sourceRows: {
        some: {
          job: { OR: [{ originalFilename: contains(plan.source) }, { sourceLabel: contains(plan.source) }] },
        },
      },
    });
  }
  if (plan.customField) {
    const key = normalizeCustomFieldKey(plan.customField) || plan.customField;
    const valueFilter = plan.customValue
      ? { OR: [{ originalValue: contains(plan.customValue) }, { normalizedValue: contains(plan.customValue) }] }
      : {};
    and.push({
      customValues: {
        some: {
          ...valueFilter,
          definition: { OR: [{ key: contains(key) }, { label: contains(plan.customField) }] },
        },
      },
    });
  }
  if (plan.voter === "matched") and.push({ voterMatch: { status: "MATCHED" } });
  if (plan.voter === "no_match") and.push({ voterMatch: { status: "NO_MATCH" } });
  if (plan.voter === "needs_review") and.push({ voterMatch: { status: "NEEDS_REVIEW" } });
  if (plan.voter === "unmatched") {
    and.push({ OR: [{ voterMatch: null }, { voterMatch: { status: { in: ["UNMATCHED", "NEEDS_REVIEW"] } } }] });
  }
  if (plan.nameContains) {
    and.push({
      OR: [
        { displayName: contains(plan.nameContains) },
        { firstName: contains(plan.nameContains) },
        { lastName: contains(plan.nameContains) },
        { methods: { some: { OR: [{ originalValue: contains(plan.nameContains) }, { normalizedValue: contains(plan.nameContains) }] } } },
      ],
    });
  }

  const where: Prisma.ContactIntelPersonWhereInput = and.length ? { AND: and } : {};
  const [people, total] = await Promise.all([
    prisma.contactIntelPerson.findMany({
      where,
      take,
      orderBy: { updatedAt: "desc" },
      include: personInclude,
    }),
    prisma.contactIntelPerson.count({ where }),
  ]);
  await rememberOscarLesson({ kind: "query", key: question, label: plan.summary, payload: plan });
  return { plan, people, catalog: [] as OscarAskCatalogRow[], total };
}

async function loadOscarCatalog(kind: OscarAskCatalog): Promise<OscarAskCatalogRow[]> {
  if (kind === "custom_fields") {
    const rows = await prisma.contactIntelCustomFieldDefinition.findMany({
      where: { active: true },
      orderBy: { label: "asc" },
      include: { _count: { select: { values: true } } },
    });
    return rows.map((r) => ({ kind: "custom field", key: r.key, label: r.label, extra: `${r._count.values} people` }));
  }
  if (kind === "tags") {
    const rows = await prisma.contactIntelTag.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { people: true } } },
    });
    return rows.map((r) => ({ kind: "tag", key: r.key, label: r.name, extra: `${r._count.people} people` }));
  }
  const rows = await prisma.contactIntelImportJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 80,
    include: { _count: { select: { rows: true } } },
  });
  return rows.map((r) => ({
    kind: "sheet",
    key: r.id,
    label: r.sourceLabel || r.originalFilename,
    extra: `${r.originalFilename} · ${r.status} · ${r._count.rows} rows`,
  }));
}
