"use client";

import { useState } from "react";
import { WorkingSubmit } from "./WorkingSubmit";

type Props = {
  action: (formData: FormData) => Promise<void>;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadForm({ action }: Props) {
  const [hint, setHint] = useState("");

  return (
    <form action={action}>
      <label>
        Source label (optional)
        <input name="sourceLabel" placeholder="e.g. 2024 county fair sheet" />
      </label>
      <label>
        File
        <input
          name="file"
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          required
          onChange={(e) => {
            const file = e.target.files?.[0];
            setHint(file ? `${file.name} · ${formatBytes(file.size)}` : "");
          }}
        />
      </label>
      <WorkingSubmit label="Upload and map" pendingLabel="Uploading and saving rows…" fileHint={hint} />
    </form>
  );
}
