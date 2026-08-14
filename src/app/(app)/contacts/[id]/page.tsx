import Link from "next/link";
import { notFound } from "next/navigation";
import { markContactIntelVoterNoMatchAction, saveContactIntelVoterIdAction } from "@/app/actions";
import {
  buildSearchLadder,
  collectUploadedFacts,
  initialsFromName,
  interpretVoterIdentity,
  scoreContactIdentity,
} from "@/lib/contact-intel/dossier";
import { getContactIntelPerson, listPersonLookalikes } from "@/lib/contact-intel/queries";

type Props = { params: Promise<{ id: string }> };

export default async function PersonPage({ params }: Props) {
  const { id } = await params;
  const person = await getContactIntelPerson(id);
  if (!person) notFound();
  const emails = person.methods.filter((m) => m.kind === "EMAIL");
  const phones = person.methods.filter((m) => m.kind === "PHONE");
  const lookalikes = await listPersonLookalikes(person.id, person.firstName, person.lastName);
  const openConflicts = [...person.conflictsLeft, ...person.conflictsRight];
  const facts = collectUploadedFacts(person.sourceRows);
  const ladder = buildSearchLadder({
    firstName: person.firstName,
    lastName: person.lastName,
    addresses: person.addresses,
  });
  const identity = scoreContactIdentity({
    emails: emails.length,
    phones: phones.length,
    firstName: person.firstName,
    lastName: person.lastName,
    addresses: person.addresses,
    sourceRows: person.sourceRows.length,
    customFields: person.customValues.length,
    openConflicts: openConflicts.length,
    lookalikes: lookalikes.length,
    voterMatched: person.voterMatch?.status === "MATCHED",
  });
  const voter = interpretVoterIdentity({
    status: person.voterMatch?.status ?? null,
    voterId: person.voterMatch?.voterId ?? null,
  });

  return (
    <div className="dossier">
      <p>
        <Link className="plain" href="/">
          ← Library
        </Link>
      </p>

      <section className="dossier-hero">
        <div className="portrait" aria-hidden="true">
          <span>{initialsFromName(person.displayName)}</span>
          <em>Photo later</em>
        </div>
        <div>
          <p className="kicker">Contact file</p>
          <h2>{person.displayName}</h2>
          <p className="muted">{[person.firstName, person.lastName].filter(Boolean).join(" ") || "Name parts unknown"}</p>
          <div className="chip-row">
            {person.personTags.map((pt) => (
              <span key={pt.id} className="chip">
                {pt.tag.name}
              </span>
            ))}
            {person.personTags.length === 0 ? <span className="muted">No tags yet</span> : null}
          </div>
        </div>
        <div className="score-card">
          <div className="stat-label">Identity confidence</div>
          <div className="stat-value">{identity.percent}%</div>
          <p className="muted">
            {identity.band === "strong" ? "Strong file" : identity.band === "usable" ? "Usable file" : "Thin file"} · {identity.score}/{identity.max}
          </p>
        </div>
      </section>

      {openConflicts.length > 0 ? (
        <p className="banner banner-warn">
          Open identifier conflict. Email and phone point at two people — Oscar will not merge on name.{" "}
          <Link className="plain" href="/review/dedupe">
            Open de-dupe queue
          </Link>
        </p>
      ) : null}
      {lookalikes.length > 0 ? (
        <p className="banner banner-oscar">
          Same first and last name on {lookalikes.length} other file{lookalikes.length === 1 ? "" : "s"}. Review only — names never merge.
        </p>
      ) : null}

      <section className="grid grid-2">
        <div className="card">
          <h3>How we know this is one person</h3>
          <ul className="factor-list">
            {identity.factors.map((f) => (
              <li key={f.key} data-on={f.present ? "1" : "0"}>
                <span>{f.present ? "●" : "○"}</span> {f.label} <em>{f.points}</em>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3>Voter identity</h3>
          <p className="stat-value" style={{ fontSize: 22 }}>
            {voter.typeLabel}
          </p>
          <p className="muted">Type accuracy {voter.accuracyPercent}% until the voter registration file is linked.</p>
          <p>{voter.note}</p>
          {person.voterMatch?.voterId ? (
            <p>
              Attached ID <strong>{person.voterMatch.voterId}</strong>
            </p>
          ) : null}
          <ol className="ladder">
            {ladder.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <form action={saveContactIntelVoterIdAction}>
            <input type="hidden" name="personId" value={person.id} />
            <label>
              Voter ID
              <input name="voterId" placeholder="From the registration file" defaultValue={person.voterMatch?.voterId ?? ""} />
            </label>
            <p>
              <button className="btn btn-primary" type="submit">
                Attach voter ID
              </button>
            </p>
          </form>
          <form action={markContactIntelVoterNoMatchAction}>
            <input type="hidden" name="personId" value={person.id} />
            <button className="btn btn-fog" type="submit">
              No match in the file
            </button>
          </form>
        </div>
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
          <p className="muted">Source values only. Never used to merge people.</p>
          <ul>
            {person.addresses.length === 0 ? <li className="muted">None</li> : null}
            {person.addresses.map((a) => (
              <li key={a.id}>{[a.line, a.city, a.state, a.postalCode].filter(Boolean).join(", ") || "Partial address"}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3>Custom fields</h3>
          <div className="fact-grid">
            {person.customValues.length === 0 ? <p className="muted">None yet</p> : null}
            {person.customValues.map((v) => (
              <div key={v.id} className="fact">
                <div className="stat-label">{v.definition.label}</div>
                <div>{v.originalValue}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Everything from the uploads</h3>
        <p className="lede">If a column was on a sheet attached to this person, it is here — mapped or not.</p>
        <div className="fact-grid">
          {facts.length === 0 ? <p className="muted">No source cells yet.</p> : null}
          {facts.map((fact) => (
            <div key={fact.key} className="fact">
              <div className="stat-label">{fact.key}</div>
              {fact.values.map((item) => (
                <div key={`${item.file}-${item.rowNumber}-${item.value}`}>
                  {item.value}
                  <div className="muted">
                    {item.file} · row {item.rowNumber}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {lookalikes.length > 0 ? (
        <section className="card">
          <h3>Same-name lookalikes</h3>
          <p className="muted">Do not merge these unless email or phone is the same. Open each file and compare.</p>
          <ul>
            {lookalikes.map((other) => (
              <li key={other.id}>
                <Link className="plain" href={`/contacts/${other.id}`}>
                  {other.displayName}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
                    {row.job.sourceLabel ? <div className="muted">{row.job.sourceLabel}</div> : null}
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
