#!/usr/bin/env node
// Pre-deploy check: boot the built Worker in workerd and use it.
//
//   node scripts/ci-worker.mjs [--port 8788] [--timeout 90]
//
// Seeds the local KV store from scripts/fixtures/ci-lineup.json, starts
// `wrangler dev --local` (no Cloudflare credentials, no remote KV), then:
//   - runs scripts/smoke.mjs against it (guide, assets, /admin, ETag, 404s),
//   - fetches /admin/ and an admin deep link, both Worker-routed,
//   - resolves a fixture channel (the ATV_CONFIG/gdrive_map binding),
//   - fires the cron trigger and expects the snapshot in ATV_CACHE,
//   - spends the /api/resolve allowance and expects the Durable Object to 429.
//
// The point is to catch a binding, asset or Durable Object regression on every
// push; until this exists, the first request the real Worker answers is the
// post-deploy smoke check.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const port = flag("port", "8788");
const timeoutMs = Number(flag("timeout", "90")) * 1000;
const base = `http://127.0.0.1:${port}`;
const FIXTURE = path.join("scripts", "fixtures", "ci-lineup.json");
const LOG = path.join(".wrangler", "ci-dev.log");
// Mirrored from services/atv-core/src/index.ts (RATE_LIMIT_MAX / window).
const RATE_LIMIT_MAX = 300;

const binName = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
const localBin = path.join("node_modules", ".bin", binName);
const WRANGLER = fs.existsSync(localBin) ? localBin : "wrangler";

