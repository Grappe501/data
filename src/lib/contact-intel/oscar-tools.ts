import { prisma } from "@/lib/db";
import { runOscarAsk } from "@/lib/contact-intel/oscar-ask";
import { listOscarSheetMemory } from "@/lib/contact-intel/oscar-lessons";
import { bumpOscarToolUse, findOscarQueryLesson, rememberOscarLesson } from "@/lib/contact-intel/oscar-memory";
import { CONTACT_INTEL_REVIEW_TAG } from "@/lib/contact-intel/working-set";
import { normalizeContactIntelTagKey } from "@/lib/contact-intel/enrichment";
import { guessContactIntelTarget } from "@/lib/contact-intel/mapping";

export type OscarToolId =
  | "ask"
  | "next"
  | "memory"
  | "audit"
  | "conflicts"
  | "voters"
  | "review"
  | "brief"
  | "router";

export type OscarToolDef = {
  id: OscarToolId;
  name: string;
  blurb: string;
  grows: string;
  href: string;
};

export type OscarActionItem = {
  title: string;
  count: number;
  href: string;
  why: string;
};

export type OscarToolResult = {
  tool: OscarToolId;
  title: string;
  summary: string;
  actions: OscarActionItem[];
  lines: string[];
  askHref?: string;
};

export const OSCAR_TOOLS: OscarToolDef[] = [
  { id: "next", name: "Next actions", blurb: "What to do right now across queues.", grows: "Every cleared queue item sharpens the next briefing.", href: "/oscar?tool=next" },
  { id: "ask", name: "Ask the library", blurb: "Turn a sentence into a people list or catalog.", grows: "Each question becomes a reusable query lesson.", href: "/oscar?tool=ask" },
  { id: "memory", name: "Sheet memory", blurb: "Spreadsheet shapes Oscar already knows.", grows: "One confirmed mapping teaches every later file.", href: "/memory" },
  { id: "audit", name: "Field audit", blurb: "Ignored columns and unused custom fields.", grows: "Fixes become the next mapping lesson.", href: "/oscar?tool=audit" },
  { id: "conflicts", name: "Conflict watch", blurb: "Identifier fights and same-name lookalikes.", grows: "Your keep-both decisions train the desk notes.", href: "/review/dedupe" },
  { id: "voters", name: "Voter ladder", blurb: "Who still needs a voter ID, state down.", grows: "Attached IDs unlock voter-type scoring later.", href: "/review/voters" },
  { id: "review", name: "Review set", blurb: "People you parked from a working set.", grows: "Tags turn questions into standing work.", href: "/review/set" },
  { id: "brief", name: "Person brief", blurb: "A one-screen read of a contact file.", grows: "Briefs reuse identity scoring and sheet drawers.", href: "/oscar?tool=brief" },
];

function asHeaders(json: unknown): string[] {
  return Array.isArray(json) ? json.map((v) => String(v)).filter(Boolean) : [];
}

function asColumns(json: unknown): Record<string, string> {
  if (!json || typeof json !== "object") return {};
  const columns = (json as { columns?: Record<string, unknown> }).columns ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(columns)) if (typeof v === "string") out[k] = v;
  return out;
}

export function routeOscarCommand(question: string): OscarToolId {
  const q = question.trim().toLowerCase();
  if (!q) return "next";
  if (/\b(next|priorit|what should|to ?do|briefing|today)\b/.test(q)) return "next";
  if (/\b(memory|shapes?|knows this sheet|learned sheets?)\b/.test(q)) return "memory";
  if (/\b(audit|ignored|custom field|unmapped|gap)\b/.test(q)) return "audit";
  if (/\b(conflict|dedupe|lookalike|same name)\b/.test(q)) return "conflicts";
  if (/\b(voter|registration|voter id)\b/.test(q)) return "voters";
  if (/\breview set\b|\bneeds review\b/.test(q)) return "review";
  if (/\b(brief|who is|tell me about|open the (desk|file) for)\b/.test(q)) return "brief";
  return "ask";
}

