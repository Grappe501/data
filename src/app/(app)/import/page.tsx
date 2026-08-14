import Link from "next/link";
import { uploadContactIntelFileAction } from "@/app/actions";
import { listContactIntelJobs } from "@/lib/contact-intel/queries";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function ImportPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const jobs = await listContactIntelJobs(50);

  return (
    <div>
      {error === "file" ? <p className="banner banner-error">Choose a CSV or XLSX file.</p> : null}
      {error === "size" ? <p className="banner banner-error">File is larger than 8MB. Split it and retry.</p> : null}
      {error === "parse" ? <p className="banner banner-error">Could not read headers or rows from that file.</p> : null}

      <section className="card">
        <h2>Upload spreadsheet</h2>
        <p className="lede">CSV or first-sheet XLSX. Map columns on the next screen. Extra columns stay as source data.</p>
        <form action={uploadContactIntelFileAction}>
          <label>
            Source label (optional)
            <input name="sourceLabel" placeholder="e.g. 2024 county fair sheet" />
          </label>
          <label>
            File
            <input name="file" type="file" accept=".csv,.xlsx,.xls,text/csv" required />
          </label>
          <p>
            <button className="btn btn-fog" type="submit">
              Upload and map
            </button>
          </p>
        </form>
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
                  <td>{job.status}</td>
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
