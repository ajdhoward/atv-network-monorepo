#!/usr/bin/env node
// Compares the build a deployed origin is serving with the build in this
// checkout. Read-only: it fetches, it never deploys.
//
//   node scripts/check-drift.mjs [baseUrl] [--build apps/tv-client/dist]
//   pnpm drift https://atv-core-v2.acidwurx.workers.dev
//
// Defaults to the sandbox worker, the target this repo deploys by default. Run
// `pnpm run build:deploy` first: the local half of the comparison is the built
// `index.html` files, and a missing build is a failure rather than a skip.
//
// How it decides "stale": the client's entry asset carries a content hash in its
// name (`/assets/index-D8Do0dvy.js`), so the same sources built twice produce the
// same name. Different name means different bundle, and a bundle from another
// checkout is what a stale sandbox looks like. `/api/health` adds a second,
// independent signal: the fields this build adds are absent on an older Worker,
// so a deployment from before R6/P1 is caught even if someone copied assets in.
//
// A Worker-only change leaves both asset hashes identical, so the asset checks on
// their own cannot see it. `/api/health` therefore carries `build.id`, the commit
// the running Worker was built from: `pnpm deploy` and the deploy workflow attach
// it (`scripts/build-id.mjs`), and this script compares it with the checkout's
// HEAD. Accepting that field (2026-11-24) is what made the comparison possible; a
// deployment that predates it, or one deployed without the var, reports no id and
// fails here rather than passing quietly. A tree that differs from its commit only
// in `wrangler.toml` counts as clean: `pnpm kv:staging` rewrites that file before
// every sandbox deploy, so counting it would fail this check on a correct deploy.
//
// The deploy job runs this against the URL it just deployed, so a deploy that did
// not take effect is a red job rather than a note; the step retries briefly first,
// because an edge can answer with the previous version for a few seconds.
//
// Behind Cloudflare Access, supply a service token:
//   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... pnpm drift https://atv.acidwurx.org
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildId, isDirty, sameBuild } from "./build-id.mjs";
import { CONFIG_SCHEMA_VERSION } from "./lib/config-meta.mjs";

const VALUE_FLAGS = new Set(["--build"]);

const args = process.argv.slice(2);
const values = {};
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (VALUE_FLAGS.has(arg)) {
    values[arg] = args[++i];
  } else if (arg.startsWith("--")) {
    console.error(`✗ Unknown flag ${arg}`);
    process.exit(1);
  } else {
    positional.push(arg);
  }
}

const base = (
  positional[0] ||
  process.env.ATV_BASE_URL ||
  "https://atv-core-v2.acidwurx.workers.dev"
).replace(/\/+$/, "");
const build = values["--build"] || "apps/tv-client/dist";

const headers = {};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}

let failures = 0;
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// The entry files Vite writes. Anything with a content hash in its name is a
// fingerprint of the bundle; stylesheets count too, since a CSS-only change moves
// only that hash.
const REF = (prefix) => new RegExp(`["'](\\${prefix}[^"']+\\.(?:js|css))["']`, "g");

function refsFrom(html, prefix) {
  return [...html.matchAll(REF(prefix))].map((match) => match[1]).sort();
}

function localRefs(file, prefix) {
  return existsSync(file) ? refsFrom(readFileSync(file, "utf8"), prefix) : [];
}

async function get(path) {
  const res = await fetch(base + path, { headers, redirect: "manual" });
  return { res, text: await res.text() };
}

// Compares one served page with the same page in this checkout. Kept as one
// check per page so the output says which half is stale: a client-only drift is a
// different mistake from an admin one.
async function comparePage(path, prefix, file) {
  const local = localRefs(file, prefix);
  if (!local.length) {
    record(`local build (${file})`, false, `no ${prefix}*.js — run \`pnpm run build:deploy\``);
    return;
  }
  const page = await get(path);
  if (page.res.status !== 200) {
    record(`GET ${path}`, false, `HTTP ${page.res.status}`);
    return;
  }
  const deployed = refsFrom(page.text, prefix);
  if (!deployed.length) {
    record(
      `GET ${path} (bundle)`,
      false,
      `no ${prefix}*.js in the answer — the asset layer is serving something else`,
    );
    return;
  }
  const same = local.join(",") === deployed.join(",");
  record(
    `GET ${path} (build)`,
    same,
    same
      ? deployed.join(", ")
      : `serving ${deployed.join(", ")}, this checkout builds ${local.join(", ")} — deploy this build (\`pnpm deploy\`) or point the check at the right origin`,
  );
  if (!same) return;

  // A matching name is only useful if the deployment actually serves the file;
  // an asset directory without bytes answers the page and nothing else.
  const asset = await fetch(base + deployed[0], { headers, redirect: "manual" });
  record(
    `GET ${deployed[0]}`,
    asset.status === 200,
    `HTTP ${asset.status}${asset.status === 200 ? "" : " — the page references an asset it does not serve"}`,
  );
}

