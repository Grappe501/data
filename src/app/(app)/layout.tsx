import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdminPage } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <div className="wrap">
      <header className="header">
        <div>
          <p className="kicker">Grappe501 / data · RedDirt database</p>
          <h1>Contact Intelligence</h1>
          <p className="lede">One library for every email and phone you ingest. Original rows stay attached. Nothing is sent.</p>
        </div>
        <nav className="nav">
          <Link href="/">Library</Link>
          <Link href="/review/dedupe">De-dupe</Link>
          <Link href="/review/set">Review set</Link>
          <Link href="/review/voters">Voter queue</Link>
          <Link href="/memory">Sheet memory</Link>
          <Link className="btn-fog" href="/import">
            Import
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
