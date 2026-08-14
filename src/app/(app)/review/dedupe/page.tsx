import Link from "next/link";
import { dismissContactIntelConflictAction } from "@/app/actions";
import { listContactIntelLookalikes, listOpenContactIntelConflicts } from "@/lib/contact-intel/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DedupeQueuePage() {
  const [conflicts, lookalikes] = await Promise.all([listOpenContactIntelConflicts(), listContactIntelLookalikes()]);

  return (
    <div>
      <p>
        <Link className="plain" href="/">
          ← Library
        </Link>
      </p>
      <section className="card">
        <h2>De-dupe queue</h2>
        <p className="lede">
          Foolproof rule: email and phone are the only identity keys. Names never merge. Oscar can flag lookalikes. You
          decide. A conflict means one row’s email and phone already belong to two different people.
        </p>
      </section>

      <section className="card">
        <h3>Identifier conflicts</h3>
        {conflicts.length === 0 ? <p className="muted">None open.</p> : null}
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Left</th>
                <th>Right</th>
                <th>Why</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="plain" href={`/contacts/${c.leftPerson.id}`}>
                      {c.leftPerson.displayName}
                    </Link>
                  </td>
                  <td>
                    <Link className="plain" href={`/contacts/${c.rightPerson.id}`}>
                      {c.rightPerson.displayName}
                    </Link>
                  </td>
                  <td>{c.reason}</td>
                  <td className="muted">
                    <Link className="plain" href={`/import/${c.sourceRow.job.id}`}>
                      {c.sourceRow.job.originalFilename}
                    </Link>{" "}
                    · row {c.sourceRow.rowNumber}
                  </td>
                  <td>
                    <form action={dismissContactIntelConflictAction}>
                      <input type="hidden" name="conflictId" value={c.id} />
                      <button className="btn btn-fog" type="submit">
                        Keep both people
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Same-name lookalikes</h3>
        <p className="muted">Same first and last name, and overlapping city or ZIP. Open the files. Do not merge on name.</p>
        {lookalikes.length === 0 ? <p className="muted">None in the current library slice.</p> : null}
        {lookalikes.map((group) => (
          <div key={group.key} className="card" style={{ marginTop: 12 }}>
            <p className="stat-label">{group.key.replace("|", ", ")}</p>
            <ul>
              {group.people.map((person) => (
                <li key={person.id}>
                  <Link className="plain" href={`/contacts/${person.id}`}>
                    {person.displayName}
                  </Link>
                  <span className="muted">
                    {" "}
                    · {person.methods.filter((m) => m.kind === "EMAIL").map((m) => m.normalizedValue).join(", ") || "no email"}
                    {" · "}
                    {person.methods.filter((m) => m.kind === "PHONE").map((m) => m.originalValue).join(", ") || "no phone"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
