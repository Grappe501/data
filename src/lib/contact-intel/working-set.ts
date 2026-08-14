import { prisma } from "@/lib/db";
import { normalizeContactIntelTagKey } from "@/lib/contact-intel/enrichment";

export const CONTACT_INTEL_REVIEW_TAG = "Needs review";
const MAX_SET = 200;

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_SET);
}

export async function tagContactIntelPeople(personIds: string[], tagName: string) {
  const ids = uniqueIds(personIds);
  const name = tagName.trim().slice(0, 200);
  if (ids.length === 0) throw new Error("Select at least one person.");
  if (!name) throw new Error("Enter a tag.");
  const key = normalizeContactIntelTagKey(name);
  if (!key) throw new Error("Enter a tag.");
  const tag = await prisma.contactIntelTag.upsert({
    where: { key },
    create: { key, name },
    update: { name },
  });
  for (const personId of ids) {
    await prisma.contactIntelPersonTag.upsert({
      where: { personId_tagId: { personId, tagId: tag.id } },
      create: { personId, tagId: tag.id },
      update: {},
    });
  }
  return { tagged: ids.length, tag: name };
}

export async function markContactIntelPeopleReview(personIds: string[]) {
  return tagContactIntelPeople(personIds, CONTACT_INTEL_REVIEW_TAG);
}

export async function listReviewWorkingSet(take = 150) {
  const key = normalizeContactIntelTagKey(CONTACT_INTEL_REVIEW_TAG);
  return prisma.contactIntelPerson.findMany({
    where: { personTags: { some: { tag: { key } } } },
    orderBy: { updatedAt: "desc" },
    take,
    include: {
      methods: { orderBy: { createdAt: "asc" } },
      voterMatch: true,
      addresses: { take: 2 },
      personTags: { include: { tag: true } },
      sourceRows: {
        take: 2,
        include: { job: { select: { originalFilename: true, sourceLabel: true } } },
      },
    },
  });
}

export async function loadPeopleForExport(personIds: string[]) {
  const ids = uniqueIds(personIds);
  if (ids.length === 0) return [];
  return prisma.contactIntelPerson.findMany({
    where: { id: { in: ids } },
    include: {
      methods: true,
      addresses: true,
      personTags: { include: { tag: true } },
      voterMatch: true,
      sourceRows: { include: { job: { select: { originalFilename: true, sourceLabel: true } } } },
    },
  });
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function peopleToCsv(
  people: Awaited<ReturnType<typeof loadPeopleForExport>>,
): string {
  const header = [
    "display_name",
    "first_name",
    "last_name",
    "emails",
    "phones",
    "city",
    "state",
    "zip",
    "tags",
    "voter_id",
    "voter_status",
    "sources",
  ];
  const lines = [header.join(",")];
  for (const person of people) {
    const emails = person.methods.filter((m) => m.kind === "EMAIL").map((m) => m.normalizedValue);
    const phones = person.methods.filter((m) => m.kind === "PHONE").map((m) => m.originalValue);
    const address = person.addresses[0];
    const sources = [...new Set(person.sourceRows.map((r) => r.job.sourceLabel || r.job.originalFilename))];
    lines.push(
      [
        person.displayName,
        person.firstName ?? "",
        person.lastName ?? "",
        emails.join("; "),
        phones.join("; "),
        address?.city ?? "",
        address?.state ?? "",
        address?.postalCode ?? "",
        person.personTags.map((pt) => pt.tag.name).join("; "),
        person.voterMatch?.voterId ?? "",
        person.voterMatch?.status ?? "UNMATCHED",
        sources.join("; "),
      ]
        .map((v) => csvCell(String(v)))
        .join(","),
    );
  }
  return lines.join("\r\n");
}
