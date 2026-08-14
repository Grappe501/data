# Contact Intelligence (`Grappe501/data`)

Standalone dashboard for ingesting contacts into the **existing RedDirt Postgres database**.

Repo: [https://github.com/Grappe501/data](https://github.com/Grappe501/data)

This repository is the product. RedDirt remains the campaign OS. Contact tables already live on the RedDirt database (`ContactIntelPerson`, `ContactIntelMethod`, `ContactIntelImportJob`, `ContactIntelSourceRow`, `ContactIntelConflict`).

## Hard rules

- Keep all local work on `H:\SOSWebsite`. Cache/temp: `H:\SOSWebsite\.local\`.
- Never commit `.env`, contact files, or real PII.
- Do **not** run `prisma migrate deploy` from this repo. The Prisma schema here is a **generate-only subset**. Migrations stay in RedDirt so we cannot drop unrelated tables.
- Import is not consent to email or text. This app does not send.

## Local run (H:)

```bash
cd H:\SOSWebsite\data-upload
node scripts/run-with-h-drive-env.cjs npm run prisma:generate
node scripts/run-with-h-drive-env.cjs npm run dev
```

Netlify must run `prisma generate` before `next build` (`postinstall` + `npm run build`). Set `DATABASE_URL` in the Netlify site env (Neon extension or the RedDirt Postgres URL). Do not run `prisma migrate deploy` from this repo.

Open [http://localhost:3005](http://localhost:3005)

The wrapper loads `H:\SOSWebsite\RedDirt\.env` and `.env.local` (DATABASE_URL, DIRECT_URL, ADMIN_SECRET) without copying those files into this repo.

Localhost in development skips the passphrase unless `ADMIN_REQUIRE_AUTH_ON_LOCALHOST=1`.

## First ingest

1. Import a CSV or XLSX.
2. Map columns to email / phone / name / ignore.
3. Preview new / update / invalid / conflict.
4. Commit.
5. Search by email, phone, or name.

A row needs at least one valid email or phone. Extra unmapped columns stay on the original source row.

## Visibility

This GitHub repo was created **public**. Contact intelligence is a PII system. Make the repository **private** before it holds operator notes or screenshots.
