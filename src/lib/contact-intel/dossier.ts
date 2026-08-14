export type IdentityFactor = {
  key: string;
  label: string;
  points: number;
  present: boolean;
};

export type IdentityScore = {
  score: number;
  max: number;
  percent: number;
  band: "thin" | "usable" | "strong";
  factors: IdentityFactor[];
};

export type VoterInterpretation = {
  status: "waiting_for_file" | "id_only" | "no_match" | "needs_review" | "unmatched";
  typeLabel: string;
  accuracyPercent: number;
  note: string;
};

export type SearchLadder = {
  state: string | null;
  city: string | null;
  zip: string | null;
  lastName: string | null;
  firstName: string | null;
  steps: string[];
};

export type UploadedFact = {
  key: string;
  values: { value: string; file: string; rowNumber: number }[];
};

export function buildSearchLadder(input: {
  firstName?: string | null;
  lastName?: string | null;
  addresses: { city?: string | null; state?: string | null; postalCode?: string | null }[];
}): SearchLadder {
  const state = input.addresses.map((a) => a.state?.trim()).find(Boolean) || null;
  const city = input.addresses.map((a) => a.city?.trim()).find(Boolean) || null;
  const zip = input.addresses.map((a) => a.postalCode?.trim()).find(Boolean) || null;
  const lastName = input.lastName?.trim() || null;
  const firstName = input.firstName?.trim() || null;
  const steps = [
    state ? `State: ${state}` : "State: unknown — start with Arkansas if the sheet is local",
    city ? `City: ${city}` : "City: unknown — use county or ZIP next",
    zip ? `ZIP: ${zip}` : "ZIP: unknown",
    lastName || firstName ? `Name: ${[lastName, firstName].filter(Boolean).join(", ")}` : "Name: incomplete",
  ];
  return { state, city, zip, lastName, firstName, steps };
}

export function scoreContactIdentity(input: {
  emails: number;
  phones: number;
  firstName?: string | null;
  lastName?: string | null;
  addresses: { line?: string | null; city?: string | null; state?: string | null; postalCode?: string | null }[];
  sourceRows: number;
  customFields: number;
  openConflicts: number;
  lookalikes: number;
  voterMatched: boolean;
}): IdentityScore {
  const hasName = Boolean(input.firstName?.trim() && input.lastName?.trim());
  const hasLine = input.addresses.some((a) => a.line?.trim());
  const hasCityState = input.addresses.some((a) => a.city?.trim() && a.state?.trim());
  const hasZip = input.addresses.some((a) => a.postalCode?.trim());
  const factors: IdentityFactor[] = [
    { key: "email", label: "Email on file", points: 20, present: input.emails > 0 },
    { key: "phone", label: "Phone on file", points: 20, present: input.phones > 0 },
    { key: "name", label: "First and last name", points: 15, present: hasName },
    { key: "street", label: "Street address", points: 10, present: hasLine },
    { key: "cityState", label: "City and state", points: 10, present: hasCityState },
    { key: "zip", label: "ZIP", points: 8, present: hasZip },
    { key: "sources", label: "More than one source row", points: 7, present: input.sourceRows > 1 },
    { key: "custom", label: "Custom fields from uploads", points: 5, present: input.customFields > 0 },
    { key: "voter", label: "Voter ID attached", points: 15, present: input.voterMatched },
    { key: "conflict", label: "No open identifier conflict", points: 10, present: input.openConflicts === 0 },
    { key: "lookalike", label: "No same-name lookalike in queue", points: 5, present: input.lookalikes === 0 },
  ];
  const max = factors.reduce((sum, f) => sum + f.points, 0);
  const score = factors.reduce((sum, f) => sum + (f.present ? f.points : 0), 0);
  const percent = max === 0 ? 0 : Math.round((score / max) * 100);
  const band: IdentityScore["band"] = percent >= 75 ? "strong" : percent >= 45 ? "usable" : "thin";
  return { score, max, percent, band, factors };
}

export function interpretVoterIdentity(input: {
  status?: "UNMATCHED" | "NEEDS_REVIEW" | "MATCHED" | "NO_MATCH" | null;
  voterId?: string | null;
}): VoterInterpretation {
  if (input.status === "MATCHED" && input.voterId) {
    return {
      status: "id_only",
      typeLabel: "Voter file not loaded yet",
      accuracyPercent: 0,
      note: `Voter ID ${input.voterId} is attached. Turnout and voter-type scoring starts after the registration file is linked. This does not write the campaign voter table.`,
    };
  }
  if (input.status === "NO_MATCH") {
    return {
      status: "no_match",
      typeLabel: "No voter record found",
      accuracyPercent: 0,
      note: "Marked as no match. Reopen the voter queue if a later file should be searched.",
    };
  }
  if (input.status === "NEEDS_REVIEW") {
    return {
      status: "needs_review",
      typeLabel: "Needs a human match",
      accuracyPercent: 0,
      note: "Oscar got close. Confirm or reject in the voter queue.",
    };
  }
  return {
    status: "unmatched",
    typeLabel: "Not matched to a voter ID",
    accuracyPercent: 0,
    note: "Search state → city → ZIP → name. Oscar will use the voter file when it is connected.",
  };
}

