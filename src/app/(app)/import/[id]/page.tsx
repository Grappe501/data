import Link from "next/link";
import { notFound } from "next/navigation";
import { commitContactIntelImportAction, previewContactIntelMappingAction } from "@/app/actions";
import {
  CONTACT_INTEL_FIELD_TARGETS,
  customKeyFromTarget,
  parseContactIntelTarget,
  type ContactIntelFieldTarget,
} from "@/lib/contact-intel/mapping";
import { getContactIntelJob, listContactIntelCustomFieldDefinitions } from "@/lib/contact-intel/queries";
import { WorkingSubmit } from "../WorkingSubmit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ committed?: string }> };

function asStringArray(json: unknown): string[] {
  return Array.isArray(json) ? json.map((v) => String(v)) : [];
}

function asMapping(json: unknown): Record<string, ContactIntelFieldTarget> {
  if (!json || typeof json !== "object") return {};
  const columns = (json as { columns?: Record<string, string> }).columns ?? {};
  const out: Record<string, ContactIntelFieldTarget> = {};
  for (const [k, v] of Object.entries(columns)) {
    out[k] = parseContactIntelTarget(v);
  }
  return out;
}

function asStats(json: unknown): Record<string, number> {
  if (!json || typeof json !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

function asMessages(json: unknown): string[] {
  return Array.isArray(json) ? json.map((v) => String(v)) : [];
}

function asCustomPlan(json: unknown): { key: string; label: string; action: string }[] {
  if (!json || typeof json !== "object") return [];
  const raw = (json as { customFields?: unknown }).customFields;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rec = item as { key?: unknown; label?: unknown; action?: unknown };
      if (typeof rec.key !== "string") return null;
      return { key: rec.key, label: String(rec.label ?? rec.key), action: String(rec.action ?? "create") };
    })
    .filter((v): v is { key: string; label: string; action: string } => Boolean(v));
}

function summarizeEnrichment(json: unknown, part: "address" | "tags" | "custom"): string {
  if (!json || typeof json !== "object") return "—";
  const rec = json as {
    addressPreview?: unknown;
    tags?: { name?: string }[];
    custom?: { key?: string; original?: string }[];
  };
  if (part === "address") return typeof rec.addressPreview === "string" && rec.addressPreview ? rec.addressPreview : "—";
  if (part === "tags") {
    const names = Array.isArray(rec.tags) ? rec.tags.map((t) => t.name).filter(Boolean) : [];
    return names.join(", ") || "—";
  }
  const fields = Array.isArray(rec.custom)
    ? rec.custom.map((c) => (c.key && c.original ? `${c.key}=${c.original}` : "")).filter(Boolean)
    : [];
  return fields.join("; ") || "—";
}

function summarizeMethods(json: unknown): string {
  if (!Array.isArray(json) || json.length === 0) return "—";
  return json
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const rec = item as { original?: string; normalized?: string };
      return rec.normalized || rec.original || "";
    })
    .filter(Boolean)
    .join(", ");
}

export default async function ImportJobPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { committed } = await searchParams;
  const [job, customDefs] = await Promise.all([getContactIntelJob(id), listContactIntelCustomFieldDefinitions()]);
  if (!job) notFound();

  const headers = asStringArray(job.headerJson);
  const mapping = asMapping(job.mappingJson);
  const stats = asStats(job.statsJson);
  const customPlan = asCustomPlan(job.previewJson);
  const previewRows = job.rows.slice(0, 8);
  const canCommit = job.status === "PREVIEWED";

  return (
    <div>
      <p>
        <Link className="plain" href="/import">
          ← All imports
        </Link>
      </p>
      {committed ? <p className="banner banner-ok">Import committed. Invalid and conflict rows were left out of the library.</p> : null}

      <section className="card">
        <h2>{job.originalFilename}</h2>
        <p className="muted">
          Status <strong>{job.status}</strong> · {job._count.rows} rows · {job._count.conflicts} conflicts
        </p>
      </section>

      {job.status !== "COMMITTED" ? (
        <section className="card">
          <h3>Map columns</h3>
          <p className="lede">
            Assign each source column. Addresses, tags, and custom fields enrich after email/phone matching and never
            merge people. Unmapped columns stay on the original row.
          </p>
          <form action={previewContactIntelMappingAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="headers" value={JSON.stringify(headers)} />
            <div className="scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Source column</th>
                    <th>Maps to</th>
                    <th>Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((header) => {
                    const sample = previewRows
                      .map((r) => String((r.rawJson as Record<string, string> | null)?.[header] ?? ""))
                      .filter(Boolean)
                      .slice(0, 2)
                      .join(" · ");
                    const target = mapping[header] ?? "ignore";
                    const customKey = customKeyFromTarget(target);
                    return (
                      <tr key={header}>
                        <td>
                          <strong>{header}</strong>
                        </td>
                        <td>
                          <select name={`map:${header}`} defaultValue={customKey ? "custom" : target}>
                            {CONTACT_INTEL_FIELD_TARGETS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                            <option value="custom">custom field</option>
                          </select>
                          <div>
                            <select name={`customExisting:${header}`} defaultValue={customKey ?? ""}>
                              <option value="">New custom field…</option>
                              {customDefs.map((d) => (
                                <option key={d.id} value={d.key}>
                                  {d.label} ({d.key})
                                </option>
                              ))}
                            </select>
                            <input name={`customKey:${header}`} defaultValue={customKey ?? ""} placeholder="key e.g. employer" />
                            <input
                              name={`customLabel:${header}`}
                              defaultValue={customDefs.find((d) => d.key === customKey)?.label ?? header}
                              placeholder="Label e.g. Employer"
                            />
                          </div>
                        </td>
                        <td className="muted">{sample || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              <WorkingSubmit
                label="Apply mapping and preview"
                pendingLabel="Applying mapping and writing preview…"
                jobId={job.id}
              />
            </p>
          </form>
        </section>
      ) : null}

      {job.status === "PREVIEWED" || job.status === "COMMITTED" ? (
        <section className="card">
          <h3>Preview</h3>
          {customPlan.length > 0 ? (
            <ul>
              {customPlan.map((item) => (
                <li key={item.key}>
                  Custom field <strong>{item.label}</strong> ({item.key}) will be{" "}
                  {item.action === "reuse" ? "reused" : "created on commit"}.
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid grid-4">
            {Object.entries(stats).map(([k, v]) => (
              <div key={k} className="card">
                <div className="stat-label">{k}</div>
                <div className="stat-value">{v}</div>
              </div>
            ))}
          </div>
          {canCommit ? (
            <form action={commitContactIntelImportAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <p>
                <WorkingSubmit
                  className="btn btn-primary"
                  label="Commit import"
                  pendingLabel="Committing people and methods…"
                  jobId={job.id}
                />
              </p>
            </form>
          ) : null}
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Name</th>
                  <th>Emails</th>
                  <th>Phones</th>
                  <th>Address</th>
                  <th>Tags</th>
                  <th>Custom</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {job.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.rowNumber}</td>
                    <td>{row.status}</td>
                    <td>{row.displayName || "—"}</td>
                    <td>{summarizeMethods(row.emailsJson)}</td>
                    <td>{summarizeMethods(row.phonesJson)}</td>
                    <td>{summarizeEnrichment(row.enrichmentJson, "address")}</td>
                    <td>{summarizeEnrichment(row.enrichmentJson, "tags")}</td>
                    <td>{summarizeEnrichment(row.enrichmentJson, "custom")}</td>
                    <td className="muted">{asMessages(row.messagesJson).join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
