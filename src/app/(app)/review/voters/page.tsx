import Link from "next/link";
import { markContactIntelVoterNoMatchAction, saveContactIntelVoterIdAction } from "@/app/actions";
import { buildSearchLadder, interpretVoterIdentity } from "@/lib/contact-intel/dossier";
import { listVoterMatchQueue } from "@/lib/contact-intel/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function VoterQueuePage() {
  const people = await listVoterMatchQueue();

  return (
    <div>
      <p>
        <Link className="plain" href="/">
          ← Library
        </Link>
      </p>
      <section className="card">
        <h2>Voter match queue</h2>
        <p className="lede">
          Match each contact to a voter ID when you can. Oscar starts at state, then city, ZIP, then name. The
          registration file is not connected yet — attach an ID by hand, or mark no match. This never writes the campaign
          voter table.
        </p>
      </section>

      {people.length === 0 ? <p className="muted">Everyone in the current slice is matched or marked no-match.</p> : null}

      {people.map((person) => {
        const ladder = buildSearchLadder({
          firstName: person.firstName,
          lastName: person.lastName,
          addresses: person.addresses,
        });
        const voter = interpretVoterIdentity({
          status: person.voterMatch?.status ?? null,
          voterId: person.voterMatch?.voterId ?? null,
        });
        const email = person.methods.find((m) => m.kind === "EMAIL")?.normalizedValue;
        const phone = person.methods.find((m) => m.kind === "PHONE")?.originalValue;
        return (
          <section key={person.id} className="card" style={{ marginBottom: 12 }}>
            <h3>
              <Link className="plain" href={`/contacts/${person.id}`}>
                {person.displayName}
              </Link>
            </h3>
            <p className="muted">
              {email || "no email"} · {phone || "no phone"} · {voter.typeLabel}
            </p>
            <ol className="ladder">
              {ladder.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <form action={saveContactIntelVoterIdAction} className="search">
              <input type="hidden" name="personId" value={person.id} />
              <input name="voterId" placeholder="Voter ID" />
              <button className="btn btn-primary" type="submit">
                Attach ID
              </button>
            </form>
            <form action={markContactIntelVoterNoMatchAction}>
              <input type="hidden" name="personId" value={person.id} />
              <button className="btn btn-fog" type="submit">
                No match
              </button>
            </form>
          </section>
        );
      })}
    </div>
  );
}
