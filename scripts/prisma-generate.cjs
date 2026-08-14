#!/usr/bin/env node
/**
 * Generate the Prisma client into src/generated/prisma.
 * Does not connect to the database. Placeholder URL is only used when CI
 * has not injected DATABASE_URL yet (generate still requires the env key).
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://ci:ci@127.0.0.1:5432/ci";
}

const result = spawnSync("npx", ["prisma", "generate"], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
