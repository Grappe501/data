import { prisma } from "@/lib/db";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";

export async function searchContactIntelPeople(query: string, take = 50) {
  const q = query.trim();
  if (!q) {
    return prisma.contactIntelPerson.findMany({
      take,
      orderBy: { updatedAt: "desc" },
      include: { methods: { orderBy: { createdAt: "asc" } } },
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
    include: { methods: { orderBy: { createdAt: "asc" } } },
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
  const [people, methods, jobs] = await Promise.all([
    prisma.contactIntelPerson.count(),
    prisma.contactIntelMethod.groupBy({ by: ["kind"], _count: { _all: true } }),
    prisma.contactIntelImportJob.count(),
  ]);
  const emailCount = methods.find((m) => m.kind === "EMAIL")?._count._all ?? 0;
  const phoneCount = methods.find((m) => m.kind === "PHONE")?._count._all ?? 0;
  return { people, emailCount, phoneCount, jobs };
}
