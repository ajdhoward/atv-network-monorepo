#!/usr/bin/env node
// Pushes the runtime config the Worker reads into the KV namespaces bound by
// wrangler.toml (the staging ones once `pnpm kv:staging` has run).
//
//   node scripts/seed-kv.mjs                     # uses packages/ui-shared/src/config.example.json
//   node scripts/seed-kv.mjs --file ./atv.json   # any file with the same shape
//   node scripts/seed-kv.mjs --dry-run           # print the wrangler commands only
//   node scripts/seed-kv.mjs --prune             # also delete owned keys this file omits
//   node scripts/seed-kv.mjs --local --file atv-config.json   # the `wrangler dev` store
//   node scripts/seed-kv.mjs --config wrangler.cutover.toml --file atv-config.json
//
// --config seeds the KV namespaces of another wrangler config (a production
// cutover, say) instead of wrangler.toml. The shared-namespace guard reads that
// same file, so a config bound to production KV is still refused.
//
// --local writes the store `wrangler dev --local` reads instead of remote KV, so
// a fresh clone can run the TV client with a real lineup and needs no Cloudflare
// credentials. The remote-only guard is skipped there: local keys are not shared.
//
// Remote seeding requires an authenticated wrangler (`npx wrangler login` or CLOUDFLARE_API_TOKEN).
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
const local = args.includes("--local");
const configFile = flag("config", "wrangler.toml");

// Seeding writes ATV_CONFIG, so a sandbox config still bound to the production
// namespaces would overwrite the live lineup. Create the staging ones instead.
if (!dryRun && !local && process.env.ATV_ALLOW_SHARED_KV !== "1") {
  let text;
  try {
    text = fs.readFileSync(configFile, "utf8");
  } catch (err) {
    console.error(`✗ Cannot read ${configFile}: ${err.message}`);
    process.exit(1);
  }
  const shared = sharedProductionIds(text);
  if (shared.length) {
    console.error(`✗ ${configFile} still binds production KV: ` + shared.join(", "));
    console.error("  Create separate namespaces first: pnpm kv:staging");
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
// The default file is the empty example config. Seeding it by accident produces a
// deployed worker with a 0-channel guide, which looks like a bug in the Worker.
if (!config.channels.length && !args.includes("--allow-empty")) {
  console.error(`✗ ${file} has no channels; seeding it would serve an empty guide.`);
  console.error("  Pass a real lineup:  node scripts/seed-kv.mjs --file ./atv-config.json");
  console.error("  Or seed an empty lineup on purpose: --allow-empty");
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
// Channel -> TorBox item. No token lives here: the Worker reads that secret at
// resolve time and returns the temporary CDN link, never the token.
if (config.torbox_map && typeof config.torbox_map === "object") {
  entries.push(["ATV_CONFIG", "torbox_map", config.torbox_map]);
}
if (!config.channels.length) {
  console.warn("⚠ No channels in this file: /api/guide will serve an empty lineup.");
}

// The keys this script owns. Without --prune, a key dropped from the config (an
// emptied `idents`, say) keeps being served from KV forever.
const OWNED_KEYS = [
  "channels",
  "system_config",
  "config_meta",
  "idents",
  "gdrive_map",
  "torbox_map",
];
const prune = args.includes("--prune");
const writtenKeys = new Set(entries.map(([, key]) => key));

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
    ...(local ? ["--local"] : ["--remote"]),
    "--config",
    configFile,
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

if (prune) {
  for (const key of OWNED_KEYS.filter((candidate) => !writtenKeys.has(candidate))) {
    const cmd = [
      "wrangler",
      "kv",
      "key",
      "delete",
      key,
      "--binding=ATV_CONFIG",
      ...(local ? ["--local"] : ["--remote"]),
      "--config",
      configFile,
    ];
    console.log(`→ delete ATV_CONFIG/${key}`);
    if (dryRun) {
      console.log(`  npx ${cmd.join(" ")}`);
      continue;
    }
    const run = spawnSync("npx", cmd, { stdio: "inherit" });
    if (run.status !== 0) failed++;
  }
}

if (failed) {
  console.error(`✗ ${failed} key(s) failed to upload.`);
  process.exit(1);
}
console.log(dryRun ? "Dry run complete." : `Seeded ${entries.length} key(s) via ${configFile}.`);
