import Link from "next/link";
import { WorkingSetTable } from "@/app/(app)/WorkingSetTable";
import { CONTACT_INTEL_REVIEW_TAG, listReviewWorkingSet } from "@/lib/contact-intel/working-set";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { searchParams: Promise<{ set?: string }> };

export default async function ReviewSetPage({ searchParams }: Props) {
  const { set } = await searchParams;
  const people = await listReviewWorkingSet();
  const rows = people.map((person) => {
    const emails = person.methods.filter((m) => m.kind === "EMAIL").map((m) => m.normalizedValue);
    const phones = person.methods.filter((m) => m.kind === "PHONE").map((m) => m.originalValue);
    const place = person.addresses.map((a) => [a.city, a.state].filter(Boolean).join(", ")).find(Boolean) ?? "";
    const source = person.sourceRows[0]?.job.sourceLabel || person.sourceRows[0]?.job.originalFilename || "";
    return {
      id: person.id,
      displayName: person.displayName,
      emails: emails.join(", "),
      phones: phones.join(", "),
      place,
      source,
      tags: person.personTags.map((pt) => pt.tag.name).join(", "),
      voter: person.voterMatch?.voterId || person.voterMatch?.status || "unmatched",
    };
  });

  return (
    <div>
      <p>
        <Link className="plain" href="/">
          ← Library
        </Link>
      </p>
      <section className="card">
        <h2>Review set</h2>
        <p className="lede">
          People marked <strong>{CONTACT_INTEL_REVIEW_TAG}</strong> from a working set. Tag them again, export the CSV, or
          open a desk. Nothing is sent.
        </p>
      </section>
      {set === "tagged" ? <p className="banner banner-ok">Tag applied to the selected people.</p> : null}
      {set === "reviewed" ? <p className="banner banner-ok">Added to the review set.</p> : null}
      {set === "empty" ? <p className="banner banner-warn">Select people and, for a tag, enter a name.</p> : null}
      <WorkingSetTable rows={rows} empty="No one is marked for review." returnTo="/review/set" />
    </div>
  );
}