export function collectUploadedFacts(
  rows: { rawJson: unknown; rowNumber: number; job: { originalFilename: string } }[],
): UploadedFact[] {
  const byKey = new Map<string, UploadedFact["values"]>();
  for (const row of rows) {
    if (!row.rawJson || typeof row.rawJson !== "object" || Array.isArray(row.rawJson)) continue;
    for (const [key, raw] of Object.entries(row.rawJson as Record<string, unknown>)) {
      const value = String(raw ?? "").trim();
      if (!key.trim() || !value) continue;
      const list = byKey.get(key) ?? [];
      if (!list.some((item) => item.value === value && item.file === row.job.originalFilename)) {
        list.push({ value, file: row.job.originalFilename, rowNumber: row.rowNumber });
      }
      byKey.set(key, list);
    }
  }
  return [...byKey.entries()]
    .map(([key, values]) => ({ key, values }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`.toUpperCase();
}

export type SheetDrawer = {
  jobId: string;
  filename: string;
  sourceLabel: string | null;
  importedAt: string;
  rows: {
    id: string;
    rowNumber: number;
    status: string;
    cells: { key: string; value: string }[];
  }[];
};

export function groupSheetDrawers(
  rows: {
    id: string;
    rowNumber: number;
    status: string;
    rawJson: unknown;
    createdAt: Date;
    job: { id: string; originalFilename: string; sourceLabel: string | null };
  }[],
): SheetDrawer[] {
  const byJob = new Map<string, SheetDrawer>();
  for (const row of rows) {
    const current = byJob.get(row.job.id) ?? {
      jobId: row.job.id,
      filename: row.job.originalFilename,
      sourceLabel: row.job.sourceLabel,
      importedAt: row.createdAt.toISOString(),
      rows: [],
    };
    const cells: { key: string; value: string }[] = [];
    if (row.rawJson && typeof row.rawJson === "object" && !Array.isArray(row.rawJson)) {
      for (const [key, raw] of Object.entries(row.rawJson as Record<string, unknown>)) {
        const value = String(raw ?? "").trim();
        if (key.trim() && value) cells.push({ key, value });
      }
    }
    current.rows.push({ id: row.id, rowNumber: row.rowNumber, status: row.status, cells });
    if (row.createdAt.toISOString() > current.importedAt) current.importedAt = row.createdAt.toISOString();
    byJob.set(row.job.id, current);
  }
  return [...byJob.values()].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export type OscarDeskNote = {
  severity: "clear" | "lookalike" | "conflict";
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
};

function methodKinds(methods: { kind: string }[]): string {
  const hasEmail = methods.some((m) => m.kind === "EMAIL");
  const hasPhone = methods.some((m) => m.kind === "PHONE");
  if (hasEmail && hasPhone) return "email and phone";
  if (hasEmail) return "email only";
  if (hasPhone) return "phone only";
  return "no email or phone";
}

function placeLabel(addresses: { city?: string | null; state?: string | null }[]): string {
  return addresses.map((a) => [a.city, a.state].filter(Boolean).join(", ")).find(Boolean) || "no city";
}

export function buildOscarDeskNotes(input: {
  displayName: string;
  methods: { kind: string }[];
  addresses: { city?: string | null; state?: string | null }[];
  sheets: string[];
  conflicts: { id: string; reason: string; otherId: string; otherName: string; file?: string }[];
  lookalikes: {
    id: string;
    displayName: string;
    methods: { kind: string }[];
    addresses: { city?: string | null; state?: string | null }[];
    sheets: string[];
  }[];
}): OscarDeskNote[] {
  const notes: OscarDeskNote[] = [];
  for (const conflict of input.conflicts) {
    notes.push({
      severity: "conflict",
      title: `Oscar: identifier conflict with ${conflict.otherName}`,
      body: `${conflict.reason} This desk has ${methodKinds(input.methods)}. Names never merge. Open both files and keep them separate unless you are fixing a bad source row.${conflict.file ? ` Source: ${conflict.file}.` : ""}`,
      href: `/contacts/${conflict.otherId}`,
      hrefLabel: `Open ${conflict.otherName}`,
    });
  }
  for (const other of input.lookalikes) {
    const sameSheets = input.sheets.filter((s) => other.sheets.includes(s));
    notes.push({
      severity: "lookalike",
      title: `Oscar: almost the same name as ${other.displayName}`,
      body: `This desk has ${methodKinds(input.methods)} in ${placeLabel(input.addresses)}. The other desk has ${methodKinds(other.methods)} in ${placeLabel(other.addresses)}. ${
        sameSheets.length ? `They share sheet ${sameSheets.join(", ")}.` : "They do not share a sheet."
      } Review only. Do not merge unless an email or phone is the same.`,
      href: `/contacts/${other.id}`,
      hrefLabel: `Open ${other.displayName}`,
    });
  }
  if (notes.length === 0) {
    notes.push({
      severity: "clear",
      title: "Oscar: this looks like one person",
      body: `${input.displayName} has ${methodKinds(input.methods)} and ${input.sheets.length || "no"} source sheet${input.sheets.length === 1 ? "" : "s"}. No open identifier conflict and no same-name lookalike in the library slice.`,
    });
  }
  return notes;
}

export function sameNameKey(firstName?: string | null, lastName?: string | null): string | null {
  const first = firstName?.trim().toLowerCase();
  const last = lastName?.trim().toLowerCase();
  if (!first || !last) return null;
  return `${last}|${first}`;
}
