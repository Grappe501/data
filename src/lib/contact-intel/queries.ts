import { prisma } from "@/lib/db";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";

export async function searchContactIntelPeople(query: string, take = 50) {
  const q = query.trim();
  if (!q) {
    return prisma.contactIntelPerson.findMany({
      take,
      orderBy: { updatedAt: "desc" },
      include: { methods: { orderBy: { createdAt: "asc" } }, voterMatch: true },
    });
  }

  const email = normalizeEmail(q);
  const phone = normalizePhone(q);

  const methodHits = await prisma.contactIntelMethod.findMany({
    where: {
      OR: [
        email ? { kind: "EMAIL", normalizedValue: email } : undefined,
        phone ? { kind: "PHONE", normalizedValue: phone } : undefined,
        { normalizedValue: { contains: q.toLowerCase(), mode: "insensitive" } },
        { originalValue: { contains: q, mode: "insensitive" } },
      ].filter(Boolean) as object[],
    },
    select: { personId: true },
    take: 100,
  });

  const ids = [...new Set(methodHits.map((m) => m.personId))];

  return prisma.contactIntelPerson.findMany({
    where: {
      OR: [
        ids.length ? { id: { in: ids } } : undefined,
        { displayName: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ].filter(Boolean) as object[],
    },
    take,
    orderBy: { updatedAt: "desc" },
    include: { methods: { orderBy: { createdAt: "asc" } }, voterMatch: true },
  });
}

export async function getContactIntelPerson(id: string) {
  return prisma.contactIntelPerson.findUnique({
    where: { id },
    include: {
      methods: { orderBy: { createdAt: "asc" } },
      addresses: { orderBy: { createdAt: "asc" } },
      personTags: { include: { tag: true }, orderBy: { createdAt: "asc" } },
      customValues: { include: { definition: true }, orderBy: { createdAt: "asc" } },
      sourceRows: {
        orderBy: { createdAt: "desc" },
        include: { job: { select: { id: true, originalFilename: true, sourceLabel: true, createdAt: true } } },
      },
      voterMatch: true,
      conflictsLeft: { where: { status: "OPEN" }, take: 20 },
      conflictsRight: { where: { status: "OPEN" }, take: 20 },
    },
  });
}

export async function listContactIntelCustomFieldDefinitions() {
  return prisma.contactIntelCustomFieldDefinition.findMany({
    where: { active: true },
    orderBy: { label: "asc" },
  });
}

export async function listContactIntelJobs(take = 40) {
  return prisma.contactIntelImportJob.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { rows: true, conflicts: true } } },
  });
}

export async function getContactIntelJob(id: string) {
  return prisma.contactIntelImportJob.findUnique({
    where: { id },
    include: {
      rows: { orderBy: { rowNumber: "asc" }, take: 200 },
      conflicts: { where: { status: "OPEN" }, take: 50 },
      _count: { select: { rows: true, conflicts: true } },
    },
  });
}

export async function contactIntelLibraryStats() {
  const [people, methods, jobs, openConflicts, unmatchedVoters] = await Promise.all([
    prisma.contactIntelPerson.count(),
    prisma.contactIntelMethod.groupBy({ by: ["kind"], _count: { _all: true } }),
    prisma.contactIntelImportJob.count(),
    prisma.contactIntelConflict.count({ where: { status: "OPEN" } }),
    prisma.contactIntelPerson.count({
      where: {
        OR: [{ voterMatch: null }, { voterMatch: { status: { in: ["UNMATCHED", "NEEDS_REVIEW"] } } }],
      },
    }),
  ]);
  const emailCount = methods.find((m) => m.kind === "EMAIL")?._count._all ?? 0;
  const phoneCount = methods.find((m) => m.kind === "PHONE")?._count._all ?? 0;
  return { people, emailCount, phoneCount, jobs, openConflicts, unmatchedVoters };
}

export async function listOpenContactIntelConflicts(take = 80) {
  return prisma.contactIntelConflict.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      leftPerson: { select: { id: true, displayName: true, firstName: true, lastName: true } },
      rightPerson: { select: { id: true, displayName: true, firstName: true, lastName: true } },
      sourceRow: {
        select: {
          rowNumber: true,
          job: { select: { id: true, originalFilename: true } },
        },
      },
    },
  });
}

export async function listContactIntelLookalikes(take = 80) {
  const people = await prisma.contactIntelPerson.findMany({
    where: { firstName: { not: null }, lastName: { not: null } },
    take: 1500,
    orderBy: { updatedAt: "desc" },
    include: {
      addresses: { select: { city: true, state: true, postalCode: true } },
      methods: { select: { kind: true, normalizedValue: true, originalValue: true } },
    },
  });
  const groups = new Map<string, typeof people>();
  for (const person of people) {
    const first = person.firstName?.trim().toLowerCase();
    const last = person.lastName?.trim().toLowerCase();
    if (!first || !last) continue;
    const key = `${last}|${first}`;
    const list = groups.get(key) ?? [];
    list.push(person);
    groups.set(key, list);
  }
  const out: { key: string; people: typeof people }[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const geoOverlap = group.some((a, i) =>
      group.slice(i + 1).some((b) => {
        const aGeo = new Set(a.addresses.flatMap((x) => [x.city?.toLowerCase(), x.postalCode].filter(Boolean)));
        const bGeo = new Set(b.addresses.flatMap((x) => [x.city?.toLowerCase(), x.postalCode].filter(Boolean)));
        if (aGeo.size === 0 || bGeo.size === 0) return true;
        for (const g of aGeo) if (bGeo.has(g)) return true;
        return false;
      }),
    );
    if (!geoOverlap) continue;
    out.push({ key, people: group });
    if (out.length >= take) break;
  }
  return out;
}

export async function listPersonLookalikes(personId: string, firstName?: string | null, lastName?: string | null) {
  const first = firstName?.trim();
  const last = lastName?.trim();
  if (!first || !last) return [];
  return prisma.contactIntelPerson.findMany({
    where: {
      id: { not: personId },
      firstName: { equals: first, mode: "insensitive" },
      lastName: { equals: last, mode: "insensitive" },
    },
    take: 12,
    select: { id: true, displayName: true, firstName: true, lastName: true },
  });
}

export async function listVoterMatchQueue(take = 80) {
  return prisma.contactIntelPerson.findMany({
    where: {
      OR: [{ voterMatch: null }, { voterMatch: { status: { in: ["UNMATCHED", "NEEDS_REVIEW"] } } }],
    },
    orderBy: { updatedAt: "desc" },
    take,
    include: {
      methods: true,
      addresses: true,
      voterMatch: true,
    },
  });
}
