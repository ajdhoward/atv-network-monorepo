#!/usr/bin/env node
// Pushes the runtime config the Worker reads into the production KV namespaces.
//
//   node scripts/seed-kv.mjs                     # uses packages/ui-shared/src/config.example.json
//   node scripts/seed-kv.mjs --file ./atv.json   # any file with the same shape
//   node scripts/seed-kv.mjs --dry-run           # print the wrangler commands only
//
// Requires an authenticated wrangler (`npx wrangler login` or CLOUDFLARE_API_TOKEN).
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { sharedProductionIds } from "./lib/kv-namespaces.mjs";
import { CONFIG_SCHEMA_VERSION, configChecksum } from "./lib/config-meta.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const dryRun = args.includes("--dry-run");

// Seeding writes ATV_CONFIG, so a sandbox config still bound to the production
// namespaces would overwrite the live lineup. Create the staging ones instead.
if (!dryRun && process.env.ATV_ALLOW_SHARED_KV !== "1") {
  const shared = sharedProductionIds(fs.readFileSync("wrangler.toml", "utf8"));
  if (shared.length) {
    console.error("✗ wrangler.toml still binds production KV: " + shared.join(", "));
    console.error("  Create separate staging namespaces first: pnpm kv:staging");
    console.error("  Or seed production on purpose: ATV_ALLOW_SHARED_KV=1 pnpm seed");
    process.exit(1);
  }
}
const file = flag("file", "packages/ui-shared/src/config.example.json");

let config;
try {
  config = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (err) {
  console.error(`✗ Cannot read ${file}: ${err.message}`);
  process.exit(1);
}
if (config.version !== 1 || !Array.isArray(config.channels)) {
  console.error("✗ Config failed validation: expected version 1 and a channels array.");
  process.exit(1);
}

const isHttps = (u) => typeof u === "string" && u.startsWith("https://");
const idents = Array.isArray(config.idents) ? config.idents.filter(isHttps) : [];
if (Array.isArray(config.idents) && idents.length !== config.idents.length) {
  console.warn("⚠ Dropped non-HTTPS idents: the Worker refuses to redirect to them.");
}

// config_meta lets the Worker refuse a lineup it cannot understand and warn
// when the channels changed without a re-seed.
const meta = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  checksum: configChecksum(config.channels),
  channels: config.channels.length,
  updatedAt: new Date().toISOString(),
};

const entries = [
  ["ATV_CONFIG", "channels", config.channels],
  ["ATV_CONFIG", "system_config", config],
  ["ATV_CONFIG", "config_meta", meta],
];
if (idents.length) entries.push(["ATV_CONFIG", "idents", idents]);
if (config.gdrive_map && typeof config.gdrive_map === "object") {
  entries.push(["ATV_CONFIG", "gdrive_map", config.gdrive_map]);
} else {
  console.warn("⚠ No gdrive_map in this file: /api/resolve will answer 404 for every id.");
}
if (!config.channels.length) {
  console.warn("⚠ No channels in this file: /api/guide will serve an empty lineup.");
}

let failed = 0;
for (const [binding, key, value] of entries) {
  const tmp = path.join(os.tmpdir(), `atv-kv-${binding}-${key}.json`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  const cmd = [
    "wrangler",
    "kv",
    "key",
    "put",
    key,
    `--binding=${binding}`,
    "--remote",
    "--config",
    "wrangler.toml",
    `--path=${tmp}`,
  ];
  console.log(`→ ${binding}/${key}`);
  if (dryRun) {
    console.log(`  npx ${cmd.join(" ")}`);
    continue;
  }
  const run = spawnSync("npx", cmd, { stdio: "inherit" });
  if (run.status !== 0) failed++;
  fs.rmSync(tmp, { force: true });
}

if (failed) {
  console.error(`✗ ${failed} key(s) failed to upload.`);
  process.exit(1);
}
console.log(dryRun ? "Dry run complete." : `Seeded ${entries.length} key(s).`);
