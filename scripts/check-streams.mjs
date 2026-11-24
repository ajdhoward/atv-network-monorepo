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
// It asks /api/resolve?ids= in batches, so a 12-channel lineup costs one request
// instead of twelve and spends one rate-limit token. A deployment without the
// batch form answers 404 and the audit falls back to one request per id.
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
// Behind Cloudflare Access, supply a service token, and once the worker enforces
// the household token (R6), supply that too — otherwise every channel reads as a
// failure the audit cannot distinguish from a broken link:
//   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... ATV_DEVICE_TOKEN=... node scripts/check-streams.mjs
import fs from "fs";

const VALUE_FLAGS = new Set(["--config", "--ids", "--base"]);
// Long enough for a cold CDN, short enough that a black-holed host does not stall
// the whole audit.
const PROBE_TIMEOUT_MS = 8_000;
// Must match MAX_BATCH_IDS in services/atv-core/src/index.ts.
const MAX_BATCH = 20;

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
if (process.env.ATV_DEVICE_TOKEN) {
  headers.Authorization = `Bearer ${process.env.ATV_DEVICE_TOKEN}`;
}
// One message for both passes: the audit stops on the first 401 rather than
// reporting every channel as a failure, because nothing downstream can tell a
// missing token from a dead link.
const UNAUTHORIZED =
  "401 unauthorized — the worker is enforcing the household token: set ATV_DEVICE_TOKEN";

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// A resolved link is not always absolute. P1's Drive ticket is same-origin by
// design — `/api/stream/<id>?exp&sig` — because the TV's `<video>` resolves it
// against the page that loaded it, and the ticket is only valid on the host that
// minted it. Node's `fetch` has no page to resolve against and throws "Failed to
// parse URL" on a path, so a working proxy was reported as an unreachable link.
// Resolved against the audited origin, which is the host that verifies the
// signature. `null` means the value is not a URL the audit can follow.
function absoluteLink(url) {
  try {
    return new URL(url, `${base}/`).toString();
  } catch {
    return null;
  }
}

