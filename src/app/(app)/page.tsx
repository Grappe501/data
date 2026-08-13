import Link from "next/link";
import { contactIntelLibraryStats, searchContactIntelPeople } from "@/lib/contact-intel/queries";

type Props = { searchParams: Promise<{ q?: string }> };

export default async function LibraryPage({ searchParams }: Props) {
  const { q = "" } = await searchParams;
  const [stats, people] = await Promise.all([contactIntelLibraryStats(), searchContactIntelPeople(q, 75)]);

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
      </section>

      <form className="search" action="/" method="get">
        <input name="q" defaultValue={q} placeholder="Search email, phone, or name" />
        <button className="btn btn-fog" type="submit">
          Search
        </button>
      </form>

      <div className="scroll card" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Emails</th>
              <th>Phones</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  {q ? "No matches." : "No contacts yet. Import a spreadsheet to start."}
                </td>
              </tr>
            ) : (
              people.map((person) => {
                const emails = person.methods.filter((m) => m.kind === "EMAIL");
                const phones = person.methods.filter((m) => m.kind === "PHONE");
                return (
                  <tr key={person.id}>
                    <td>
                      <Link className="plain" href={`/contacts/${person.id}`}>
                        {person.displayName}
                      </Link>
                    </td>
                    <td>{emails.map((m) => m.normalizedValue).join(", ") || "—"}</td>
                    <td>{phones.map((m) => m.originalValue).join(", ") || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