async function runNext(): Promise<OscarToolResult> {
  const reviewKey = normalizeContactIntelTagKey(CONTACT_INTEL_REVIEW_TAG);
  const [needsYou, conflicts, unmatched, review, thin, memories] = await Promise.all([
    prisma.contactIntelImportJob.count({ where: { status: "UPLOADED" } }),
    prisma.contactIntelConflict.count({ where: { status: "OPEN" } }),
    prisma.contactIntelPerson.count({
      where: { OR: [{ voterMatch: null }, { voterMatch: { status: { in: ["UNMATCHED", "NEEDS_REVIEW"] } } }] },
    }),
    prisma.contactIntelPerson.count({ where: { personTags: { some: { tag: { key: reviewKey } } } } }),
    prisma.contactIntelPerson.count({
      where: { AND: [{ addresses: { none: {} } }, { voterMatch: null }] },
    }),
    listOscarSheetMemory(),
  ]);
  const actions: OscarActionItem[] = [
    { title: "Imports waiting on Oscar or you", count: needsYou, href: "/import", why: "Unmapped uploads block the library." },
    { title: "Identifier conflicts", count: conflicts, href: "/review/dedupe", why: "Email and phone already belong to two people." },
    { title: "Need a voter ID", count: unmatched, href: "/review/voters", why: "Search state → city → ZIP → name." },
    { title: "Parked in review", count: review, href: "/review/set", why: "Working sets you marked for later." },
    { title: "Thin files (no address, no voter)", count: thin, href: "/?ask=people without an address", why: "Identity confidence stays low until the sheet is richer." },
    { title: "Sheet shapes in memory", count: memories.length, href: "/memory", why: "The more shapes he knows, the fewer first-time alerts." },
  ].filter((a) => a.count > 0 || a.title.startsWith("Sheet"));
  const top = actions.find((a) => a.count > 0);
  return {
    tool: "next",
    title: "Oscar’s next-action briefing",
    summary: top
      ? `Start with ${top.title.toLowerCase()} (${top.count}). Each finish makes the next briefing smaller.`
      : "Queues are clear. Upload a new sheet or ask the library a harder question.",
    actions,
    lines: actions.map((a) => `${a.count} · ${a.title} — ${a.why}`),
  };
}

