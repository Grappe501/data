import {
  CONTACT_INTEL_FIELD_TARGETS,
  guessContactIntelTarget,
  parseContactIntelTarget,
  type ContactIntelCustomFieldDraft,
  type ContactIntelFieldTarget,
  type ContactIntelMapping,
} from "@/lib/contact-intel/mapping";
import { normalizeCustomFieldKey } from "@/lib/contact-intel/enrichment";
import { findOscarLessons, type OscarLesson } from "@/lib/contact-intel/oscar-lessons";
import { normalizeOscarHeader, oscarValueShape } from "@/lib/contact-intel/oscar-headers";

export type OscarMode = "recognized" | "proposed" | "needs_you";
export type OscarSource = "lesson" | "openai" | "heuristic" | "operator";

export type OscarReport = {
  version: 1;
  agent: "Oscar";
  mode: OscarMode;
  needsReview: boolean;
  autoApply: boolean;
  confidence: number;
  source: OscarSource;
  summary: string;
  unknownHeaders: string[];
  columnNotes: Record<string, string>;
  similarJobId?: string;
  similarFilename?: string;
  similarScore?: number;
  openaiUsed: boolean;
  learnedFromOperator?: boolean;
  learnedAt?: string;
};

export type OscarProposal = {
  mapping: ContactIntelMapping;
  report: OscarReport;
};

export type OscarCustomField = { key: string; label: string };

const JUNK_HEADER =
  /^(id|row|row.?id|rownum|row_number|#|unnamed(:\s*\d+)?|index|n\/a|na)$/i;

function uniqueShapes(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const shape = oscarValueShape(value);
    if (seen.has(shape)) continue;
    seen.add(shape);
    out.push(shape);
  }
  return out.slice(0, 4);
}

function isJunkHeader(header: string, shapes: string[]): boolean {
  if (JUNK_HEADER.test(header.trim())) return true;
  return shapes.length > 0 && shapes.every((s) => s === "empty");
}

function lessonTargetForHeader(header: string, lesson: OscarLesson): ContactIntelFieldTarget | null {
  const want = normalizeOscarHeader(header);
  for (const [from, target] of Object.entries(lesson.columns)) {
    if (normalizeOscarHeader(from) === want) return parseContactIntelTarget(target);
  }
  return null;
}

function mergeCustomFields(mapping: ContactIntelMapping): ContactIntelCustomFieldDraft[] {
  const seen = new Set<string>();
  const out: ContactIntelCustomFieldDraft[] = [];
  for (const draft of mapping.customFields ?? []) {
    const key = normalizeCustomFieldKey(draft.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: draft.label.trim() || key, type: "TEXT" });
  }
  for (const target of Object.values(mapping.columns)) {
    if (!target.startsWith("custom:")) continue;
    const key = normalizeCustomFieldKey(target.slice(7));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: key.replace(/_/g, " "), type: "TEXT" });
  }
  return out;
}

function heuristicMapping(
  headers: string[],
  shapesByHeader: Record<string, string[]>,
  existing: OscarCustomField[],
): ContactIntelMapping {
  const existingByKey = new Map(existing.map((f) => [f.key, f]));
  const columns: Record<string, ContactIntelFieldTarget> = {};
  const customFields: ContactIntelCustomFieldDraft[] = [];
  const seen = new Set<string>();
  for (const header of headers) {
    const guessed = guessContactIntelTarget(header);
    const shapes = shapesByHeader[header] ?? [];
    if (guessed !== "ignore") {
      columns[header] = guessed;
      continue;
    }
    if (isJunkHeader(header, shapes)) {
      columns[header] = "ignore";
      continue;
    }
    const key = normalizeCustomFieldKey(header);
    if (!key) {
      columns[header] = "ignore";
      continue;
    }
    const known = existingByKey.get(key);
    columns[header] = `custom:${key}`;
    if (!seen.has(key)) {
      customFields.push({ key, label: known?.label || header.trim() || key, type: "TEXT" });
      seen.add(key);
    }
  }
  return { columns, customFields };
}

function applyLesson(headers: string[], lesson: OscarLesson, fallback: ContactIntelMapping): ContactIntelMapping {
  const columns: Record<string, ContactIntelFieldTarget> = {};
  const customFields = [...(fallback.customFields ?? [])];
  const seen = new Set(customFields.map((f) => f.key));
  for (const header of headers) {
    const fromLesson = lessonTargetForHeader(header, lesson);
    if (fromLesson) {
      columns[header] = fromLesson;
      if (fromLesson.startsWith("custom:")) {
        const key = normalizeCustomFieldKey(fromLesson.slice(7));
        const draft = lesson.customFields.find((f) => f.key === key);
        if (key && !seen.has(key)) {
          customFields.push({ key, label: draft?.label || key, type: "TEXT" });
          seen.add(key);
        }
      }
      continue;
    }
    columns[header] = fallback.columns[header] ?? "ignore";
  }
  return { columns, customFields: mergeCustomFields({ columns, customFields }) };
}

