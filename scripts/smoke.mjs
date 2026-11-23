#!/usr/bin/env node
// Post-deploy smoke check.
//   node scripts/smoke.mjs [baseUrl] [--allow-empty]
//
// --allow-empty treats a worker with no seeded lineup as a pass (a freshly
// created staging namespace), while still failing on every route that is
// broken. Without it an unseeded deployment is a failure.
//
// Behind Cloudflare Access, supply a service token:
//   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... node scripts/smoke.mjs
const args = process.argv.slice(2);
const allowEmpty = args.includes("--allow-empty") || process.env.ATV_SMOKE_ALLOW_EMPTY === "1";
const explicitBase = args.find((arg) => !arg.startsWith("-"));
const base = (explicitBase || process.env.ATV_BASE_URL || "https://atv.acidwurx.org").replace(
  /\/+$/,
  "",
);
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

async function get(path) {
  const res = await fetch(base + path, { headers, redirect: "manual" });
  return { res, text: await res.text() };
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

try {
  const status = await get("/api/status");
  if (
    status.res.status === 302 &&
    (status.res.headers.get("location") || "").includes("cloudflareaccess.com")
  ) {
    record(
      "api reachable",
      false,
      "redirected to Cloudflare Access (add a bypass policy or a service token)",
    );
  } else {
    record("GET /api/status", status.res.status === 200, `HTTP ${status.res.status}`);
  }

  const shell = await get("/");
  const isHtml = (shell.res.headers.get("content-type") || "").includes("text/html");
  record(
    "GET /",
    shell.res.status === 200 && isHtml && /<div id="?root"?/.test(shell.text),
    `HTTP ${shell.res.status}`,
  );

  const assetPath = (shell.text.match(/\/assets\/[^"']+\.js/) || [])[0];
  if (assetPath) {
    const asset = await get(assetPath);
    const js = (asset.res.headers.get("content-type") || "").includes("javascript");
    record(`GET ${assetPath}`, asset.res.status === 200 && js, `HTTP ${asset.res.status}`);
  } else {
    record("client bundle referenced", false, "index.html has no /assets/*.js");
  }

  // /admin is routed by the Worker rather than the asset layer, so a regression
  // in that branch (it once redirected to itself) does not show up in `/`.
  const adminRedirect = await get("/admin");
  record(
    "GET /admin (redirect)",
    adminRedirect.res.status === 308 &&
      (adminRedirect.res.headers.get("location") || "").endsWith("/admin/"),
    `HTTP ${adminRedirect.res.status}`,
  );

  const admin = await get("/admin/");
  const adminHtml = (admin.res.headers.get("content-type") || "").includes("text/html");
  record(
    "GET /admin/",
    admin.res.status === 200 && adminHtml && /<div id="?root"?/.test(admin.text),
    `HTTP ${admin.res.status}`,
  );

  const adminAssetPath = (admin.text.match(/\/admin\/assets\/[^"']+\.js/) || [])[0];
  if (adminAssetPath) {
    const adminAsset = await get(adminAssetPath);
    const js = (adminAsset.res.headers.get("content-type") || "").includes("javascript");
    record(
      `GET ${adminAssetPath}`,
      adminAsset.res.status === 200 && js,
      `HTTP ${adminAsset.res.status}`,
    );
  } else {
    record("admin bundle referenced", false, "/admin/ has no /admin/assets/*.js");
  }

  const health = await get("/api/health");
  const healthBody = parse(health.text);
  const seeded = healthBody?.config?.seeded === true;
  if (seeded) {
    record(
      "GET /api/health (seeded)",
      health.res.status === 200,
      `HTTP ${health.res.status}, ${healthBody.config.channels} channels`,
    );
  } else if (allowEmpty) {
    console.log(
      `WARN  /api/health is not seeded (HTTP ${health.res.status}, ${healthBody?.config?.channels ?? 0} channels) — allowed by --allow-empty`,
    );
  } else {
    record(
      "GET /api/health (seeded)",
      false,
      `HTTP ${health.res.status}${healthBody?.config ? `, ${healthBody.config.channels} channels` : ""} — run \`pnpm seed\``,
    );
  }
  if (healthBody?.config?.schemaMatches === false) {
    record("/api/health schema", false, "config_meta schemaVersion is not the worker's");
  }

  const guide = await get("/api/guide");
  const guideBody = parse(guide.text);
  record(
    "GET /api/guide",
    guide.res.status === 200 && Array.isArray(guideBody?.channels),
    `HTTP ${guide.res.status}`,
  );
  if (Array.isArray(guideBody?.channels) && guideBody.channels.length === 0) {
    console.log("WARN  guide has 0 channels — seed ATV_CONFIG with `pnpm seed`");
  }

  const page = await get("/api/guide?limit=1");
  const pageBody = parse(page.text);
  record(
    "GET /api/guide?limit=1",
    page.res.status === 200 && Array.isArray(pageBody?.channels) && pageBody.channels.length <= 1,
    `HTTP ${page.res.status}, ${pageBody?.channels?.length ?? "?"} channel(s), nextCursor ${pageBody?.nextCursor ?? "none"}`,
  );

  const etag = guide.res.headers.get("etag");
  if (etag) {
    const conditional = await fetch(base + "/api/guide", {
      headers: { ...headers, "If-None-Match": etag },
      redirect: "manual",
    });
    record(
      "GET /api/guide (If-None-Match → 304)",
      conditional.status === 304,
      `HTTP ${conditional.status}`,
    );
  }

  const resolve = await get("/api/resolve?id=__smoke__");
  record(
    "GET /api/resolve (unknown id → 404)",
    resolve.res.status === 404,
    `HTTP ${resolve.res.status}`,
  );

  const ident = await get("/api/idents/random");
  record(
    "GET /api/idents/random",
    [302, 503].includes(ident.res.status),
    `HTTP ${ident.res.status}${ident.res.status === 503 ? " (no idents seeded)" : ""}`,
  );

  // The install page is what a phone opens before it has the app, so a broken
  // route here is the difference between installed and no way in.
  const install = await get("/install");
  const installQr = await get("/install/qr.svg");
  record(
    "GET /install",
    install.res.status === 200 &&
      install.text.includes("/install/qr.svg") &&
      (installQr.res.headers.get("content-type") || "").includes("image/svg+xml"),
    `HTTP ${install.res.status}, QR HTTP ${installQr.res.status}`,
  );

  // The short path is the address worth typing on a TV remote, so a redirect
  // here is the whole feature; a 200 would mean the asset layer answered with
  // the TV shell instead of the Worker.
  const short = await get("/a");
  const assetUrl = short.res.headers.get("location") || "";
  record(
    "GET /a (→ release asset)",
    short.res.status === 302 && assetUrl.endsWith("/releases/latest/download/atv-launcher.apk"),
    `HTTP ${short.res.status}${assetUrl ? ", location set" : ", no location"}`,
  );

  // One URL is what every installed TV updates from. If the release or its asset
  // name changes, nothing notices until someone tries to install, so a deploy
  // must fail here instead.
  if (assetUrl) {
    try {
      // No Access service-token headers: those are this deployment's credentials
      // and the asset is a third-party host.
      const asset = await fetch(assetUrl, { method: "HEAD", redirect: "follow" });
      if (asset.status === 200) {
        record("HEAD release asset", true, "HTTP 200");
      } else if (asset.status >= 500) {
        // GitHub's outage, not this Worker's: a 5xx must not turn a good deploy
        // red, while a missing release (404) must.
        console.log(
          `WARN  release asset HEAD answered HTTP ${asset.status} — GitHub, not this Worker`,
        );
      } else {
        record(
          "HEAD release asset",
          false,
          `HTTP ${asset.status} — is ${assetUrl.split("/").at(-1)} still published?`,
        );
      }
    } catch (err) {
      console.log(
        `WARN  release asset HEAD failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // A guest agent with no GitHub app is pointed at /join, so a broken route is
  // the difference between onboarding and a dead end.
  const join = await get("/join");
  record(
    "GET /join",
    join.res.status === 200 && join.text.includes("github.com/login/device"),
    `HTTP ${join.res.status}`,
  );

  // The onboarding URL is what the operator pastes to a new agent, and it has to
  // carry both paths and the handoff command or the second path is a dead end.
  const onboard = await get("/onboard");
  record(
    "GET /onboard",
    onboard.res.status === 200 &&
      onboard.text.includes("pnpm handoff") &&
      onboard.text.includes("Path B"),
    `HTTP ${onboard.res.status}`,
  );

  const unknown = await get("/api/does-not-exist");
  record(
    "GET /api/does-not-exist (JSON 404)",
    unknown.res.status === 404 &&
      (unknown.res.headers.get("content-type") || "").includes("application/json"),
    `HTTP ${unknown.res.status}`,
  );
} catch (err) {
  record("connect", false, err instanceof Error ? err.message : String(err));
}

console.log(`\n${results.length - failures}/${results.length} checks passed against ${base}`);
process.exit(failures ? 1 : 0);
