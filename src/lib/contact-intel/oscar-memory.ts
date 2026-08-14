import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { oscarHeaderJaccard } from "@/lib/contact-intel/oscar-headers";

export function normalizeOscarLessonKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

export async function rememberOscarLesson(input: {
  kind: string;
  key: string;
  label: string;
  payload: unknown;
}) {
  const key = normalizeOscarLessonKey(input.key);
  if (!key) return null;
  const existing = await prisma.contactIntelOscarLesson.findUnique({
    where: { kind_key: { kind: input.kind, key } },
  });
  if (existing) {
    return prisma.contactIntelOscarLesson.update({
      where: { id: existing.id },
      data: {
        uses: { increment: 1 },
        label: input.label.slice(0, 320),
        payloadJson: input.payload as Prisma.InputJsonValue,
      },
    });
  }
  return prisma.contactIntelOscarLesson.create({
    data: {
      kind: input.kind.slice(0, 40),
      key,
      label: input.label.slice(0, 320),
      payloadJson: input.payload as Prisma.InputJsonValue,
    },
  });
}

export async function findOscarQueryLesson(question: string) {
  const key = normalizeOscarLessonKey(question);
  const exact = await prisma.contactIntelOscarLesson.findUnique({
    where: { kind_key: { kind: "query", key } },
  });
  if (exact) return exact;
  const recent = await prisma.contactIntelOscarLesson.findMany({
    where: { kind: "query" },
    orderBy: { uses: "desc" },
    take: 40,
  });
  const tokens = key.split(" ");
  let best: (typeof recent)[number] | null = null;
  let score = 0;
  for (const row of recent) {
    const other = row.key.split(" ");
    const n = oscarHeaderJaccard(tokens, other);
    if (n >= 0.82 && n > score) {
      best = row;
      score = n;
    }
  }
  return best;
}

export async function listOscarLessons(kind?: string, take = 24) {
  return prisma.contactIntelOscarLesson.findMany({
    where: kind ? { kind } : undefined,
    orderBy: [{ uses: "desc" }, { updatedAt: "desc" }],
    take,
  });
}

export async function bumpOscarToolUse(toolId: string, label: string) {
  return rememberOscarLesson({ kind: "tool", key: toolId, label, payload: { toolId } });
}
