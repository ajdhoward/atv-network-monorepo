#!/usr/bin/env node
// Audits /api/resolve for every channel in the lineup, so an operator who set
// ATV_GDRIVE_MAP can see which links landed without curling each id by hand.
//
//   node scripts/check-streams.mjs [baseUrl] [--allow-missing]
//   node scripts/check-streams.mjs --ids atv-1,atv-news-24
//   node scripts/check-streams.mjs https://atv-core-v2.acidwurx.workers.dev
//
// Defaults to the sandbox worker, the target this repo deploys by default.
// Prints channel ids and statuses, never the resolved links.
//
// --allow-missing downgrades a channel with no link yet to a warning, so a
// sandbox with an empty gdrive_map can still be audited before links exist. An
// insecure or unexpected response always fails.
//
// --probe follows each resolved link to the CDN, because a 200 from
// /api/resolve only means the Worker has a URL stored. A dead link, a 403 and
// an HTML sign-in page all look resolved otherwise. The link itself is still
// never printed: only its status and content type are.
//
// Behind Cloudflare Access, supply a service token:
//   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... node scripts/check-streams.mjs
import fs from "fs";

const VALUE_FLAGS = new Set(["--config", "--ids", "--base"]);
// Long enough for a cold CDN, short enough that a black-holed host does not stall
// the whole audit.
const PROBE_TIMEOUT_MS = 8_000;
const args = process.argv.slice(2);
const values = {};
const positional = [];
let allowMissing = false;
let probe = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--allow-missing") {
    allowMissing = true;
  } else if (arg === "--probe") {
    probe = true;
  } else if (VALUE_FLAGS.has(arg)) {
    values[arg] = args[++i];
  } else if (arg.startsWith("--")) {
    console.error(`✗ Unknown flag ${arg}`);
    process.exit(1);
  } else {
    positional.push(arg);
  }
}

const base = (
  values["--base"] ||
  positional[0] ||
  process.env.ATV_BASE_URL ||
  "https://atv-core-v2.acidwurx.workers.dev"
).replace(/\/+$/, "");

const configPath = values["--config"] || "atv-config.json";
let ids = [];
if (values["--ids"]) {
  ids = values["--ids"]
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
} else {
  try {
    const lineup = JSON.parse(fs.readFileSync(configPath, "utf8"));
    ids = (lineup.channels || []).map((channel) => channel?.id).filter(Boolean);
  } catch (err) {
    console.error(`✗ Cannot read ${configPath}: ${err.message}`);
    console.error("  Pass --ids a,b to audit specific channels.");
    process.exit(1);
  }
}
if (!ids.length) {
  console.error(`✗ No channel ids to audit (${configPath} lists none).`);
  process.exit(1);
}

const headers = {};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Checks the resolved link upstream. Errors are deliberately flattened into a
// generic message: a fetch failure can carry the URL in its message or its
// cause, and these lines are what an operator pastes into a ticket.
async function probeLink(url) {
  let res;
  try {
    res = await fetch(url, {
      // A byte range keeps a multi-gigabyte file from being downloaded; a
      // playlist answers the whole thing anyway.
      headers: { range: "bytes=0-4095" },
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, detail: "link unreachable (network error or timeout)" };
  }
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  await res.arrayBuffer();

  if (res.status !== 200 && res.status !== 206) {
    return { ok: false, detail: `link answered HTTP ${res.status}` };
  }
  // A drive share that needs a session answers 200 with a sign-in page, which
  // would otherwise look like a healthy stream.
  if (type.includes("html")) {
    return { ok: false, detail: `link answered HTML (${type}), not a stream` };
  }
  const kind = type.includes("mpegurl") ? "hls playlist" : type || "no content type";
  return { ok: true, detail: `${kind}, HTTP ${res.status}` };
}

let resolved = 0;
let failed = 0;
const missing = [];
let stopped = null;

for (const id of ids) {
  let res;
  try {
    res = await fetch(`${base}/api/resolve?id=${encodeURIComponent(id)}`, {
      headers,
      redirect: "manual",
    });
  } catch (err) {
    failed++;
    console.log(`FAIL  ${id} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (res.status === 200) {
    if (!probe) {
      // The body carries the link; it is drained but never printed.
      await res.arrayBuffer();
      resolved++;
      console.log(`PASS  ${id} — ok`);
      continue;
    }
    const body = parseJson(await res.text());
    const url = body && typeof body.url === "string" ? body.url : null;
    if (!url) {
      failed++;
      console.log(`FAIL  ${id} — resolved without a url`);
      continue;
    }
    const verdict = await probeLink(url);
    if (verdict.ok) {
      resolved++;
      console.log(`PASS  ${id} — ${verdict.detail}`);
    } else {
      failed++;
      console.log(`FAIL  ${id} — ${verdict.detail}`);
    }
    continue;
  }

  await res.arrayBuffer();
  if (res.status === 404) {
    missing.push(id);
    console.log(`${allowMissing ? "MISS" : "FAIL"}  ${id} — 404 not found (no link)`);
  } else if (res.status === 502) {
    failed++;
    console.log(`FAIL  ${id} — 502 insecure_url (the link is not https://)`);
  } else if (res.status === 429) {
    stopped = `rate limited (Retry-After ${res.headers.get("retry-after") ?? "?"}s)`;
    break;
  } else {
    failed++;
    console.log(`FAIL  ${id} — HTTP ${res.status}`);
  }
}

console.log(`\n${resolved}/${ids.length} channel(s) resolve against ${base}`);
if (probe) console.log("Each resolved link was followed upstream; links are never printed.");

if (stopped) {
  console.error(`✗ Audit stopped early: ${stopped}. Re-run once the window resets.`);
  process.exit(1);
}
if (missing.length) {
  const detail = `${missing.length} channel(s) have no link: ${missing.join(", ")}`;
  if (allowMissing) console.log(`WARN  ${detail}`);
  else console.error(`✗ ${detail}\n  Supply them with: node scripts/set-gdrive-map.mjs <map.json>`);
}
process.exit(failed === 0 && (missing.length === 0 || allowMissing) ? 0 : 1);
