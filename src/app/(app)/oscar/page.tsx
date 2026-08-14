import Link from "next/link";
import { OSCAR_TOOLS, oscarSuiteStats, runOscarTool, type OscarToolId } from "@/lib/contact-intel/oscar-tools";
import { listOscarLessons } from "@/lib/contact-intel/oscar-memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { searchParams: Promise<{ tool?: string; q?: string }> };

const TOOL_IDS = new Set(OSCAR_TOOLS.map((t) => t.id));

export default async function OscarSuitePage({ searchParams }: Props) {
  const { tool: toolRaw = "", q = "" } = await searchParams;
  const question = q.trim();
  const requested = TOOL_IDS.has(toolRaw as OscarToolId) ? (toolRaw as OscarToolId) : question ? "router" : null;
  const [stats, queryLessons, result] = await Promise.all([
    oscarSuiteStats(),
    listOscarLessons("query", 8),
    requested ? runOscarTool(requested, question || "what should I do next") : Promise.resolve(null),
  ]);

  return (
    <div>
      <section className="card">
        <p className="kicker">Oscar</p>
        <h2>Tool suite</h2>
        <p className="lede">
          One command room. Every tool writes a lesson. Sheet memory, questions, and queue work stack — the next run is
          cheaper than the last. Nothing is sent. Cell values never go to the model.
        </p>
        <form className="ask-bar" action="/oscar" method="get">
          <input type="hidden" name="tool" value="router" />
          <label>
            Command Oscar
            <input
              name="q"
              defaultValue={question}
              placeholder="what should I do next / audit ignored columns / brief Jane Doe"
            />
          </label>
          <button className="btn btn-primary" type="submit">
            Run
          </button>
        </form>
        <p className="muted">
          {stats.sheetShapes} sheet shapes · {stats.queryLessons} learned questions · tools get stronger each use
        </p>
      </section>

      {result ? (
        <section className="card">
          <p className="kicker">Result · {result.tool}</p>
          <h3>{result.title}</h3>
          <p>{result.summary}</p>
          {result.askHref ? (
            <p>
              <Link className="plain" href={result.askHref}>
                Open as a working set
              </Link>
            </p>
          ) : null}
          {result.actions.length > 0 ? (
            <ul>
              {result.actions.map((item) => (
                <li key={item.href + item.title}>
                  <Link className="plain" href={item.href}>
                    {item.title}
                  </Link>
                  <span className="muted">
                    {" "}
                    · {item.count} · {item.why}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {result.lines.length > 0 ? (
            <ul>
              {result.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <h3>Tools</h3>
      <div className="memory-grid">
        {OSCAR_TOOLS.map((tool) => {
          const uses = stats.toolLessons.find((row) => row.key === tool.id)?.uses ?? 0;
          return (
            <Link key={tool.id} className="memory-card" href={tool.id === "ask" ? "/oscar?tool=ask&q=who still needs a voter ID" : tool.href}>
              <p className="kicker">{uses ? `Used ${uses}×` : "Ready"}</p>
              <h3>{tool.name}</h3>
              <p>{tool.blurb}</p>
              <p className="muted">{tool.grows}</p>
            </Link>
          );
        })}
      </div>

      {queryLessons.length > 0 ? (
        <section className="card" style={{ marginTop: 20 }}>
          <h3>Learned questions</h3>
          <p className="muted">Ask them again and Oscar skips the guesswork.</p>
          <ul>
            {queryLessons.map((lesson) => (
              <li key={lesson.id}>
                <Link className="plain" href={`/?ask=${encodeURIComponent(lesson.key)}`}>
                  {lesson.key}
                </Link>
                <span className="muted"> · {lesson.uses}×</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
