"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { markContactIntelReviewAction, tagContactIntelWorkingSetAction } from "@/app/actions";

export type WorkingSetRow = {
  id: string;
  displayName: string;
  emails: string;
  phones: string;
  place: string;
  source: string;
  tags: string;
  voter: string;
};

type Props = {
  rows: WorkingSetRow[];
  empty: string;
  returnTo: string;
};

export function WorkingSetTable({ rows, empty, returnTo }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const chosen = useMemo(() => rows.filter((row) => selected[row.id]).map((row) => row.id), [rows, selected]);
  const allOn = rows.length > 0 && chosen.length === rows.length;

  if (rows.length === 0) {
    return (
      <div className="scroll card" style={{ padding: 16 }}>
        <p className="muted">{empty}</p>
      </div>
    );
  }

  return (
    <form>
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="working-bar">
        <strong>{chosen.length}</strong> selected
        <input name="tag" placeholder="Tag name e.g. county fair" />
        <button className="btn btn-fog" type="submit" formAction={tagContactIntelWorkingSetAction} disabled={chosen.length === 0}>
          Tag
        </button>
        <button className="btn btn-fog" type="submit" formAction={markContactIntelReviewAction} disabled={chosen.length === 0}>
          Mark for review
        </button>
        <button className="btn btn-primary" type="submit" formAction="/api/export/people" formMethod="post" disabled={chosen.length === 0}>
          Export CSV
        </button>
        <span className="muted">Nothing is sent.</span>
      </div>
      <div className="scroll card" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) => {
                    const next: Record<string, boolean> = {};
                    if (e.target.checked) for (const row of rows) next[row.id] = true;
                    setSelected(next);
                  }}
                  aria-label="Select all"
                />
              </th>
              <th>Person</th>
              <th>Emails</th>
              <th>Phones</th>
              <th>Place</th>
              <th>Source</th>
              <th>Voter</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    name="personId"
                    value={row.id}
                    checked={Boolean(selected[row.id])}
                    onChange={(e) => setSelected((cur) => ({ ...cur, [row.id]: e.target.checked }))}
                  />
                </td>
                <td>
                  <Link className="plain" href={`/contacts/${row.id}`}>
                    {row.displayName}
                  </Link>
                  {row.tags ? <div className="muted">{row.tags}</div> : null}
                </td>
                <td>{row.emails || "—"}</td>
                <td>{row.phones || "—"}</td>
                <td className="muted">{row.place || "—"}</td>
                <td className="muted">{row.source || "—"}</td>
                <td className="muted">{row.voter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
