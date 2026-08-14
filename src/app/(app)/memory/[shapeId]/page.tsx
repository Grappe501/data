import Link from "next/link";
import { notFound } from "next/navigation";
import { getOscarSheetMemory, oscarMappingCounts } from "@/lib/contact-intel/oscar-lessons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ shapeId: string }> };

export default async function OscarSheetMemoryPage({ params }: Props) {
  const { shapeId } = await params;
  const memory = await getOscarSheetMemory(shapeId);
  if (!memory) notFound();
  const counts = oscarMappingCounts(memory.columns);

  return (
    <div>
      <p>
        <Link className="plain" href="/memory">
          ← Sheet memory
        </Link>
      </p>
      <section className="card">
        <p className="kicker">Oscar knows this sheet</p>
        <h2>{memory.title}</h2>
        <p className="lede">
          {memory.seen} upload{memory.seen === 1 ? "" : "s"} used this column layout. A new file with these headers is
          assigned automatically. A new column and Oscar asks you, then learns that too.
        </p>
        {memory.aliases.length > 1 ? <p className="muted">Also known as {memory.aliases.join(" · ")}</p> : null}
        <p>
          {counts.mapped} assigned · {counts.custom} custom fields · {counts.ignored} ignored
        </p>
      </section>

      <section className="card">
        <h3>Remembered mapping</h3>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Maps to</th>
              </tr>
            </thead>
            <tbody>
              {memory.headers.map((header) => (
                <tr key={header}>
                  <td>{header}</td>
                  <td>{memory.columns[header] ?? "ignore"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {memory.customFields.length > 0 ? (
        <section className="card">
          <h3>Custom fields this shape creates</h3>
          <ul>
            {memory.customFields.map((field) => (
              <li key={field.key}>
                <strong>{field.label}</strong> <span className="muted">({field.key})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <h3>Uploads that taught or reused this</h3>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {memory.jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className="plain" href={`/import/${job.id}`}>
                      {job.filename}
                    </Link>
                    {job.sourceLabel ? <div className="muted">{job.sourceLabel}</div> : null}
                  </td>
                  <td>{job.status}</td>
                  <td className="muted">{job.createdAt.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