async function runAudit(): Promise<OscarToolResult> {
  const jobs = await prisma.contactIntelImportJob.findMany({
    where: { status: { in: ["PREVIEWED", "COMMITTED"] } },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: { id: true, originalFilename: true, sourceLabel: true, headerJson: true, mappingJson: true },
  });
  const gaps: string[] = [];
  const actions: OscarActionItem[] = [];
  for (const job of jobs) {
    const headers = asHeaders(job.headerJson);
    const columns = asColumns(job.mappingJson);
    const ignored = headers.filter((h) => (columns[h] ?? "ignore") === "ignore" && guessContactIntelTarget(h) === "ignore");
    const informative = ignored.filter((h) => !/^(id|row|index|#)/i.test(h));
    if (informative.length === 0) continue;
    gaps.push(`${job.sourceLabel || job.originalFilename}: ${informative.slice(0, 6).join(", ")}`);
    actions.push({
      title: job.sourceLabel || job.originalFilename,
      count: informative.length,
      href: `/import/${job.id}`,
      why: `Ignored columns Oscar can turn into custom fields: ${informative.slice(0, 4).join(", ")}`,
    });
  }
  const unused = await prisma.contactIntelCustomFieldDefinition.findMany({
    where: { active: true, values: { none: {} } },
    select: { key: true, label: true },
    take: 20,
  });
  if (unused.length) {
    actions.push({
      title: "Custom fields with no values yet",
      count: unused.length,
      href: "/?ask=what custom fields do we have",
      why: unused.map((f) => f.label).join(", "),
    });
  }
  return {
    tool: "audit",
    title: "Field audit",
    summary: actions.length
      ? "These gaps are how Oscar grows: map them once and the next similar sheet inherits the fields."
      : "No ignored informative columns in the recent learned sheets.",
    actions: actions.slice(0, 16),
    lines: gaps.slice(0, 16),
  };
}

async function runConflicts(): Promise<OscarToolResult> {
  const open = await prisma.contactIntelConflict.count({ where: { status: "OPEN" } });
  return {
    tool: "conflicts",
    title: "Conflict watch",
    summary: open
      ? `${open} open identifier conflict${open === 1 ? "" : "s"}. Names never merge. Keep both people unless a source row is wrong.`
      : "No open identifier conflicts. Same-name lookalikes still stay on each desk.",
    actions: [{ title: "Open de-dupe queue", count: open, href: "/review/dedupe", why: "Foolproof rule: email and phone only." }],
    lines: [],
  };
}

async function runVoters(): Promise<OscarToolResult> {
  const unmatched = await prisma.contactIntelPerson.count({
    where: { OR: [{ voterMatch: null }, { voterMatch: { status: { in: ["UNMATCHED", "NEEDS_REVIEW"] } } }] },
  });
  const matched = await prisma.contactIntelVoterMatch.count({ where: { status: "MATCHED" } });
  return {
    tool: "voters",
    title: "Voter ladder",
    summary: `${unmatched} still need a voter ID. ${matched} already attached. Type scoring stays at 0% until the registration file is linked.`,
    actions: [
      { title: "Voter match queue", count: unmatched, href: "/review/voters", why: "State → city → ZIP → name." },
      { title: "Ask who still needs a voter ID", count: unmatched, href: "/?ask=who still needs a voter ID", why: "Turn the queue into a working set." },
    ],
    lines: [],
  };
}

async function runReview(): Promise<OscarToolResult> {
  const key = normalizeContactIntelTagKey(CONTACT_INTEL_REVIEW_TAG);
  const count = await prisma.contactIntelPerson.count({ where: { personTags: { some: { tag: { key } } } } });
  return {
    tool: "review",
    title: "Review set",
    summary: count ? `${count} people are tagged Needs review.` : "The review set is empty. Mark people from any Oscar list.",
    actions: [{ title: "Open review set", count, href: "/review/set", why: "Tag, export, or open desks. Nothing is sent." }],
    lines: [],
  };
}

async function runMemory(): Promise<OscarToolResult> {
  const memories = await listOscarSheetMemory();
  return {
    tool: "memory",
    title: "Sheet memory",
    summary: `Oscar knows ${memories.length} sheet shape${memories.length === 1 ? "" : "s"}. A first-time layout still needs you once.`,
    actions: memories.slice(0, 12).map((m) => ({
      title: m.title,
      count: m.seen,
      href: `/memory/${m.shapeId}`,
      why: `${m.headers.length} columns · last ${m.lastFilename}`,
    })),
    lines: [],
  };
}

async function runBrief(question: string): Promise<OscarToolResult> {
  const name = question.replace(/\b(brief|who is|tell me about|open the (desk|file) for)\b/gi, "").trim() || question;
  const result = await runOscarAsk(name, 5);
  const person = result.people[0];
  if (!person) {
    return {
      tool: "brief",
      title: "Person brief",
      summary: `Oscar could not find a desk for “${name}”.`,
      actions: [{ title: "Ask the library", count: 0, href: `/?ask=${encodeURIComponent(name)}`, why: "Search the wider set." }],
      lines: [],
    };
  }
  const emails = person.methods.filter((m) => m.kind === "EMAIL").length;
  const phones = person.methods.filter((m) => m.kind === "PHONE").length;
  const place = person.addresses.map((a) => [a.city, a.state].filter(Boolean).join(", ")).find(Boolean) || "no city";
  return {
    tool: "brief",
    title: `Brief: ${person.displayName}`,
    summary: `${person.displayName} · ${emails} email${emails === 1 ? "" : "s"} · ${phones} phone${phones === 1 ? "" : "s"} · ${place} · voter ${person.voterMatch?.status ?? "UNMATCHED"}.`,
    actions: [
      { title: "Open the person desk", count: 1, href: `/contacts/${person.id}`, why: "Full file, sheet drawers, Oscar notes." },
      { title: "More matches", count: result.total, href: `/?ask=${encodeURIComponent(name)}`, why: "If the name hit more than one desk." },
    ],
    lines: person.personTags.map((pt) => `Tag: ${pt.tag.name}`),
  };
}

async function runAsk(question: string): Promise<OscarToolResult> {
  const q = question.trim() || "what custom fields do we have";
  const learned = await findOscarQueryLesson(q);
  const result = await runOscarAsk(q, 20);
  return {
    tool: "ask",
    title: "Ask the library",
    summary: `${result.plan.summary} ${result.total} ${result.plan.intent === "catalog" ? "catalog rows" : "people"}.${learned ? " This question is in Oscar’s memory." : ""}`,
    actions: [
      {
        title: "Open the working set",
        count: result.total,
        href: `/?ask=${encodeURIComponent(q)}`,
        why: "Select, tag, export, or mark for review.",
      },
    ],
    lines: result.plan.intent === "catalog"
      ? result.catalog.slice(0, 12).map((r) => `${r.kind}: ${r.label}`)
      : result.people.slice(0, 12).map((p) => p.displayName),
    askHref: `/?ask=${encodeURIComponent(q)}`,
  };
}

export async function runOscarTool(tool: OscarToolId, question: string): Promise<OscarToolResult> {
  const picked = tool === "router" ? routeOscarCommand(question) : tool;
  await bumpOscarToolUse(picked, OSCAR_TOOLS.find((t) => t.id === picked)?.name ?? picked);
  if (picked === "next") return runNext();
  if (picked === "memory") return runMemory();
  if (picked === "audit") return runAudit();
  if (picked === "conflicts") return runConflicts();
  if (picked === "voters") return runVoters();
  if (picked === "review") return runReview();
  if (picked === "brief") return runBrief(question);
  return runAsk(question);
}

export async function oscarSuiteStats() {
  const [queryLessons, toolLessons, sheets] = await Promise.all([
    prisma.contactIntelOscarLesson.count({ where: { kind: "query" } }),
    prisma.contactIntelOscarLesson.findMany({ where: { kind: "tool" }, orderBy: { uses: "desc" }, take: 12 }),
    listOscarSheetMemory(),
  ]);
  return { queryLessons, toolLessons, sheetShapes: sheets.length };
}