// Checks the resolved link upstream. Errors are deliberately flattened into a
// generic message: a fetch failure can carry the URL in its message or its
// cause, and these lines are what an operator pastes into a ticket.
async function probeLink(url) {
  const target = absoluteLink(url);
  if (!target) return { ok: false, detail: "link is not a URL this audit can follow" };
  let res;
  try {
    res = await fetch(target, {
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

// id -> { kind: "ok", url? } | { kind: "missing" } | { kind: "insecure" } |
// { kind: "unconfigured" } | { kind: "error", detail }
const outcomes = new Map();
let stopped = null;

async function fetchBatch(batch) {
  const query = batch.map((id) => encodeURIComponent(id)).join(",");
  let res;
  try {
    res = await fetch(`${base}/api/resolve?ids=${query}`, { headers, redirect: "manual" });
  } catch {
    return { kind: "unsupported" };
  }
  if (res.status === 429) {
    await res.arrayBuffer();
    const retryAfter = res.headers.get("retry-after") ?? "?";
    return { kind: "limited", detail: `rate limited (Retry-After ${retryAfter}s)` };
  }
  if (res.status === 401) {
    await res.arrayBuffer();
    return { kind: "unauthorized" };
  }
  if (res.status !== 200) {
    // An older deployment answers 404 for an unknown query shape.
    await res.arrayBuffer();
    return { kind: "unsupported" };
  }
  const body = parseJson(await res.text());
  if (
    !body ||
    !Array.isArray(body.resolved) ||
    !Array.isArray(body.missing) ||
    !Array.isArray(body.invalid)
  ) {
    return { kind: "unsupported" };
  }
  return { kind: "ok", body };
}

// 1) Batch pass: the whole lineup in as few requests as the Worker allows.
for (let i = 0; i < ids.length && !stopped; i += MAX_BATCH) {
  const result = await fetchBatch(ids.slice(i, i + MAX_BATCH));
  if (result.kind === "limited") {
    stopped = result.detail;
    break;
  }
  if (result.kind === "unauthorized") {
    stopped = UNAUTHORIZED;
    break;
  }
  if (result.kind !== "ok") {
    // Fall back to one request per id for the entire audit, so a mixed run
    // cannot report some channels from the batch and others individually.
    outcomes.clear();
    break;
  }
  for (const entry of result.body.resolved) {
    if (entry && typeof entry.id === "string") {
      outcomes.set(entry.id, {
        kind: "ok",
        url: typeof entry.url === "string" ? entry.url : undefined,
      });
    }
  }
  for (const id of result.body.missing) outcomes.set(id, { kind: "missing" });
  for (const id of result.body.invalid) outcomes.set(id, { kind: "insecure" });
  // P5: optional on the wire, so a deployment older than the change simply
  // leaves these ids unclassified and the per-id pass below asks again.
  for (const id of result.body.unconfigured ?? []) outcomes.set(id, { kind: "unconfigured" });
}

// 2) Per-id pass for anything the batch did not classify.
for (const id of ids) {
  if (stopped || outcomes.has(id)) continue;
  let res;
  try {
    res = await fetch(`${base}/api/resolve?id=${encodeURIComponent(id)}`, {
      headers,
      redirect: "manual",
    });
  } catch {
    outcomes.set(id, { kind: "error", detail: "unreachable (network error)" });
    continue;
  }
  if (res.status === 429) {
    await res.arrayBuffer();
    const retryAfter = res.headers.get("retry-after") ?? "?";
    stopped = `rate limited (Retry-After ${retryAfter}s)`;
    break;
  }
  if (res.status === 401) {
    await res.arrayBuffer();
    stopped = UNAUTHORIZED;
    break;
  }
  if (res.status === 200) {
    if (!probe) {
      // The body carries the link; it is drained but never printed.
      await res.arrayBuffer();
      outcomes.set(id, { kind: "ok" });
      continue;
    }
    const body = parseJson(await res.text());
    const url = body && typeof body.url === "string" ? body.url : null;
    outcomes.set(
      id,
      url ? { kind: "ok", url } : { kind: "error", detail: "resolved without a url" },
    );
    continue;
  }
  await res.arrayBuffer();
  if (res.status === 404) outcomes.set(id, { kind: "missing" });
  else if (res.status === 502) outcomes.set(id, { kind: "insecure" });
  else if (res.status === 503) outcomes.set(id, { kind: "unconfigured" });
  else outcomes.set(id, { kind: "error", detail: `HTTP ${res.status}` });
}

// 3) Report in the order the channels were asked for.
let resolved = 0;
let failed = 0;
const missing = [];

for (const id of ids) {
  const outcome = outcomes.get(id);
  if (!outcome) continue; // not audited: the run stopped early

  if (outcome.kind === "ok" && !probe) {
    resolved++;
    console.log(`PASS  ${id} — ok`);
  } else if (outcome.kind === "ok") {
    if (!outcome.url) {
      failed++;
      console.log(`FAIL  ${id} — resolved without a url`);
      continue;
    }
    const verdict = await probeLink(outcome.url);
    if (verdict.ok) {
      resolved++;
      console.log(`PASS  ${id} — ${verdict.detail}`);
    } else {
      failed++;
      console.log(`FAIL  ${id} — ${verdict.detail}`);
    }
  } else if (outcome.kind === "missing") {
    missing.push(id);
    console.log(`${allowMissing ? "MISS" : "FAIL"}  ${id} — 404 not found (no link)`);
  } else if (outcome.kind === "insecure") {
    failed++;
    console.log(`FAIL  ${id} — 502 insecure_url (the link is not https://)`);
  } else if (outcome.kind === "unconfigured") {
    // The channel is seeded and is a Drive link; the deployment cannot proxy it.
    // Naming the secret is the whole point: the fix is not in the lineup.
    failed++;
    console.log(
      `FAIL  ${id} — 503 stream_unconfigured (this deployment has no ATV_STREAM_SIGNING_KEY)`,
    );
  } else {
    failed++;
    console.log(`FAIL  ${id} — ${outcome.detail}`);
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
