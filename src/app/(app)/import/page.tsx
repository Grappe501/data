import Link from "next/link";
import { uploadContactIntelFileAction } from "@/app/actions";
import { readOscarReport } from "@/lib/contact-intel/oscar";
import { listOscarSheetMemory } from "@/lib/contact-intel/oscar-lessons";
import { listContactIntelJobs } from "@/lib/contact-intel/queries";
import { UploadForm } from "./UploadForm";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function ImportPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const [jobs, memories] = await Promise.all([listContactIntelJobs(50), listOscarSheetMemory()]);

  return (
    <div>
      {error === "file" ? <p className="banner banner-error">Choose a CSV or XLSX file.</p> : null}
      {error === "size" ? <p className="banner banner-error">File is larger than 8MB. Split it and retry.</p> : null}
      {error === "headers" ? <p className="banner banner-error">No header row found. Put column names on the first row.</p> : null}
      {error === "rows" ? <p className="banner banner-error">No data rows found, or the file is over the 20,000-row limit.</p> : null}
      {error === "parse" ? <p className="banner banner-error">Could not read headers or rows from that file.</p> : null}

      <section className="card">
        <h2>Upload spreadsheet</h2>
        <p className="lede">
          CSV or first-sheet XLSX. Oscar reads the columns, creates custom fields for extra information, and asks you
          only when he does not recognize the sheet. Your confirmation teaches him the next one.
        </p>
        <UploadForm action={uploadContactIntelFileAction} />
        <p className="muted">
          Oscar already knows{" "}
          <Link className="plain" href="/memory">
            {memories.length} sheet shape{memories.length === 1 ? "" : "s"}
          </Link>
          . A first-time layout still needs you once.
        </p>
      </section>

      <h2>Import jobs</h2>
      <div className="scroll card" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Rows</th>
              <th>Conflicts</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No imports yet.
                </td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className="plain" href={`/import/${job.id}`}>
                      {job.originalFilename}
                    </Link>
                    {job.sourceLabel ? <div className="muted">{job.sourceLabel}</div> : null}
                  </td>
                  <td>
                    {job.status}
                    {readOscarReport(job.previewJson)?.needsReview && job.status === "UPLOADED" ? (
                      <div className="oscar-flag">Oscar needs you</div>
                    ) : null}
                  </td>
                  <td>{job._count.rows}</td>
                  <td>{job._count.conflicts}</td>
                  <td className="muted">{job.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
