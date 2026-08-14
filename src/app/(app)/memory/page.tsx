import Link from "next/link";
import { listOscarSheetMemory, oscarMappingCounts } from "@/lib/contact-intel/oscar-lessons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function OscarMemoryPage() {
  const memories = await listOscarSheetMemory();

  return (
    <div>
      <p>
        <Link className="plain" href="/import">
          ← Import
        </Link>
      </p>
      <section className="card">
        <p className="kicker">Oscar</p>
        <h2>Sheet memory</h2>
        <p className="lede">
          These are the spreadsheet shapes Oscar already knows. Confirm a mapping once. The next file with the same
          columns gets the assignment. A new column and he taps you.
        </p>
        <p className="muted">{memories.length} shape{memories.length === 1 ? "" : "s"} in memory.</p>
      </section>

      {memories.length === 0 ? (
        <p className="muted">No learned sheets yet. Upload a file, apply mapping and preview, and Oscar will remember it.</p>
      ) : null}

      <div className="memory-grid">
        {memories.map((memory) => {
          const counts = oscarMappingCounts(memory.columns);
          return (
            <Link key={memory.shapeId} className="memory-card" href={`/memory/${memory.shapeId}`}>
              <p className="kicker">{memory.seen === 1 ? "Seen once" : `Seen ${memory.seen} times`}</p>
              <h3>{memory.title}</h3>
              {memory.aliases.length > 1 ? <p className="muted">Also {memory.aliases.slice(1, 4).join(" · ")}</p> : null}
              <p>
                {counts.mapped} assigned · {counts.custom} custom · {counts.ignored} ignored
              </p>
              <p className="muted">
                Last {memory.lastFilename} · {memory.lastAt.slice(0, 16).replace("T", " ")}
              </p>
              <div className="chip-row">
                {memory.headers.slice(0, 8).map((header) => (
                  <span key={header} className="chip">
                    {header}
                  </span>
                ))}
                {memory.headers.length > 8 ? <span className="chip">+{memory.headers.length - 8}</span> : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
