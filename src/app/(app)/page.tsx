import Link from "next/link";
import { WorkingSetTable } from "@/app/(app)/WorkingSetTable";
import { runOscarAsk } from "@/lib/contact-intel/oscar-ask";
import { contactIntelLibraryStats, searchContactIntelPeople } from "@/lib/contact-intel/queries";

type Props = { searchParams: Promise<{ q?: string; ask?: string; set?: string }> };

const EXAMPLES = [
  "everyone from the county fair sheet with no phone",
  "people tagged volunteer in Little Rock",
  "who still needs a voter ID",
  "people tagged Needs review",
  "what custom fields do we have",
];

export default async function LibraryPage({ searchParams }: Props) {
  const { q = "", ask = "", set } = await searchParams;
  const asked = ask.trim();
  const [stats, askedResult, searched] = await Promise.all([
    contactIntelLibraryStats(),
    asked ? runOscarAsk(asked, 100) : Promise.resolve(null),
    asked ? Promise.resolve([]) : searchContactIntelPeople(q, 75),
  ]);
  const people = askedResult?.people ?? searched;
  const catalog = askedResult?.catalog ?? [];
  const isCatalog = askedResult?.plan.intent === "catalog";

  return (
    <div>
      <section className="grid grid-4">
        <div className="card">
          <div className="stat-label">People</div>
          <div className="stat-value">{stats.people}</div>
        </div>
        <div className="card">
          <div className="stat-label">Emails</div>
          <div className="stat-value">{stats.emailCount}</div>
        </div>
        <div className="card">
          <div className="stat-label">Phones</div>
          <div className="stat-value">{stats.phoneCount}</div>
        </div>
        <div className="card">
          <div className="stat-label">Imports</div>
          <div className="stat-value">{stats.jobs}</div>
        </div>
        <div className="card">
          <div className="stat-label">De-dupe open</div>
          <div className="stat-value">{stats.openConflicts}</div>
          <p>
            <Link className="plain" href="/review/dedupe">
              Queue
            </Link>
          </p>
        </div>
        <div className="card">
          <div className="stat-label">Need voter ID</div>
          <div className="stat-value">{stats.unmatchedVoters}</div>
          <p>
            <Link className="plain" href="/review/voters">
              Queue
            </Link>
          </p>
        </div>
      </section>

      <form className="ask-bar" action="/" method="get">
        <label>
          Ask Oscar
          <input
            name="ask"
            defaultValue={asked}
            placeholder="everyone from the county fair sheet with an employer and no phone"
          />
        </label>
        <button className="btn btn-primary" type="submit">
          Ask Oscar
        </button>
      </form>
      <p className="chip-row">
        {EXAMPLES.map((example) => (
          <Link key={example} className="chip" href={`/?ask=${encodeURIComponent(example)}`}>
            {example}
          </Link>
        ))}
      </p>

      <form className="search" action="/" method="get">
        <input name="q" defaultValue={asked ? "" : q} placeholder="Exact search: email, phone, or name" />
        <button className="btn btn-fog" type="submit">
          Search
        </button>
      </form>

      {set === "tagged" ? <p className="banner banner-ok">Tag applied to the selected people.</p> : null}
      {set === "reviewed" ? (
        <p className="banner banner-ok">
          Marked for review.{" "}
          <Link className="plain" href="/review/set">
            Open the review set
          </Link>
        </p>
      ) : null}
      {set === "empty" ? <p className="banner banner-warn">Select people and, for a tag, enter a name.</p> : null}
      {askedResult ? (
        <p className={askedResult.plan.sourceKind === "openai" ? "banner banner-oscar" : "banner banner-ok"}>
          <strong>Oscar.</strong> {askedResult.plan.summary}{" "}
          {isCatalog ? `${askedResult.total} catalog rows.` : `${askedResult.total} people.`}
        </p>
      ) : null}

      {isCatalog ? (
        <div className="scroll card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name</th>
                <th>Key</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {catalog.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    Oscar has no catalog rows for that yet.
                  </td>
                </tr>
              ) : (
                catalog.map((row) => (
                  <tr key={`${row.kind}-${row.key}`}>
                    <td>{row.kind}</td>
                    <td>
                      {row.kind === "sheet" ? (
                        <Link className="plain" href={`/import/${row.key}`}>
                          {row.label}
                        </Link>
                      ) : (
                        row.label
                      )}
                    </td>
                    <td className="muted">{row.key}</td>
                    <td className="muted">{row.extra || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <WorkingSetTable
          returnTo={asked ? `/?ask=${encodeURIComponent(asked)}` : q ? `/?q=${encodeURIComponent(q)}` : "/"}
          empty={asked || q ? "No matches." : "No contacts yet. Import a spreadsheet, then ask Oscar a question."}
          rows={people.map((person) => {
            const emails = person.methods.filter((m) => m.kind === "EMAIL");
            const phones = person.methods.filter((m) => m.kind === "PHONE");
            const extra = person as {
              addresses?: { city: string | null; state: string | null }[];
              sourceRows?: { job: { originalFilename: string; sourceLabel: string | null } }[];
              personTags?: { tag: { name: string } }[];
            };
            return {
              id: person.id,
              displayName: person.displayName,
              emails: emails.map((m) => m.normalizedValue).join(", "),
              phones: phones.map((m) => m.originalValue).join(", "),
              place: extra.addresses?.map((a) => [a.city, a.state].filter(Boolean).join(", ")).filter(Boolean)[0] ?? "",
              source: extra.sourceRows?.[0]?.job.sourceLabel || extra.sourceRows?.[0]?.job.originalFilename || "",
              tags: extra.personTags?.map((pt) => pt.tag.name).filter(Boolean).join(", ") ?? "",
              voter: person.voterMatch?.voterId || person.voterMatch?.status || "unmatched",
            };
          })}
        />
      )}
    </div>
  );
}