type OpenAiColumn = {
  header: string;
  target: string;
  customKey?: string;
  customLabel?: string;
  note?: string;
  unknown?: boolean;
  confidence?: number;
};

async function askOpenAiOscar(input: {
  filename: string;
  sourceLabel: string | null;
  headers: string[];
  shapesByHeader: Record<string, string[]>;
  existing: OscarCustomField[];
  lessons: OscarLesson[];
}): Promise<{ columns: OpenAiColumn[]; summary: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const payload = {
    filename: input.filename,
    sourceLabel: input.sourceLabel,
    columns: input.headers.map((header) => ({ header, shapes: input.shapesByHeader[header] ?? [] })),
    existingCustomFields: input.existing,
    learnedSheets: input.lessons.slice(0, 6).map((lesson) => ({
      filename: lesson.filename,
      sourceLabel: lesson.sourceLabel,
      headers: lesson.headers,
      columns: lesson.columns,
    })),
    allowedTargets: [...CONTACT_INTEL_FIELD_TARGETS, "custom"],
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are Oscar, the Contact Intelligence mapping agent. Identity keys are email and/or phone only. Names never merge people. Map every informative column. Use ignore only for empty, row-index, or true identifier junk. Prefer existing custom field keys when the meaning matches. Never invent email/phone mappings unless the header or shapes clearly match. Reply with JSON {summary, columns:[{header,target,customKey,customLabel,note,unknown,confidence}]}.",
          },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { summary?: unknown; columns?: unknown };
    if (!Array.isArray(parsed.columns)) return null;
    const columns = parsed.columns
      .map((item): OpenAiColumn | null => {
        if (!item || typeof item !== "object") return null;
        const rec = item as Record<string, unknown>;
        if (typeof rec.header !== "string" || typeof rec.target !== "string") return null;
        return {
          header: rec.header,
          target: rec.target,
          customKey: typeof rec.customKey === "string" ? rec.customKey : undefined,
          customLabel: typeof rec.customLabel === "string" ? rec.customLabel : undefined,
          note: typeof rec.note === "string" ? rec.note : undefined,
          unknown: rec.unknown === true,
          confidence: typeof rec.confidence === "number" ? rec.confidence : undefined,
        };
      })
      .filter((v): v is OpenAiColumn => Boolean(v));
    return { columns, summary: typeof parsed.summary === "string" ? parsed.summary : "Oscar proposed a mapping." };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function applyOpenAiColumns(
  headers: string[],
  ai: OpenAiColumn[],
  fallback: ContactIntelMapping,
  existing: OscarCustomField[],
): { mapping: ContactIntelMapping; unknownHeaders: string[]; columnNotes: Record<string, string> } {
  const byHeader = new Map(ai.map((col) => [normalizeOscarHeader(col.header), col]));
  const columns: Record<string, ContactIntelFieldTarget> = {};
  const customFields: ContactIntelCustomFieldDraft[] = [];
  const seen = new Set<string>();
  const unknownHeaders: string[] = [];
  const columnNotes: Record<string, string> = {};
  const existingByKey = new Map(existing.map((f) => [f.key, f]));

  for (const header of headers) {
    const col = byHeader.get(normalizeOscarHeader(header));
    if (col?.note) columnNotes[header] = col.note;
    if (!col) {
      columns[header] = fallback.columns[header] ?? "ignore";
      if ((fallback.columns[header] ?? "ignore") === "ignore" && !isJunkHeader(header, [])) {
        unknownHeaders.push(header);
      }
      continue;
    }
    if (col.unknown) unknownHeaders.push(header);
    if (col.target === "custom") {
      const key = normalizeCustomFieldKey(col.customKey || header);
      if (!key) {
        columns[header] = "ignore";
        unknownHeaders.push(header);
        continue;
      }
      columns[header] = `custom:${key}`;
      if (!seen.has(key)) {
        customFields.push({
          key,
          label: col.customLabel?.trim() || existingByKey.get(key)?.label || header.trim() || key,
          type: "TEXT",
        });
        seen.add(key);
      }
      continue;
    }
    const target = parseContactIntelTarget(col.target);
    if (target === "ignore" && col.target !== "ignore") {
      columns[header] = fallback.columns[header] ?? "ignore";
      unknownHeaders.push(header);
      continue;
    }
    columns[header] = target;
  }
  return { mapping: { columns, customFields: mergeCustomFields({ columns, customFields }) }, unknownHeaders, columnNotes };
}

export function readOscarReport(previewJson: unknown): OscarReport | null {
  if (!previewJson || typeof previewJson !== "object") return null;
  const raw = (previewJson as { oscar?: unknown }).oscar;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Partial<OscarReport>;
  if (rec.agent !== "Oscar" || rec.version !== 1) return null;
  if (rec.mode !== "recognized" && rec.mode !== "proposed" && rec.mode !== "needs_you") return null;
  return {
    version: 1,
    agent: "Oscar",
    mode: rec.mode,
    needsReview: rec.needsReview === true,
    autoApply: rec.autoApply === true,
    confidence: typeof rec.confidence === "number" ? rec.confidence : 0,
    source: rec.source === "lesson" || rec.source === "openai" || rec.source === "operator" ? rec.source : "heuristic",
    summary: typeof rec.summary === "string" ? rec.summary : "",
    unknownHeaders: Array.isArray(rec.unknownHeaders) ? rec.unknownHeaders.map(String) : [],
    columnNotes: rec.columnNotes && typeof rec.columnNotes === "object" ? (rec.columnNotes as Record<string, string>) : {},
    similarJobId: typeof rec.similarJobId === "string" ? rec.similarJobId : undefined,
    similarFilename: typeof rec.similarFilename === "string" ? rec.similarFilename : undefined,
    similarScore: typeof rec.similarScore === "number" ? rec.similarScore : undefined,
    openaiUsed: rec.openaiUsed === true,
    learnedFromOperator: rec.learnedFromOperator === true,
    learnedAt: typeof rec.learnedAt === "string" ? rec.learnedAt : undefined,
  };
}

export function markOscarLearned(previewJson: unknown, mapping: ContactIntelMapping): Record<string, unknown> {
  const prior = previewJson && typeof previewJson === "object" && !Array.isArray(previewJson)
    ? (previewJson as Record<string, unknown>)
    : {};
  const oscar = readOscarReport(prior) ?? {
    version: 1 as const,
    agent: "Oscar" as const,
    mode: "proposed" as const,
    needsReview: false,
    autoApply: false,
    confidence: 1,
    source: "operator" as const,
    summary: "You confirmed this mapping. Oscar will reuse it on similar sheets.",
    unknownHeaders: [],
    columnNotes: {},
    openaiUsed: false,
  };
  return {
    ...prior,
    oscar: {
      ...oscar,
      mode: "recognized",
      needsReview: false,
      source: "operator",
      learnedFromOperator: true,
      learnedAt: new Date().toISOString(),
      summary: oscar.summary || "You confirmed this mapping. Oscar will reuse it on similar sheets.",
      mappingColumns: mapping.columns,
    },
  };
}

export async function proposeOscarMapping(input: {
  filename: string;
  sourceLabel?: string | null;
  headers: string[];
  sampleRows: Record<string, string>[];
  existingCustomFields: OscarCustomField[];
}): Promise<OscarProposal> {
  const shapesByHeader: Record<string, string[]> = {};
  for (const header of input.headers) {
    shapesByHeader[header] = uniqueShapes(input.sampleRows.map((row) => String(row[header] ?? "")));
  }
  const fallback = heuristicMapping(input.headers, shapesByHeader, input.existingCustomFields);
  const lessons = await findOscarLessons(input.headers);
  const best = lessons[0] ?? null;
  const score = best?.score ?? 0;
  const exact = Boolean(best?.exact);
  const leftover = best
    ? input.headers.filter((header) => !lessonTargetForHeader(header, best))
    : input.headers;

  if (best && (exact || score >= 0.8) && leftover.length === 0) {
    const mapping = applyLesson(input.headers, best, fallback);
    return {
      mapping,
      report: {
        version: 1,
        agent: "Oscar",
        mode: "recognized",
        needsReview: false,
        autoApply: exact || score >= 0.95,
        confidence: exact ? 0.99 : score,
        source: "lesson",
        summary: `Oscar recognized a sheet like ${best.filename} and assigned the learned mapping.`,
        unknownHeaders: [],
        columnNotes: Object.fromEntries(input.headers.map((header) => [header, `Learned from ${best.filename}`])),
        similarJobId: best.jobId,
        similarFilename: best.filename,
        similarScore: score,
        openaiUsed: false,
      },
    };
  }

  const openai = await askOpenAiOscar({
    filename: input.filename,
    sourceLabel: input.sourceLabel ?? null,
    headers: leftover.length && best && score >= 0.8 ? leftover : input.headers,
    shapesByHeader,
    existing: input.existingCustomFields,
    lessons,
  });

  if (best && score >= 0.8) {
    const lessonMapping = applyLesson(input.headers, best, fallback);
    if (openai) {
      const extra = applyOpenAiColumns(leftover, openai.columns, fallback, input.existingCustomFields);
      const columns = { ...lessonMapping.columns, ...extra.mapping.columns };
      const mapping = { columns, customFields: mergeCustomFields({ columns, customFields: [...(lessonMapping.customFields ?? []), ...(extra.mapping.customFields ?? [])] }) };
      const unknownHeaders = extra.unknownHeaders;
      const needsReview = unknownHeaders.length > 0;
      return {
        mapping,
        report: {
          version: 1,
          agent: "Oscar",
          mode: needsReview ? "needs_you" : "proposed",
          needsReview,
          autoApply: !needsReview && score >= 0.95,
          confidence: needsReview ? Math.min(score, 0.7) : score,
          source: "openai",
          summary: needsReview
            ? `Oscar recognized most of this sheet from ${best.filename}, but needs you on: ${unknownHeaders.join(", ")}.`
            : `Oscar recognized a sheet like ${best.filename} and filled the new columns.`,
          unknownHeaders,
          columnNotes: { ...Object.fromEntries(input.headers.map((h) => [h, `Learned from ${best.filename}`])), ...extra.columnNotes },
          similarJobId: best.jobId,
          similarFilename: best.filename,
          similarScore: score,
          openaiUsed: true,
        },
      };
    }
    const unknownHeaders = leftover.filter((header) => (lessonMapping.columns[header] ?? "ignore") === "ignore" && !isJunkHeader(header, shapesByHeader[header] ?? []));
    const needsReview = unknownHeaders.length > 0;
    return {
      mapping: lessonMapping,
      report: {
        version: 1,
        agent: "Oscar",
        mode: needsReview ? "needs_you" : "proposed",
        needsReview,
        autoApply: false,
        confidence: score,
        source: "lesson",
        summary: needsReview
          ? `Oscar recognized a similar sheet (${best.filename}) but needs you to assign: ${unknownHeaders.join(", ")}.`
          : `Oscar applied a learned mapping from ${best.filename}. Review, then apply preview.`,
        unknownHeaders,
        columnNotes: Object.fromEntries(input.headers.map((header) => [header, leftover.includes(header) ? "New column on a known sheet" : `Learned from ${best.filename}`])),
        similarJobId: best.jobId,
        similarFilename: best.filename,
        similarScore: score,
        openaiUsed: false,
      },
    };
  }

  if (openai) {
    const applied = applyOpenAiColumns(input.headers, openai.columns, fallback, input.existingCustomFields);
    const unknownHeaders = applied.unknownHeaders;
    const needsReview = unknownHeaders.length > 0;
    return {
      mapping: applied.mapping,
      report: {
        version: 1,
        agent: "Oscar",
        mode: needsReview ? "needs_you" : "proposed",
        needsReview,
        autoApply: false,
        confidence: needsReview ? 0.45 : 0.75,
        source: "openai",
        summary: needsReview
          ? `Oscar has not seen this sheet before and needs you on: ${unknownHeaders.join(", ")}.`
          : openai.summary || "Oscar proposed mappings, including custom fields for extra columns. Review, then apply preview so he can learn.",
        unknownHeaders,
        columnNotes: applied.columnNotes,
        openaiUsed: true,
      },
    };
  }

  const unknownHeaders = input.headers.filter((header) => {
    const target = fallback.columns[header] ?? "ignore";
    return target === "ignore" && !isJunkHeader(header, shapesByHeader[header] ?? []);
  });
  const informativeIgnore = unknownHeaders.length;
  return {
    mapping: fallback,
    report: {
      version: 1,
      agent: "Oscar",
      mode: informativeIgnore > 0 || !process.env.OPENAI_API_KEY?.trim() ? "needs_you" : "proposed",
      needsReview: true,
      autoApply: false,
      confidence: 0.35,
      source: "heuristic",
      summary: process.env.OPENAI_API_KEY?.trim()
        ? `First time seeing this sheet. Oscar guessed from column names. Confirm the mapping so he can learn it.`
        : "Oscar could not reach OpenAI. Confirm the mapping so he can learn this sheet.",
      unknownHeaders,
      columnNotes: Object.fromEntries(
        input.headers.map((header) => [
          header,
          (fallback.columns[header] ?? "ignore").startsWith("custom:")
            ? "Oscar will create a custom field for this column"
            : "Guessed from the column name",
        ]),
      ),
      openaiUsed: false,
    },
  };
}

export function oscarHasIdentity(mapping: ContactIntelMapping): boolean {
  return Object.values(mapping.columns).some((target) => target === "email" || target === "phone");
}

