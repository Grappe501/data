# Contact Intelligence — local runbook

Private ingestion dashboard. Run it on this machine. Do not treat Netlify as the operating path.

## Operating model

| Role | Where |
|------|--------|
| Schema and migrations | `H:\SOSWebsite\RedDirt-contact-intel` |
| Primary dashboard | this repo, [http://localhost:3005](http://localhost:3005) |
| Admin fallback | RedDirt `/admin/contact-intel` on port 3000 |
| Database / env | existing RedDirt Postgres via `.env` / `.env.local` (never committed) |

No local database fork. No cloud deploy required. Contact files stay on H:.

## One-command start

From `H:\SOSWebsite\data-upload`:

```powershell
node scripts/run-with-h-drive-env.cjs npm run local
```

That generates the Prisma client and starts the app on port 3005.

## First-time / after a schema change

Stop any RedDirt `next dev` that is locking Prisma (Ctrl+C in the port 3000 terminal).

```powershell
cd H:\SOSWebsite\RedDirt-contact-intel
node scripts/run-with-h-drive-env.cjs npm run stack:migrate
node scripts/run-with-h-drive-env.cjs npm run typecheck

cd H:\SOSWebsite\data-upload
node scripts/run-with-h-drive-env.cjs npm run local
```

Open [http://localhost:3005](http://localhost:3005). Use synthetic fixtures (`alex@example.com`, `5015550100`) before any real contact file.

## Netlify

`netlify.toml` is retained so a later authenticated remote deploy is recoverable. Automatic production builds are skipped (`ignore = "exit 0"`). Do not treat a Netlify URL as the live tool.

## Fallback admin UI

```powershell
cd H:\SOSWebsite\RedDirt-contact-intel
node scripts/run-with-h-drive-env.cjs npm run dev
```

Then [http://localhost:3000/admin/contact-intel](http://localhost:3000/admin/contact-intel).
