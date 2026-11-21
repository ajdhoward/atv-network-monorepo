#!/usr/bin/env node
// Copies the runtime config keys from the production namespaces into the
// sandbox namespaces, so atv-core-v2 serves the same lineup without sharing
// storage. Create the namespaces first: pnpm kv:staging.
//
//   node scripts/copy-kv.mjs --dry-run
//   node scripts/copy-kv.mjs
//   node scripts/copy-kv.mjs --keys channels,idents
//
// Requires an authenticated wrangler with read access to production.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { sharedProductionIds } from "./lib/kv-namespaces.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keysFlag = args.indexOf("--keys");
const keys =
  keysFlag === -1 ? ["channels", "system_config", "idents", "gdrive_map", "config_meta"] : [];
if (keysFlag !== -1) {
  keys.push(
    ...(args[keysFlag + 1] ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );
}
if (keys.length === 0) {
  console.error("✗ --keys needs at least one key name.");
  process.exit(1);
}

// The staging side must no longer point at production, or this copies onto itself.
const shared = sharedProductionIds(readFileSync("wrangler.toml", "utf8"));
if (!dryRun && shared.length) {
  console.error("✗ wrangler.toml still binds production KV: " + shared.join(", "));
  console.error("  Create the staging namespaces first: pnpm kv:staging");
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "atv-kv-copy-"));
let failed = 0;
let copied = 0;

try {
  for (const key of keys) {
    console.log(`→ ${key}`);
    const file = join(dir, `${key}.json`);

    if (dryRun) {
      console.log(
        `  npx wrangler kv key get ${key} --binding=ATV_CONFIG --remote --config wrangler.production.toml`,
      );
      console.log(
        `  npx wrangler kv key put ${key} --binding=ATV_CONFIG --remote --config wrangler.toml --path=${file}`,
      );
      continue;
    }

    const read = spawnSync(
      "npx",
      [
        "wrangler",
        "kv",
        "key",
        "get",
        key,
        "--binding=ATV_CONFIG",
        "--remote",
        "--config",
        "wrangler.production.toml",
      ],
      { encoding: "utf8" },
    );
    if (read.status !== 0) {
      console.warn(`  skipped ${key}: not readable from production`);
      continue;
    }
    writeFileSync(file, read.stdout);

    const write = spawnSync(
      "npx",
      [
        "wrangler",
        "kv",
        "key",
        "put",
        key,
        "--binding=ATV_CONFIG",
        "--remote",
        "--config",
        "wrangler.toml",
        `--path=${file}`,
      ],
      { stdio: "inherit" },
    );
    if (write.status !== 0) failed += 1;
    else copied += 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) {
  console.error(`✗ ${failed} key(s) failed to copy.`);
  process.exit(1);
}
// Silently copying nothing would leave a deploy that looks successful but serves
// an empty guide: production's ATV_CONFIG can be (and currently is) empty.
if (!dryRun && copied === 0) {
  console.error("✗ nothing was copied: production ATV_CONFIG has none of these keys.");
  console.error("  Seed a lineup file instead: node scripts/seed-kv.mjs --file ./atv-config.json");
  process.exit(1);
}
console.log(dryRun ? "Dry run complete." : `Copied ${copied} key(s) into staging.`);
