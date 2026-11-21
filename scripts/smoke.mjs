#!/usr/bin/env node
// Post-deploy smoke check.
//   node scripts/smoke.mjs [baseUrl]        # default https://atv.acidwurx.org
// Behind Cloudflare Access, supply a service token:
//   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... node scripts/smoke.mjs
const base = (process.argv[2] || process.env.ATV_BASE_URL || 'https://atv.acidwurx.org').replace(/\/+$/, '');
const headers = {};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
}

let failures = 0;
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function get(path) {
  const res = await fetch(base + path, { headers, redirect: 'manual' });
  return { res, text: await res.text() };
}

try {
  const status = await get('/api/status');
  if (status.res.status === 302 && (status.res.headers.get('location') || '').includes('cloudflareaccess.com')) {
    record('api reachable', false, 'redirected to Cloudflare Access (add a bypass policy or a service token)');
  } else {
    record('GET /api/status', status.res.status === 200, `HTTP ${status.res.status}`);
  }

  const shell = await get('/');
  const isHtml = (shell.res.headers.get('content-type') || '').includes('text/html');
  record('GET /', shell.res.status === 200 && isHtml && /<div id="?root"?/.test(shell.text), `HTTP ${shell.res.status}`);

  const assetPath = (shell.text.match(/\/assets\/[^"']+\.js/) || [])[0];
  if (assetPath) {
    const asset = await get(assetPath);
    const js = (asset.res.headers.get('content-type') || '').includes('javascript');
    record(`GET ${assetPath}`, asset.res.status === 200 && js, `HTTP ${asset.res.status}`);
  } else {
    record('client bundle referenced', false, 'index.html has no /assets/*.js');
  }

  const guide = await get('/api/guide');
  let guideBody = null;
  try { guideBody = JSON.parse(guide.text); } catch { /* handled below */ }
  record('GET /api/guide', guide.res.status === 200 && Array.isArray(guideBody?.channels), `HTTP ${guide.res.status}`);
  if (Array.isArray(guideBody?.channels) && guideBody.channels.length === 0) {
    console.log('WARN  guide has 0 channels — seed ATV_CONFIG with `pnpm seed`');
  }

  const resolve = await get('/api/resolve?id=__smoke__');
  record('GET /api/resolve (unknown id → 404)', resolve.res.status === 404, `HTTP ${resolve.res.status}`);

  const ident = await get('/api/idents/random');
  record(
    'GET /api/idents/random',
    [302, 503].includes(ident.res.status),
    `HTTP ${ident.res.status}${ident.res.status === 503 ? ' (no idents seeded)' : ''}`,
  );
} catch (err) {
  record('connect', false, err instanceof Error ? err.message : String(err));
}

console.log(`\n${results.length - failures}/${results.length} checks passed against ${base}`);
process.exit(failures ? 1 : 0);
