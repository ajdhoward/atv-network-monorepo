#!/usr/bin/env node
// One command from a clone to a local TV client with the real lineup.
//   node scripts/dev.mjs [--port 8788] [--file atv-config.json] [--no-seed] [--dry-run]
//
// Seeds the store `wrangler dev --local` reads (when the lineup file exists) and
// then starts the Worker, so a new contributor does not have to discover the
// local KV commands. No Cloudflare credentials are involved.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const dryRun = args.includes("--dry-run");
const noSeed = args.includes("--no-seed");
const port = flag("port", "8788");
const file = flag("file", "atv-config.json");
const hasLineup = fs.existsSync(file);

const seed = ["scripts/seed-kv.mjs", "--local", "--file", file];
const dev = ["dev", "--local", "--config", "wrangler.toml", "--port", port];

if (dryRun) {
  if (!noSeed && hasLineup) console.log(`node ${seed.join(" ")}`);
  console.log(`wrangler ${dev.join(" ")}`);
  process.exit(0);
}

if (!noSeed) {
  if (hasLineup) {
    const run = spawnSync(process.execPath, seed, { stdio: "inherit" });
    // An unseeded store still serves the client shell; failing the whole run
    // would be worse than an empty guide with a clear warning.
    if (run.status !== 0) console.error("✗ Local seed failed; starting with the existing store.");
  } else {
    console.warn(`⚠ ${file} not found; starting with an unseeded local store.`);
    console.warn("  The guide will be empty. Copy your lineup there, or pass --file <path>.");
  }
}

const child = spawn("wrangler", dev, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