// Fields this build adds, so their absence dates the deployed Worker even when
// the assets happen to match. Names, not values: health is public and carries
// presence flags only.
const HEALTH_MARKERS = [
  ["deviceTokenSet", (body) => Object.hasOwn(body, "deviceTokenSet"), "R6"],
  ["streamSigningKeySet", (body) => Object.hasOwn(body, "streamSigningKeySet"), "P1"],
  ["config.schemaMatches", (body) => Object.hasOwn(body.config ?? {}, "schemaMatches"), "P2"],
  ["config.checksumMatches", (body) => Object.hasOwn(body.config ?? {}, "checksumMatches"), "P2"],
  ["resolve", (body) => Object.hasOwn(body, "resolve"), "P5"],
  ["guideSnapshot", (body) => Object.hasOwn(body, "guideSnapshot"), "R3"],
];

try {
  if (!existsSync(join(build, "index.html"))) {
    record(
      "local build",
      false,
      `${join(build, "index.html")} is missing — run \`pnpm run build:deploy\` first; there is nothing to compare against`,
    );
  } else {
    await comparePage("/", "/", join(build, "index.html"));
    await comparePage("/admin/", "/admin/assets/", join(build, "admin", "index.html"));

    const health = await get("/api/health");
    let body = null;
    try {
      body = JSON.parse(health.text);
    } catch {
      body = null;
    }
    record(
      "GET /api/health (JSON)",
      health.res.status === 200 && body !== null,
      body === null
        ? `HTTP ${health.res.status} with a non-JSON body — the asset layer answered instead of the Worker`
        : `HTTP 200`,
    );
    if (body !== null) {
      const missing = HEALTH_MARKERS.filter(([, has]) => !has(body)).map(
        ([name, , since]) => `${name} (${since})`,
      );
      record(
        "health carries this build's fields",
        missing.length === 0,
        missing.length
          ? `missing: ${missing.join(", ")} — the Worker is older than this checkout`
          : undefined,
      );
      const schema = body.schemaVersion;
      if (typeof schema === "number") {
        record(
          "health schemaVersion",
          schema === CONFIG_SCHEMA_VERSION,
          `${schema}, this checkout is ${CONFIG_SCHEMA_VERSION}`,
        );
      } else {
        record(
          "health schemaVersion",
          true,
          "null — no config_meta seeded, so there is no stored schema to compare",
        );
      }

      // The only signal that can see a Worker-only change. The local side is the
      // commit, not the built files: the same sources for `apps/` produce the same
      // asset names, which is why the checks above cannot tell these two builds
      // apart.
      const localId = buildId();
      const deployedId = typeof body.build?.id === "string" ? body.build.id : null;
      if (!localId) {
        record(
          "health build id",
          false,
          "no local build id — run this in a git checkout, or set ATV_BUILD_ID to the commit you mean",
        );
      } else if (isDirty(localId)) {
        record(
          "health build id",
          false,
          `${localId} — the working tree has uncommitted changes, so no deployment can be tied to a commit; commit first, then compare`,
        );
      } else if (!deployedId) {
        record(
          "health build id",
          false,
          "the deployment reports no build id — it was deployed without ATV_BUILD_ID, so it could be any build; deploy with `pnpm deploy` or the deploy workflow",
        );
      } else if (sameBuild(localId, deployedId)) {
        record("health build id", true, deployedId);
      } else {
        record(
          "health build id",
          false,
          `deployed ${deployedId}, this checkout is ${localId} — the deploy did not take effect (\`pnpm deploy\`)`,
        );
      }
    }
  }
} catch (err) {
  record("connect", false, err instanceof Error ? err.message : String(err));
}

console.log(
  `\n${results.length - failures}/${results.length} checks matched ${base} against this checkout`,
);
process.exit(failures ? 1 : 0);
