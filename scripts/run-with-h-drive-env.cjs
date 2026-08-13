#!/usr/bin/env node
/**
 * Pin TEMP/npm cache to H:\SOSWebsite\.local and load RedDirt env without copying secrets into this repo.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const localRoot = path.join(workspaceRoot, ".local");
const tempDir = path.join(localRoot, "temp");
const npmCache = path.join(localRoot, "npm-cache");
const reddirtRoot = path.join(workspaceRoot, "RedDirt");

for (const dir of [localRoot, tempDir, npmCache]) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    process.env[key] = value;
  }
}

loadEnvFile(path.join(reddirtRoot, ".env"));
loadEnvFile(path.join(reddirtRoot, ".env.local"));
loadEnvFile(path.join(repoRoot, ".env"));
loadEnvFile(path.join(repoRoot, ".env.local"));

const isCiBuild = Boolean(process.env.NETLIFY || process.env.CI);
const env = {
  ...process.env,
  TEMP: isCiBuild ? process.env.TEMP : tempDir,
  TMP: isCiBuild ? process.env.TMP : tempDir,
};

if (!env.NODE_OPTIONS?.includes("max-old-space-size")) {
  env.NODE_OPTIONS = [env.NODE_OPTIONS, "--max-old-space-size=4096"].filter(Boolean).join(" ");
}

if (!isCiBuild && process.platform === "win32") {
  env.npm_config_cache = npmCache;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-with-h-drive-env.cjs <command> [args...]");
  process.exit(1);
}

const [command, ...rest] = args;
const result = spawnSync(command, rest, {
  cwd: repoRoot,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
