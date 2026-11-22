#!/usr/bin/env node
// Pushes operator-supplied stream links into the Worker secret ATV_GDRIVE_MAP,
// which /api/resolve consults before KV `gdrive_map`. Rotating one link then
// needs no re-seed and no deploy: the Worker reads the new secret on its next
// request.
//
//   node scripts/set-gdrive-map.mjs ./gdrive-map.json
//   node scripts/set-gdrive-map.mjs ./gdrive-map.json --dry-run
//   node scripts/set-gdrive-map.mjs ./gdrive-map.json --config wrangler.production.toml
//
// The file is a JSON object of channel id -> https URL:
//   { "atv-1": "https://…", "atv-news-24": "https://…" }
//
// The script prints ids, never the links. Replacing the secret replaces the
// whole map, so pass every link that should stay resolvable.
import fs from "fs";
import { spawnSync } from "child_process";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const dryRun = args.includes("--dry-run");
const allowUnknown = args.includes("--allow-unknown");
const file = args.find((arg) => !arg.startsWith("-"));
const config = flag("config", "wrangler.toml");
const channelsFile = flag("channels", "atv-config.json");

if (!file) {
  console.error("Usage: node scripts/set-gdrive-map.mjs <map.json> [--dry-run] [--config <toml>]");
  process.exit(1);
}

let map;
try {
  map = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (err) {
  console.error(`✗ Cannot read ${file}: ${err.message}`);
  process.exit(1);
}
if (!map || typeof map !== "object" || Array.isArray(map)) {
  console.error("✗ The map must be a JSON object of channel id -> https URL.");
  process.exit(1);
}

const problems = [];
const ids = Object.keys(map);
if (!ids.length) problems.push("the map has no ids");
for (const id of ids) {
  const url = map[id];
  if (typeof url !== "string") problems.push(`${id}: the URL must be a string`);
  // The Worker refuses anything else with 502 insecure_url, so reject it here
  // where the mistake is still cheap to fix.
  else if (!url.startsWith("https://")) problems.push(`${id}: the URL must start with https://`);
}

// A typo in an id would silently 404 on the TV, so check the ids against the
// lineup when that file is available.
let known = null;
try {
  const lineup = JSON.parse(fs.readFileSync(channelsFile, "utf8"));
  if (Array.isArray(lineup.channels)) {
    known = new Set(lineup.channels.map((channel) => channel?.id).filter(Boolean));
  }
} catch {
  console.warn(`⚠ Cannot read ${channelsFile}; skipping the channel id check.`);
}
if (known) {
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) {
    const detail = `not in ${channelsFile}: ${unknown.join(", ")}`;
    if (allowUnknown) console.warn(`⚠ ${detail}`);
    else problems.push(detail);
  }
}

if (problems.length) {
  console.error(`✗ ${file} cannot be used as ATV_GDRIVE_MAP:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`→ ATV_GDRIVE_MAP: ${ids.length} link(s): ${ids.join(", ")}`);
const cmd = ["wrangler", "secret", "put", "ATV_GDRIVE_MAP", "--config", config];
if (dryRun) {
  console.log(`  npx ${cmd.join(" ")}   # JSON on stdin`);
  process.exit(0);
}

const run = spawnSync("npx", cmd, {
  input: JSON.stringify(map),
  stdio: ["pipe", "inherit", "inherit"],
});
if (run.status !== 0) {
  console.error("✗ wrangler secret put failed.");
  process.exit(run.status ?? 1);
}
console.log("Secret updated. /api/resolve reads it without a redeploy.");
