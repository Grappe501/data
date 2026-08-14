#!/usr/bin/env node
/**
 * Local-only Contact Intelligence launcher.
 * Generate Prisma client, then start the dashboard on port 3005.
 * Uses RedDirt .env via run-with-h-drive-env.cjs. Does not deploy.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const wrapper = path.join(repoRoot, "scripts", "run-with-h-drive-env.cjs");

function run(args, opts = {}) {
  const result = spawnSync(process.execPath, [wrapper, ...args], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(["node", path.join(repoRoot, "scripts", "prisma-generate.cjs")]);
run(["next", "dev", "-p", "3005"]);
