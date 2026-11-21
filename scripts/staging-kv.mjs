#!/usr/bin/env node
// Creates the sandbox KV namespaces and points wrangler.toml at them.
//
//   node scripts/staging-kv.mjs --dry-run   # show the wrangler calls only
//   node scripts/staging-kv.mjs             # create (or reuse) and patch wrangler.toml
//
// The sandbox worker atv-core-v2 must not share KV with production: seeding and
// the guide snapshot cron both write, and the production namespaces hold the live
// lineup. This is idempotent — existing namespaces are reused, and the config is
// only rewritten when an id actually changes.
//
// Requires an authenticated wrangler (`npx wrangler login` or CLOUDFLARE_API_TOKEN).

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PRODUCTION_KV_IDS, SANDBOX_KV_NAMES } from "./lib/kv-namespaces.mjs";

const CONFIG = "wrangler.toml";
const dryRun = process.argv.includes("--dry-run");

function wrangler(args) {
  return spawnSync("npx", ["wrangler", ...args, "--config", CONFIG], {
    encoding: "utf8",
  });
}

function existingNamespaces() {
  const run = wrangler(["kv", "namespace", "list"]);
  if (run.status !== 0) {
    console.error("✗ wrangler kv namespace list failed — is wrangler authenticated?");
    console.error(run.stderr?.trim() || run.stdout?.trim() || "");
    process.exit(1);
  }
  try {
    const list = JSON.parse(run.stdout);
    return new Map(list.map((ns) => [ns.title ?? ns.name, ns.id]));
  } catch {
    console.error("✗ could not parse the namespace list as JSON.");
    process.exit(1);
  }
}

function createNamespace(name) {
  const run = wrangler(["kv", "namespace", "create", name]);
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const id = /id\s*=\s*"([a-f0-9]{32})"/.exec(output)?.[1];
  if (run.status !== 0 || !id) {
    console.error(`✗ could not create ${name}.`);
    console.error(output.trim());
    process.exit(1);
  }
  return id;
}

function bindingBlock(text, binding) {
  const re = new RegExp(`\\[\\[kv_namespaces\\]\\]\\nbinding = "${binding}"\\nid = "[^"]+"`);
  if (!re.test(text)) {
    console.error(`✗ ${CONFIG} has no [[kv_namespaces]] block for ${binding}.`);
    process.exit(1);
  }
  return re;
}

const known = dryRun ? new Map() : existingNamespaces();
const ids = {};

for (const [binding, name] of Object.entries(SANDBOX_KV_NAMES)) {
  if (dryRun) {
    console.log(`→ ${binding}: npx wrangler kv namespace create ${name} --config ${CONFIG}`);
    continue;
  }
  const id = known.get(name) ?? createNamespace(name);
  if (PRODUCTION_KV_IDS.has(id)) {
    console.error(`✗ ${name} resolved to a production namespace id (${id}); refusing to continue.`);
    process.exit(1);
  }
  console.log(`→ ${binding}: ${name} (${id})${known.has(name) ? " — reused" : " — created"}`);
  ids[binding] = id;
}

if (dryRun) {
  console.log("\nDry run complete. Nothing was created and wrangler.toml was not changed.");
  process.exit(0);
}

let text = readFileSync(CONFIG, "utf8");
let changed = 0;
for (const [binding, id] of Object.entries(ids)) {
  const re = bindingBlock(text, binding);
  const next = re.test(text)
    ? text.replace(re, `[[kv_namespaces]]\nbinding = "${binding}"\nid = "${id}"`)
    : text;
  if (next !== text) {
    text = next;
    changed++;
  }
}

if (changed) {
  writeFileSync(CONFIG, text);
  console.log(`\n✓ Patched ${changed} binding(s) in ${CONFIG}.`);
} else {
  console.log(`\n✓ ${CONFIG} already points at the staging namespaces.`);
}

console.log("\nNext:");
console.log("  node scripts/seed-kv.mjs --file ./atv-config.json   # seed the staging lineup");
console.log("  pnpm deploy                                        # deploy atv-core-v2");
