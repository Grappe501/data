import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { buildSearchLadder } from "@/lib/contact-intel/dossier";

export async function dismissContactIntelConflict(conflictId: string) {
  await prisma.contactIntelConflict.update({
    where: { id: conflictId },
    data: { status: "DISMISSED" },
  });
}

export async function saveContactIntelVoterId(input: {
  personId: string;
  voterId: string;
  note?: string | null;
}) {
  const voterId = input.voterId.trim().slice(0, 80);
  if (!voterId) throw new Error("Enter a voter ID.");
  const person = await prisma.contactIntelPerson.findUnique({
    where: { id: input.personId },
    include: { addresses: true },
  });
  if (!person) throw new Error("Person not found.");
  const ladder = buildSearchLadder({
    firstName: person.firstName,
    lastName: person.lastName,
    addresses: person.addresses,
  });
  await prisma.contactIntelVoterMatch.upsert({
    where: { personId: input.personId },
    create: {
      personId: input.personId,
      status: "MATCHED",
      voterId,
      confidence: 100,
      method: "MANUAL",
      ladderJson: ladder as unknown as Prisma.InputJsonValue,
      oscarNote: input.note?.trim() || "Operator attached a voter ID. Voter-file scoring waits for the registration file.",
      evidenceJson: { source: "operator" },
      matchedAt: new Date(),
    },
    update: {
      status: "MATCHED",
      voterId,
      confidence: 100,
      method: "MANUAL",
      ladderJson: ladder as unknown as Prisma.InputJsonValue,
      oscarNote: input.note?.trim() || "Operator attached a voter ID. Voter-file scoring waits for the registration file.",
      evidenceJson: { source: "operator" },
      matchedAt: new Date(),
    },
  });
}

export async function markContactIntelVoterNoMatch(personId: string) {
  const person = await prisma.contactIntelPerson.findUnique({
    where: { id: personId },
    include: { addresses: true },
  });
  if (!person) throw new Error("Person not found.");
  const ladder = buildSearchLadder({
    firstName: person.firstName,
    lastName: person.lastName,
    addresses: person.addresses,
  });
  await prisma.contactIntelVoterMatch.upsert({
    where: { personId },
    create: {
      personId,
      status: "NO_MATCH",
      confidence: 0,
      method: "GEO",
      ladderJson: ladder as unknown as Prisma.InputJsonValue,
      oscarNote: "Operator searched the available facts and found no voter ID.",
      evidenceJson: { source: "operator", result: "no_match" },
    },
    update: {
      status: "NO_MATCH",
      voterId: null,
      confidence: 0,
      method: "GEO",
      ladderJson: ladder as unknown as Prisma.InputJsonValue,
      oscarNote: "Operator searched the available facts and found no voter ID.",
      evidenceJson: { source: "operator", result: "no_match" },
      matchedAt: null,
    },
  });
}
