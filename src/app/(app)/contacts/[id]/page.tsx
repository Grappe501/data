import Link from "next/link";
import { notFound } from "next/navigation";
import { markContactIntelVoterNoMatchAction, saveContactIntelVoterIdAction } from "@/app/actions";
import {
  buildOscarDeskNotes,
  buildSearchLadder,
  groupSheetDrawers,
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
  const openConflicts = [
    ...person.conflictsLeft.map((c) => ({
      id: c.id,
      reason: c.reason,
      otherId: c.rightPerson.id,
      otherName: c.rightPerson.displayName,
      file: c.sourceRow.job.originalFilename,
    })),
    ...person.conflictsRight.map((c) => ({
      id: c.id,
      reason: c.reason,
      otherId: c.leftPerson.id,
      otherName: c.leftPerson.displayName,
      file: c.sourceRow.job.originalFilename,
    })),
  ];
  const drawers = groupSheetDrawers(person.sourceRows);
  const sheets = drawers.map((d) => d.sourceLabel || d.filename);
  const oscarNotes = buildOscarDeskNotes({
    displayName: person.displayName,
    methods: person.methods,
    addresses: person.addresses,
    sheets,
    conflicts: openConflicts,
    lookalikes: lookalikes.map((other) => ({
      id: other.id,
      displayName: other.displayName,
      methods: other.methods,
      addresses: other.addresses,
      sheets: [...new Set(other.sourceRows.map((r) => r.job.sourceLabel || r.job.originalFilename))],
    })),
  });
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
    <div className="desk">
      <p className="desk-nav">
        <Link className="plain" href="/">
          ← Library
        </Link>
      </p>

      <aside className="desk-rail">
        <div className="portrait" aria-hidden="true">
          <span>{initialsFromName(person.displayName)}</span>
          <em>Photo later</em>
        </div>
        <p className="kicker">Person desk</p>
        <h2>{person.displayName}</h2>
        <p className="muted">{[person.firstName, person.lastName].filter(Boolean).join(" ") || "Name parts unknown"}</p>
        <div className="chip-row">
          {person.personTags.map((pt) => (
            <span key={pt.id} className="chip">
              {pt.tag.name}
            </span>
          ))}
        </div>
        <div className="score-card" style={{ textAlign: "left", marginTop: 16 }}>
          <div className="stat-label">Identity confidence</div>
          <div className="stat-value">{identity.percent}%</div>
          <p className="muted">
            {identity.band === "strong" ? "Strong file" : identity.band === "usable" ? "Usable file" : "Thin file"}
          </p>
        </div>
        <h3>Identity keys</h3>
        <p className="stat-label">Emails</p>
        <ul>
          {emails.length === 0 ? <li className="muted">None</li> : null}
          {emails.map((m) => (
            <li key={m.id}>{m.normalizedValue}</li>
          ))}
        </ul>
        <p className="stat-label">Phones</p>
        <ul>
          {phones.length === 0 ? <li className="muted">None</li> : null}
          {phones.map((m) => (
            <li key={m.id}>{m.originalValue}</li>
          ))}
        </ul>
        <p className="stat-label">Addresses</p>
        <ul>
          {person.addresses.length === 0 ? <li className="muted">None — not used to merge</li> : null}
          {person.addresses.map((a) => (
            <li key={a.id}>{[a.line, a.city, a.state, a.postalCode].filter(Boolean).join(", ")}</li>
          ))}
        </ul>
        <h3>Voter</h3>
        <p>
          <strong>{voter.typeLabel}</strong>
        </p>
        <p className="muted">Type accuracy {voter.accuracyPercent}%</p>
        {person.voterMatch?.voterId ? (
          <p>
            ID <strong>{person.voterMatch.voterId}</strong>
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
            No match
          </button>
        </form>
        <h3>How we know</h3>
        <ul className="factor-list">
          {identity.factors.map((f) => (
            <li key={f.key} data-on={f.present ? "1" : "0"}>
              <span>{f.present ? "●" : "○"}</span> {f.label}
            </li>
          ))}
        </ul>
      </aside>

      <main className="desk-blotter">
        {oscarNotes.map((note) => (
          <section key={note.title} className={`oscar-note oscar-note-${note.severity}`}>
            <p className="kicker">Oscar</p>
            <h3>{note.title}</h3>
            <p>{note.body}</p>
            {note.href ? (
              <p>
                <Link className="plain" href={note.href}>
                  {note.hrefLabel}
                </Link>
                {note.severity === "conflict" ? (
                  <>
                    {" · "}
                    <Link className="plain" href="/review/dedupe">
                      De-dupe queue
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </section>
        ))}

        {person.customValues.length > 0 ? (
          <section className="desk-strip">
            <p className="kicker">Current custom fields</p>
            <div className="fact-grid">
              {person.customValues.map((v) => (
                <div key={v.id} className="fact">
                  <div className="stat-label">{v.definition.label}</div>
                  <div>{v.originalValue}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <p className="kicker">Sheets on this desk</p>
          <h3>Every row that built this file</h3>
          <p className="lede">If it was on the spreadsheet, it is in the drawer. Mapped columns and leftover columns stay together.</p>
          {drawers.length === 0 ? <p className="muted">No source sheets yet.</p> : null}
          {drawers.map((drawer) => (
            <article key={drawer.jobId} className="sheet-drawer">
              <header>
                <h3>
                  <Link className="plain" href={`/import/${drawer.jobId}`}>
                    {drawer.sourceLabel || drawer.filename}
                  </Link>
                </h3>
                <p className="muted">
                  {drawer.filename} · {drawer.rows.length} row{drawer.rows.length === 1 ? "" : "s"} ·{" "}
                  {drawer.importedAt.slice(0, 16).replace("T", " ")}
                </p>
              </header>
              {drawer.rows.map((row) => (
                <div key={row.id} className="drawer-row">
                  <p className="muted">
                    Row {row.rowNumber} · {row.status}
                  </p>
                  <div className="fact-grid">
                    {row.cells.length === 0 ? <p className="muted">Empty row</p> : null}
                    {row.cells.map((cell) => (
                      <div key={`${row.id}-${cell.key}`} className="fact">
                        <div className="stat-label">{cell.key}</div>
                        <div>{cell.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