let failures = 0;
function record(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function logTail(lines = 40) {
  try {
    const text = fs.readFileSync(LOG, "utf8").trimEnd();
    return text.split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

fs.mkdirSync(path.dirname(LOG), { recursive: true });
const logFd = fs.openSync(LOG, "w");
const dev = spawn(
  WRANGLER,
  ["dev", "--local", "--config", "wrangler.toml", "--port", port, "--test-scheduled"],
  { stdio: ["ignore", logFd, logFd] },
);
let spawnError = null;
dev.on("error", (err) => {
  spawnError = err;
});

async function waitForReady() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`cannot start ${WRANGLER}: ${spawnError.message}`);
    if (dev.exitCode !== null) throw new Error(`wrangler dev exited with code ${dev.exitCode}`);
    try {
      const res = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  throw new Error(`wrangler dev did not answer on ${base} within ${timeoutMs / 1000}s`);
}

async function stopDev() {
  if (dev.exitCode !== null) return;
  dev.kill("SIGTERM");
  const exited = new Promise((resolve) => dev.once("exit", resolve));
  await Promise.race([exited, sleep(5000)]);
  if (dev.exitCode === null) dev.kill("SIGKILL");
}

async function getJson(pathname) {
  const res = await fetch(base + pathname, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  return { res, body };
}

// /admin is Worker-routed (run_worker_first), so its branches are not covered by
// the asset layer: smoke checks the bare-path redirect, these check the panel and
// the deep-link fallback that must land on the admin shell, not the TV client.
async function checkAdmin() {
  const panel = await fetch(`${base}/admin/`);
  const html = await panel.text();
  const isHtml = (panel.headers.get("content-type") || "").includes("text/html");
  record(
    "GET /admin/",
    panel.status === 200 &&
      isHtml &&
      /<div id="?root"?/.test(html) &&
      /\/admin\/assets\//.test(html),
    `HTTP ${panel.status}`,
  );

  const deep = await fetch(`${base}/admin/setup/panel`);
  const deepHtml = await deep.text();
  record(
    "GET /admin/setup/panel (admin shell fallback)",
    deep.status === 200 && deepHtml === html,
    `HTTP ${deep.status}`,
  );
}

async function checkResolve() {
  const { res, body } = await getJson("/api/resolve?id=ci-atv-one");
  const url = body && typeof body.url === "string" ? body.url : "";
  record(
    "GET /api/resolve?id=ci-atv-one",
    res.status === 200 && url.startsWith("https://"),
    `HTTP ${res.status}`,
  );
}

// /install is Worker-routed (it is in run_worker_first) and its QR comes from a
// bundled dependency, so this checks the route and the bundle in workerd before
// a deploy. The page must name the asset the Android workflow publishes, or the
// install button 404s on a real TV.
async function checkInstall() {
  const page = await fetch(`${base}/install`);
  const html = await page.text();
  const isHtml = (page.headers.get("content-type") || "").includes("text/html");
  record(
    "GET /install",
    page.status === 200 &&
      isHtml &&
      html.includes("/install/qr.svg") &&
      html.includes("releases/latest/download/atv-launcher.apk"),
    `HTTP ${page.status}`,
  );

  const qr = await fetch(`${base}/install/qr.svg`);
  const svg = await qr.text();
  const isSvg = (qr.headers.get("content-type") || "").includes("image/svg+xml");
  record(
    "GET /install/qr.svg",
    qr.status === 200 && isSvg && svg.startsWith("<svg") && /viewBox="0 0 \d+ \d+"/.test(svg),
    `HTTP ${qr.status}, ${svg.length} bytes`,
  );
}

// /join is the public onboarding URL a guest agent is pointed at, and it is
// Worker-routed too. If it stops rendering, an agent with no GitHub app has no
// way in, so a deploy must catch that here.
async function checkJoin() {
  const res = await fetch(`${base}/join`);
  const html = await res.text();
  const isHtml = (res.headers.get("content-type") || "").includes("text/html");
  record(
    "GET /join",
    res.status === 200 &&
      isHtml &&
      html.includes("gh auth login") &&
      html.includes("github.com/login/device") &&
      html.includes("releases/latest/download") === false,
    `HTTP ${res.status}`,
  );
}

// /onboard is the one URL the operator hands to a new agent, so it is the same
// kind of dead end as /join when it breaks. It must also carry the handoff
// template, because Path B produces that file.
async function checkOnboard() {
  const res = await fetch(`${base}/onboard`);
  const html = await res.text();
  const isHtml = (res.headers.get("content-type") || "").includes("text/html");
  record(
    "GET /onboard",
    res.status === 200 &&
      isHtml &&
      html.includes("Path A: you can reach GitHub") &&
      html.includes("Path B: you cannot reach GitHub") &&
      html.includes("pnpm handoff"),
    `HTTP ${res.status}`,
  );
}

// The cron trigger is the only KV write in production, so a broken scheduled
// handler or a missing ATV_CACHE binding should fail here rather than on the
// first interval after a deploy. Wrangler's documented /__scheduled route never
// reaches the Worker with this config: `not_found_handling` serves it from the
// asset layer. Miniflare's own /cdn-cgi/mf/scheduled trigger does reach
// `scheduled()`, which is what --test-scheduled is for.
async function checkCron() {
  // A local store may already hold a snapshot from an earlier run, so wait for
  // the timestamp to change instead of accepting whatever is there.
  const before = (await getJson("/api/health")).body?.guideSnapshot?.generatedAt ?? null;
  const fired = await fetch(
    `${base}/cdn-cgi/mf/scheduled?cron=${encodeURIComponent("*/10 * * * *")}`,
  );
  await fired.text();
  if (fired.status !== 200) {
    record("scheduled handler", false, `scheduled trigger answered HTTP ${fired.status}`);
    return;
  }
  const deadline = Date.now() + 10_000;
  let snapshot = null;
  while (Date.now() < deadline) {
    const { body } = await getJson("/api/health");
    snapshot = body?.guideSnapshot ?? null;
    if (snapshot && snapshot.generatedAt !== before && typeof snapshot.total === "number") break;
    await sleep(250);
  }
  const guideTotal = (await getJson("/api/guide")).body?.total;
  record(
    "scheduled handler writes ATV_CACHE guide:latest",
    !!snapshot && snapshot.generatedAt !== before && snapshot.total === guideTotal,
    snapshot ? `snapshot total ${snapshot.total}, guide total ${guideTotal}` : "no snapshot",
  );
}

// Requests without CF-Connecting-IP are deliberately uncounted, so the burst
// sends one. It has to be unique per run: the Durable Object keeps its window
// and its count in the local store, so a fixed key made a second run inside the
// same minute answer 429 on request zero, failing a Worker that was fine.
async function checkLimiter() {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  const headers = {
    "CF-Connecting-IP": `198.18.${octet()}.${octet()}`,
    accept: "application/json",
  };
  let allowed = 0;
  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    const res = await fetch(`${base}/api/resolve?id=ci-atv-one`, { headers });
    await res.arrayBuffer();
    if (res.status === 429) {
      record(
        "Durable Object limiter",
        false,
        `429 after ${i} request(s); the window is ${RATE_LIMIT_MAX}`,
      );
      return;
    }
    if (res.status !== 200) {
      record("Durable Object limiter", false, `request ${i + 1} answered HTTP ${res.status}`);
      return;
    }
    allowed++;
  }
  const blocked = await fetch(`${base}/api/resolve?id=ci-atv-one`, { headers });
  const retryAfter = Number(blocked.headers.get("retry-after"));
  await blocked.arrayBuffer();
  record(
    "Durable Object limiter allows the window then 429",
    blocked.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0,
    `${allowed} allowed, HTTP ${blocked.status}, Retry-After ${blocked.headers.get("retry-after") ?? "none"}`,
  );
}

async function main() {
  const seed = spawnSync(process.execPath, ["scripts/seed-kv.mjs", "--local", "--file", FIXTURE], {
    stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error(`local seed exited with code ${seed.status}`);

  await waitForReady();
  // A cold workerd start is not a check on its own; say so in the log.
  console.log(`Worker answering on ${base}\n`);

  // Route/shell/asset/ETag/404 coverage already exists; reuse it rather than
  // keeping a second copy of those assertions here.
  const smoke = spawnSync(process.execPath, ["scripts/smoke.mjs", base], { stdio: "inherit" });
  record("smoke against the local Worker", smoke.status === 0, `exit ${smoke.status}`);

  await checkAdmin();
  await checkResolve();
  await checkInstall();
  await checkJoin();
  await checkOnboard();
  await checkCron();
  await checkLimiter();
}

try {
  await main();
} catch (err) {
  record("local worker check", false, err instanceof Error ? err.message : String(err));
  const tail = logTail();
  if (tail) console.error(`\n--- ${LOG} (last lines) ---\n${tail}`);
} finally {
  await stopDev();
  fs.closeSync(logFd);
}

console.log(
  failures ? `\n${failures} check(s) failed against ${base}` : `\nAll local worker checks passed.`,
);
process.exit(failures ? 1 : 0);
