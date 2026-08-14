"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

type Props = {
  label: string;
  pendingLabel: string;
  jobId?: string;
  fileHint?: string;
  className?: string;
};

function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

export function WorkingSubmit({ label, pendingLabel, jobId, fileHint, className }: Props) {
  const { pending } = useFormStatus();
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) {
      setElapsed(0);
      setDone(0);
      setTotal(0);
      setMessage(null);
      return;
    }
    const started = Date.now();
    const tick = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 500);
    let poll: number | undefined;
    if (jobId) {
      const read = async () => {
        try {
          const res = await fetch(`/api/import/${jobId}/progress`, { cache: "no-store" });
          if (!res.ok) return;
          const body = (await res.json()) as { done?: number; total?: number; message?: string | null };
          if (typeof body.done === "number") setDone(body.done);
          if (typeof body.total === "number") setTotal(body.total);
          if (body.message) setMessage(body.message);
        } catch {
          /* keep last known progress */
        }
      };
      void read();
      poll = window.setInterval(read, 1000);
    }
    return () => {
      window.clearInterval(tick);
      if (poll) window.clearInterval(poll);
    };
  }, [pending, jobId]);

  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  const rate = elapsed > 1 && done > 0 ? done / elapsed : 0;
  const remaining = rate > 0 && total > done ? (total - done) / rate : null;

  return (
    <div className="progress-wrap">
      <button className={className ?? "btn btn-fog"} type="submit" disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : label}
      </button>
      {pending ? (
        <div className="progress-overlay" role="status" aria-live="polite">
          <p className="progress-title">{pendingLabel}</p>
          {fileHint ? <p className="muted">{fileHint}</p> : null}
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: pct == null ? "35%" : `${pct}%` }}
              data-indeterminate={pct == null ? "1" : "0"}
            />
          </div>
          <p className="progress-meta">
            {pct != null ? `${done.toLocaleString()} of ${total.toLocaleString()} rows · ${pct}%` : "Working…"}
            {" · "}
            elapsed {formatSeconds(elapsed)}
            {remaining != null ? ` · about ${formatSeconds(remaining)} left` : total > 0 ? " · estimating…" : ""}
          </p>
          {message ? <p className="progress-meta">{message}</p> : null}
          <p className="progress-meta">Keep this tab open. Large files can take several minutes.</p>
        </div>
      ) : null}
    </div>
  );
}
