#!/usr/bin/env node
// Refuses to deploy over the production Worker unless the operator says so explicitly.
//
// The live atv-core-orchestrator is not built from this repo: it carries D1, the
// RemoteHub Durable Object, telemetry, an admin token and provider origins that
// wrangler.production.toml does not declare. Deploying the repo config over it strips
// all of that, so the default target is the atv-core-v2 sandbox instead.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { sharedProductionIds } from "./lib/kv-namespaces.mjs";

const PROD_WORKER = "atv-core-orchestrator";
const PROD_HOST = "atv.acidwurx.org";

const configPath = process.argv[2] ?? "wrangler.toml";

let text;
try {
  text = readFileSync(configPath, "utf8");
} catch (error) {
  console.error(`check-deploy-target: cannot read ${configPath}: ${error.message}`);
  process.exit(1);
}

const name = /^name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? "(unnamed)";
const patterns = [...text.matchAll(/^pattern\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
const isProduction = name === PROD_WORKER || patterns.some((p) => p.startsWith(PROD_HOST));

const target = `${name}${patterns.length ? ` (${patterns.join(", ")})` : " (workers.dev, no route)"}`;

if (!isProduction) {
  // A sandbox that still binds production KV writes into the live namespaces: the
  // guide snapshot cron and any seed run would touch production data. Separate
  // namespaces come from `pnpm kv:staging`.
  const shared = sharedProductionIds(text);
  if (shared.length > 0 && process.env.ATV_ALLOW_SHARED_KV !== "1") {
    console.error("check-deploy-target: refusing to deploy with production KV bindings.");
    console.error(`  config: ${basename(configPath)} -> ${target}`);
    console.error(`  shared namespace ids: ${shared.join(", ")}`);
    console.error("");
    console.error("This Worker writes (guide snapshot, seeding), so sharing production KV");
    console.error("would modify the live namespaces. Create the staging ones first:");
    console.error("  pnpm kv:staging");
    console.error("");
    console.error("Intentional shared-namespace deploy: ATV_ALLOW_SHARED_KV=1 pnpm deploy");
    process.exit(1);
  }
  console.log(`check-deploy-target: ok — ${basename(configPath)} -> ${target}`);
  process.exit(0);
}

if (process.env.ATV_ALLOW_PROD_DEPLOY === "1") {
  console.warn(`check-deploy-target: PRODUCTION deploy allowed — ${basename(configPath)} -> ${target}`);
  process.exit(0);
}

console.error("check-deploy-target: refusing to deploy to production.");
console.error(`  config: ${basename(configPath)}`);
console.error(`  target: ${target}`);
console.error("");
console.error(`The live ${PROD_WORKER} was last deployed from the Cloudflare dashboard`);
console.error("(2026-10-24, version 4fb54df2) and is not built from this repository.");
console.error("Deploying this config over it removes D1, REMOTE_HUB, ATV_TELEMETRY,");
console.error("ATV_ADMIN_TOKEN and the provider origins.");
console.error("");
console.error("Sandbox instead:   pnpm deploy");
console.error("Replace production (only if you truly mean it):");
console.error("  ATV_ALLOW_PROD_DEPLOY=1 pnpm deploy:prod");
process.exit(1);
