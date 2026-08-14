import Link from "next/link";
import { notFound } from "next/navigation";
import { commitContactIntelImportAction, previewContactIntelMappingAction } from "@/app/actions";
import { CONTACT_INTEL_FIELD_TARGETS, type ContactIntelFieldTarget } from "@/lib/contact-intel/mapping";
import { getContactIntelJob } from "@/lib/contact-intel/queries";

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
    out[k] = CONTACT_INTEL_FIELD_TARGETS.includes(v as ContactIntelFieldTarget)
      ? (v as ContactIntelFieldTarget)
      : "ignore";
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
  const job = await getContactIntelJob(id);
  if (!job) notFound();

  const headers = asStringArray(job.headerJson);
  const mapping = asMapping(job.mappingJson);
  const stats = asStats(job.statsJson);
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
          <p className="lede">Assign each source column. Unmapped columns stay on the original row.</p>
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
                    return (
                      <tr key={header}>
                        <td>
                          <strong>{header}</strong>
                        </td>
                        <td>
                          <select name={`map:${header}`} defaultValue={mapping[header] ?? "ignore"}>
                            {CONTACT_INTEL_FIELD_TARGETS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="muted">{sample || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              <button className="btn btn-fog" type="submit">
                Apply mapping and preview
              </button>
            </p>
          </form>
        </section>
      ) : null}

      {job.status === "PREVIEWED" || job.status === "COMMITTED" ? (
        <section className="card">
          <h3>Preview</h3>
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
                <button className="btn btn-primary" type="submit">
                  Commit import
                </button>
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
