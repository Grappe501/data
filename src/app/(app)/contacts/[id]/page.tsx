import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactIntelPerson } from "@/lib/contact-intel/queries";

type Props = { params: Promise<{ id: string }> };

export default async function PersonPage({ params }: Props) {
  const { id } = await params;
  const person = await getContactIntelPerson(id);
  if (!person) notFound();
  const emails = person.methods.filter((m) => m.kind === "EMAIL");
  const phones = person.methods.filter((m) => m.kind === "PHONE");

  return (
    <div>
      <p>
        <Link className="plain" href="/">
          ← Library
        </Link>
      </p>
      <section className="card">
        <h2>{person.displayName}</h2>
        <p className="muted">{[person.firstName, person.lastName].filter(Boolean).join(" ") || "Name parts unknown"}</p>
      </section>
      <section className="grid grid-2">
        <div className="card">
          <h3>Emails</h3>
          <ul>
            {emails.length === 0 ? <li className="muted">None</li> : null}
            {emails.map((m) => (
              <li key={m.id}>
                <strong>{m.normalizedValue}</strong>
                {m.originalValue !== m.normalizedValue ? <span className="muted"> as {m.originalValue}</span> : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3>Phones</h3>
          <ul>
            {phones.length === 0 ? <li className="muted">None</li> : null}
            {phones.map((m) => (
              <li key={m.id}>
                <strong>{m.originalValue}</strong> <span className="muted">({m.normalizedValue})</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="grid grid-2">
        <div className="card">
          <h3>Addresses</h3>
          <p className="muted">Imported source values. Not used to match or merge people.</p>
          <ul>
            {person.addresses.length === 0 ? <li className="muted">None</li> : null}
            {person.addresses.map((a) => (
              <li key={a.id}>{[a.line, a.city, a.state, a.postalCode].filter(Boolean).join(", ") || "Partial address"}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3>Tags</h3>
          <ul>
            {person.personTags.length === 0 ? <li className="muted">None</li> : null}
            {person.personTags.map((pt) => (
              <li key={pt.id}>{pt.tag.name}</li>
            ))}
          </ul>
        </div>
      </section>
      <section className="card">
        <h3>Custom fields</h3>
        <p className="muted">Current imported values. Earlier observations stay on source rows.</p>
        <ul>
          {person.customValues.length === 0 ? <li className="muted">None</li> : null}
          {person.customValues.map((v) => (
            <li key={v.id}>
              <strong>{v.definition.label}</strong> {v.originalValue}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h3>Source rows</h3>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Row</th>
                <th>Status</th>
                <th>Imported</th>
              </tr>
            </thead>
            <tbody>
              {person.sourceRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link className="plain" href={`/import/${row.job.id}`}>
                      {row.job.originalFilename}
                    </Link>
                  </td>
                  <td>{row.rowNumber}</td>
                  <td>{row.status}</td>
                  <td className="muted">{row.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
