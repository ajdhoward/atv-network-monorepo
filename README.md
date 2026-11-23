# ATV Network

Monorepo for the ATV streaming network: a Cloudflare Worker serving the API, the TV client and the
admin CMS, a React admin app, and shared types.

> **Deployment status (2026-11-21).** This repository deploys the sandbox worker `atv-core-v2`
> (workers.dev, no route). The live `atv-core-orchestrator` behind `atv.acidwurx.org` is a larger,
> separate implementation that is **not** in this repo: it was last changed in the Cloudflare
> dashboard on 2026-10-24 (version `4fb54df2`) and holds D1, a Durable Object, telemetry and an admin
> token. The deployed script cannot be imported from here (the API returns a truncated bundle), so
> production replacement still starts with downloading that source. See [Deploy](#deploy).

- Worker + API: `services/atv-core`
- TV client (Vite + TS): `apps/tv-client` — built to `apps/tv-client/dist` and served as Worker assets
- Admin CMS (React): `apps/admin-cms` — built into `apps/tv-client/dist/admin` and served at `/admin/`
- Shared types/schema: `packages/ui-shared`

## Layout

```
services/atv-core/src/index.ts      router: /api/status, /api/health, /api/guide, /api/resolve, /api/idents/random
services/atv-core/src/env.ts        Env bindings + typed JSON/memo KV reads
services/atv-core/src/config-meta.ts config schema version + checksum
services/atv-core/src/rules.ts      guide indexing (country/category groups, deterministic)
services/atv-core/src/resolver.ts   id -> media URL, HTTPS only
services/atv-core/src/install.ts    /install page + QR for the Fire TV APK
services/atv-core/src/backup.ts     guide snapshot -> KV (guide:latest)
services/atv-core/test/             route suite (Vitest, in-memory KV)
apps/tv-client/src/                 guide-driven channel grid, player, overlays, D-pad handling
apps/tv-client/test/                guide, player and overlay tests
apps/admin-cms/src/                 admin CMS: live health and stream-link coverage panel
scripts/staging-kv.mjs              creates the sandbox KV namespaces and points wrangler.toml at them
scripts/copy-kv.mjs                 copies the production lineup into the staging namespaces
scripts/seed-kv.mjs                 pushes runtime config (incl. config_meta) into the bound KV
scripts/set-gdrive-map.mjs          pushes operator stream links into the ATV_GDRIVE_MAP secret
scripts/check-streams.mjs           audits /api/resolve per channel, optionally probing each link
scripts/dev.mjs                     one command: seed the local store, then run wrangler dev
scripts/ci-worker.mjs               boot the built worker locally and check bindings, assets and the limiter
scripts/budget.mjs                  models monthly usage against the Workers Paid allowance
scripts/smoke.mjs                   post-deploy check of a deployed origin
scripts/validate-config.mjs         validates a seed config before uploading
scripts/pack-assets.mjs             copies the admin build under the TV client's assets
scripts/check-deploy-target.mjs     blocks deploys that would replace production or write prod KV
scripts/test/                       deploy-guard suite
android/                            WebView shell for Fire OS, built by .github/workflows/android.yml
wrangler.toml                       sandbox worker atv-core-v2: KV bindings, cron, assets, /admin
wrangler.production.toml            production worker atv-core-orchestrator (reference only)
```

## API

| Route                      | Behaviour                                                                                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/status`          | name/env/time JSON                                                                                                                                                                                                                                                                           |
| `GET /api/health`          | `{status, schemaVersion, config:{seeded,channels,updatedAt}, resolve:{configured,invalid,missing}, guideSnapshot}`; `degraded` when the lineup is empty or `config_meta` names a schema this build refuses; `config.schemaMatches` / `config.checksumMatches` expose that drift              |
| `GET /api/guide`           | channels indexed from KV `ATV_CONFIG/channels`, sorted by id, memoised 30 s, `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=300` + `ETag` (304 on `If-None-Match`). Paged with `?limit=` (default 500, max 1000) and `?cursor=`; the body carries `nextCursor`      |
| `GET /api/resolve?id=<id>` | `{id,url,profile}` from the `ATV_GDRIVE_MAP` secret, a `torbox_map` entry or `ATV_CONFIG/gdrive_map`; `?ids=a,b` answers up to 20 in one request as `{resolved,missing,invalid}` and spends one limiter token; 400 without id, 404 unknown, 502 non-HTTPS, 429 per-IP when the limiter trips |
| `GET /api/idents/random`   | 302 to a random HTTPS ident from `ATV_CONFIG/idents`; 503 when unset                                                                                                                                                                                                                         |
| `GET /admin`               | 308 to `/admin/`; the CMS is served from the asset directory                                                                                                                                                                                                                                 |
| `GET /install`             | Install page for the Fire TV APK: release-asset link, QR (`/install/qr.svg`) and the sideload steps                                                                                                                                                                                          |
| `GET /install/qr.svg`      | QR of the APK link, rendered server-side as SVG                                                                                                                                                                                                                                              |     | `GET /join` | Public onboarding for a coding agent with no GitHub integration: `gh` device code or a fine-grained token, its roles, and what stays private |

Error bodies are `{error, code, requestId}` and every response carries `X-Request-Id`. Internal
failures return a generic 503 and are logged with the same id instead of echoing the exception.
`/admin/` is served without authentication in the sandbox: it reads the public `/api/health` to show
worker status and stream-link coverage, and a "Check stream links" button walks the guide and the
batched resolve endpoint to report each channel as ready, unset or unusable (counts and ids only,
never links). It makes no privileged calls. In production it must stay behind Cloudflare Access
(see below).

Anything else outside `/api/*` and `/admin/*` is served from the built client, with SPA fallback (so
`/remote` loads the app).

## Local development

```bash
pnpm install
pnpm typecheck                       # worker + tv-client + admin-cms + tests
pnpm lint                            # ESLint
pnpm test                            # worker routes, deploy guard and guide loader (Vitest)
pnpm run build:deploy                # client + admin + pack admin under dist/admin
npx wrangler dev --config wrangler.toml --port 8788 --local
```

`pnpm dev` does the last step for you: when `atv-config.json` exists it seeds the local KV store
first, then starts `wrangler dev --local` on port 8788. Flags pass through after `--`, so
`pnpm dev -- --port 9099`, `pnpm dev -- --no-seed` and `pnpm dev -- --dry-run` all work. No
Cloudflare credentials are involved.

The admin CMS is not served by `vite`; `pnpm run build:deploy` packs it into
`apps/tv-client/dist/admin` and the Worker serves it at `/admin/`.

`wrangler dev --local` reads its own KV store. Seed it from your lineup with one command — no
Cloudflare credentials are involved:

```bash
pnpm seed:local -- --file ./atv-config.json     # writes to the store `wrangler dev --local` reads
pnpm seed:local -- --file ./atv-config.json --dry-run   # print the wrangler calls instead
```

The local store lives under `.wrangler/state`, so deleting that directory reseeds from scratch.

## KV data the Worker needs

`ATV_CONFIG`:

| Key           | Shape                                                                | Used by                      |
| ------------- | -------------------------------------------------------------------- | ---------------------------- |
| `channels`    | `[{id,name,country,category,genre[]}]` (or `system_config.channels`) | `/api/guide`                 |
| `idents`      | `["https://…"]` media URLs                                           | `/api/idents/random`         |
| `gdrive_map`  | `{ "<id>": "https://…" }`                                            | `/api/resolve`               |
| `torbox_map`  | `{ "<id>": {kind?,<kind>Id,fileId} }`                                | `/api/resolve` (TorBox)      |
| `config_meta` | `{schemaVersion, checksum, channels, updatedAt}`                     | schema guard in `/api/guide` |

`ATV_CACHE` is written by the Worker's cron trigger (`guide:latest`, every 10 minutes); no manual
seeding needed. The request path never writes KV, so the snapshot costs one write per interval rather
than one per cold isolate.

`pnpm seed -- --prune` also deletes the keys this script owns that the config no longer supplies
(an emptied `idents`, for example). Without it those keys keep being served.

`config_meta` is written by `scripts/seed-kv.mjs`. A lineup whose `schemaVersion` differs from the
Worker's (`1`) is refused with `503 config_schema_mismatch`; channels edited without re-seeding add
`warning: "config_checksum_mismatch"` to the guide payload.

### Stream links

`/api/resolve` reads the Worker secret `ATV_GDRIVE_MAP` first and KV `gdrive_map` second, so an
operator can supply or rotate a link without re-seeding the lineup. The secret is a JSON object of
channel id to HTTPS URL:

```bash
cat > /tmp/gdrive-map.json <<'JSON'
{ "atv-1": "https://…" }
JSON
node scripts/set-gdrive-map.mjs /tmp/gdrive-map.json --dry-run   # print the wrangler call
node scripts/set-gdrive-map.mjs /tmp/gdrive-map.json             # wrangler secret put
```

The script refuses a non-HTTPS URL and an id that is not in `atv-config.json` (`--allow-unknown`
skips that check), prints the ids but never the links, and needs an authenticated wrangler. Pass
`--config wrangler.production.toml` to target the production worker. Instead of a local wrangler, a
repository secret named `ATV_GDRIVE_MAP` holding the same JSON is pushed by the deploy workflow
(`workflow_dispatch`) before it deploys, and the step is skipped when that secret is absent. A secret
survives deploys, and
replacing it replaces the whole map, so include every link that should keep resolving. An id in
the secret overrides the KV entry for the same id; removing it from the secret hands the id back to
KV. With neither holding the id the answer is `404 not_found`, which is what the sandbox returns
today because `atv-config.json` carries an empty `gdrive_map`.

After setting the secret, audit every channel at once — it prints ids and statuses, never the
links:

```bash
node scripts/check-streams.mjs                    # sandbox, ids from atv-config.json
node scripts/check-streams.mjs --allow-missing    # tolerate channels with no link yet
node scripts/check-streams.mjs --probe            # also follow each link to the CDN
```

A channel with no link is a `MISS` (a failure unless `--allow-missing`), and a non-HTTPS link shows
up as `502 insecure_url`. `--probe` follows the resolved link, so a link the CDN answers with 403,
404 or an HTML sign-in page fails instead of passing as "resolved"; it reports the status and
content type only. A probe failure means this network could not fetch the link (geo-blocking and
CDN bot rules included), so treat it as a signal to check rather than a verdict. Pass a base URL or
`--ids atv-1,atv-news-24` to narrow the audit.

### TorBox links

A channel can come from TorBox instead of a fixed URL: map it in `torbox_map` and the Worker asks
TorBox for a temporary CDN link when a TV tunes in. The API token is the Worker secret
`ATV_TORBOX_API_KEY` — never written to KV, never sent to the device, never logged — and the TV plays
the returned `https://` link directly over TLS.

```json
"torbox_map": {
  "atv-1": { "kind": "torrent", "torrentId": 1234, "fileId": 5678 },
  "atv-2": { "kind": "usenet", "usenetId": 90, "fileId": 12 },
  "atv-3": { "kind": "webdl", "webdlId": 34, "fileId": 56 }
}
```

`kind` defaults to `torrent`. A link is cached per isolate for 30 minutes, well inside the
three-hour window TorBox opens, so sweeping the grid costs one API call per channel rather than one
per hover. Precedence is `ATV_GDRIVE_MAP`, then `torbox_map`, then KV `gdrive_map`. A mapped channel
without the secret answers `502 resolve_failed` and counts as missing coverage in `/api/health`, so
a forgotten token does not look like an unknown id.

```bash
printf '%s' "$TORBOX_TOKEN" | npx wrangler secret put ATV_TORBOX_API_KEY
```

That targets `wrangler.toml`; add `--config wrangler.production.toml` for a cutover candidate. CI
does the same from the repository secret `ATV_TORBOX_API_KEY` and skips the step when it is absent.

### Sandbox vs production KV

The sandbox has its own namespaces (`atv-cache-staging`, `atv-config-staging`). It must never bind the
production ids: seeding and the snapshot cron both write.

```bash
pnpm kv:staging                       # create (or reuse) the namespaces and patch wrangler.toml
pnpm kv:copy -- --dry-run             # inspect copying the production lineup into staging
pnpm kv:copy                          # copy channels/system_config/idents/gdrive_map/config_meta
```

`pnpm kv:copy` exits non-zero if it could not read a single key, so a copy that did nothing cannot
look like a populated sandbox. `pnpm deploy` now performs the `kv:staging` step itself.

`pnpm seed` refuses to run while `wrangler.toml` still contains a production KV id; `pnpm deploy`
avoids that by provisioning the staging namespaces first. `ATV_ALLOW_SHARED_KV=1` overrides the
refusal deliberately.

## Deploy

```bash
pnpm install --frozen-lockfile
pnpm deploy                           # kv:staging -> guard -> build:deploy -> deploy atv-core-v2
node scripts/seed-kv.mjs --file ./atv-config.json   # a lineup kept outside git
pnpm smoke <origin>                   # workers.dev host is not behind Access
```

`pnpm deploy` runs `pnpm kv:staging` first, so a fresh clone provisions `atv-cache-staging` and
`atv-config-staging` before the guard runs. The ids it writes into `wrangler.toml` are
account-specific: commit them or let the next run rewrite them — both work, and CI runs the same step.

The sandbox is `https://atv-core-v2.acidwurx.workers.dev`: the account's workers.dev subdomain is
`acidwurx`, the Worker does not exist until the first deploy, and that host is not behind Access.

Production's `ATV_CONFIG` currently holds no keys, so `pnpm kv:copy` has nothing to copy and exits
non-zero. The sandbox lineup therefore comes from a seed file. `pnpm seed` refuses a config with no
channels (the default `config.example.json` is an empty skeleton) unless `--allow-empty` is passed, so
a deploy cannot silently serve a 0-channel guide; `pnpm smoke --allow-empty` is the matching
post-deploy switch for a freshly created namespace.

Because this repository is public, the seed file stays out of git (`.gitignore` covers
`atv-config.json`). For CI, store the same JSON in the repository secret `ATV_SEED_CONFIG`; the deploy
job seeds staging with it when present and skips the step when it is absent.

`pnpm deploy` targets `atv-core-v2` on its workers.dev hostname. Production is
`wrangler.production.toml`, and this repo does **not** deploy it:
`scripts/check-deploy-target.mjs` refuses any config naming `atv-core-orchestrator` or routing
`atv.acidwurx.org` unless `ATV_ALLOW_PROD_DEPLOY=1` is set.

Replacing production without first importing the deployed source (`4fb54df2`, 2026-10-24) would
remove D1 `DB`, `REMOTE_HUB`, `ATV_TELEMETRY`, `ATV_ADMIN_TOKEN` and the provider origins. The
cutover plan — prerequisites, parity gate, staged candidate, verification, route swap and rollback —
is in [`docs/production-cutover.md`](docs/production-cutover.md). `deploy:prod` is not that cutover.

CI (`verify`) runs install, typecheck, lint, `format:check`, tests and the full `build:deploy` on
every push, then `pnpm ci:worker`: that boots the build in workerd with a fixture lineup from
`scripts/fixtures/ci-lineup.json` (local KV only, no account) and runs the smoke check, a `/admin/`
and deep-link fetch, the cron snapshot and a burst the Durable Object limiter must answer with 429.
Deployment is a manual `workflow_dispatch` with a target choice. A `v2` run first executes
the idempotent `pnpm kv:staging` (so the guard and `wrangler deploy` see staging namespace ids instead
of the committed production placeholders), seeds from `ATV_SEED_CONFIG` when that secret is set, then
smokes the deployment URL with `--allow-empty`, which is safe because that host is not behind Access
and a new namespace starts unseeded.

Requires an authenticated wrangler (`npx wrangler login`) or a `CLOUDFLARE_API_TOKEN` with
Account → Workers Scripts → Edit, Account → Workers KV Storage → Edit and Account → Account Settings
→ Read. No zone or DNS permission is needed for the workers.dev sandbox (the route only matters for
`deploy:prod`). CI already has the `CF_API_TOKEN` repository secret.

### Cloudflare Access

The zone-wide application `acidwurx.org` covers `*.acidwurx.org` and the apex with a
device-posture/login policy and no service-token include. Unauthenticated requests to
`atv.acidwurx.org`, `api.atv…`, `remote.atv…` and `stremio-addon…` are redirected to
`acidwurx.cloudflareaccess.com`, so players, Stremio clients and this repo's smoke check cannot reach
them. Fixing it is a Zero Trust change: scope the application to the hosts that need a login, keep
`/admin` behind one, and add a policy with `any_valid_service_token` so CI can send
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`.

### Still open before production is complete

- The deployed `4fb54df2` source is not in git; download it from the dashboard before any
  `deploy:prod`, and treat `services/atv-core` as the sandbox generation until then.
- No assets on `atv-core-orchestrator`, so nothing serves the TV client at `atv.acidwurx.org`.
- `ATV_VAULT_KEY` is not set on `atv-edge-admin`, so credential sealing and `/api/sync` cannot work.
- `TRAKT_CLIENT_SECRET` is an empty var, and `SyncRoom` is exported without a Durable Object binding.
  The unbound `RemoteHub` stub belongs to the live worker; this repo no longer carries a copy.
- `ATV_TELEMETRY` holds no keys and no GitHub token is bound, so telemetry and the private backup
  mirror are both inactive.
- The channel grid's focus and scroll behaviour is still exercised by hand; `apps/tv-client/test`
  covers the guide loader, the resolve retry, the player swap and the overlay banner.

## Fire TV install

`/install` on a deployed Worker is the install page: a download button, a QR code and the sideload
steps. The APK is the `atv-launcher.apk` asset on the `atv-launcher-latest` GitHub release, which
`.github/workflows/android.yml` rebuilds and republishes whenever `android/` changes. The page links to
`/releases/latest/download/`, so it never needs rebuilding when the APK does.

`android/` is a plain WebView shell — one `Activity`, the platform's own `WebView`, no AndroidX, no
runtime dependency — because a Trusted Web Activity needs Chrome (absent on Fire OS) and
Capacitor/Cordova would add a bridge and toolchain this shell never uses. `android/README.md` records
that reasoning. The guide origin is compiled in and defaults to the sandbox; the `ATV_BASE_URL`
repository variable overrides it for CI, and `-PatvBaseUrl=…` does for a local build.

A stable signing key is what lets a new APK install over the previous one. Adding
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` (plus
`ANDROID_KEY_PASSWORD` if the key differs) as repository secrets signs with your own key; without them
CI uses the runner's debug key and each build needs an uninstall before the next install.

Sideloading needs _Install unknown apps_ enabled for whatever pushes the APK — Apps2Fire or Bugjaeger
from a phone, Downloader on the TV, or `adb install`. The page spells the steps out; the phone route
is the one that works without typing a URL with a remote.

## Public surface

The repository is public and the sandbox host is public, deliberately. **Public:** the source, `docs/`,
`GET /install`, `GET /join`, the release APK, and the read-only API (`/api/status`, `/api/health`,
`/api/guide`). **Private**, gitignored or held as a Worker secret: `atv-config.json`, resolved stream URLs
(`ATV_GDRIVE_MAP`, `gdrive_map`, `torbox_map`), the TorBox token, the Android signing keystore, and every
KV write or deploy.

`/join` is the public URL for a coding agent with no GitHub integration. It installs `gh`, either takes a
fine-grained token scoped to this repository or runs the device-code login (`gh auth login --web`, which
prints a one-time code the operator approves at `github.com/login/device`), then clones and works by pull
request with the Author and Reviewer roles only. The instructions are public; access is not — the
operator authorises each agent and can revoke it, and a device-code token is account-wide while a
fine-grained token is not. `docs/agents/join.md` spells both out.

## Budget

This network is built to cost the Workers Paid minimum ($5/month per account) and nothing more. The
included monthly allowances, checked against Cloudflare's pricing pages on 2026-11-22:

| Included on Workers Paid | Allowance                                           |
| ------------------------ | --------------------------------------------------- |
| Worker requests          | 10,000,000 / month (static asset requests are free) |
| CPU time                 | 30,000,000 ms / month                               |
| KV reads                 | 10,000,000 / month                                  |
| KV writes                | 1,000,000 / month                                   |
| Durable Object requests  | 1,000,000 / month                                   |
| Durable Object duration  | 400,000 GB-s / month                                |

`pnpm budget` models this deployment against those numbers and exits non-zero when a metric would
leave them, so it can gate a decision rather than only print a table:

```bash
pnpm budget                                  # household default: 3 TVs, 30 days
pnpm budget -- --tvs 10 --resolves 120        # a busier network
```

The model assumes no CDN cache and no isolate memo, so its figures are upper bounds. What keeps real
usage far below them: the guide is memoised 30 s and cached at the edge for 60 s (plus
`stale-while-revalidate=300`), KV JSON reads are memoised per isolate for 60 s, `/api/resolve` is
capped at 300 requests/minute per IP, KV is written only by the `*/10` cron and by seeding, and
observability samples 10% of requests. No D1, R2, Queues or third-party API is used, so there is no
second bill to trip. Actual usage is on the dashboard under Workers & Pages → the Worker → Metrics.

## Notes

Observability samples 10% of requests (`head_sampling_rate = 0.1`); 100% burned the free log allowance
on `/api/guide` polls. The guide snapshot runs from a `*/10` cron trigger, declared in `wrangler.toml`
only — production's Worker is not built from this repo.

`/api/resolve` is rate limited per client IP: 300 requests per minute. The count lives in the
`ATV_LIMITER` Durable Object, one instance per client key. The `ATV_RATE_LIMITER` binding alone is
not strict enough: it counts per Cloudflare location and caches per isolate, and a 419-request burst
at concurrency 40 produced no 429s. The object persists its window before answering, so an eviction
cannot refund an allowance, and an alarm clears the counter when the window ends. The binding stays
declared as a coarse fallback when the object is missing or throws. The only client is one TV, whose
busiest legitimate pattern is one prefetch per 350 ms hover debounce (~170/minute) while the grid is
swept, so 300 leaves room for the play request and still catches a scraper or a runaway loop rather
than metering traffic. A 429 carries `Retry-After` (seconds left in the window), which the client
waits out and retries instead of reporting the channel as unavailable. Requests with no
`CF-Connecting-IP` are not counted: a shared "unknown" bucket would let one anonymous caller spend
every other one's allowance. Both limiters are optional and the Worker fails open if they error.

Resolve and ident counters write to the `ATV_METRICS` Analytics Engine dataset. The binding is
declared in `wrangler.toml` and optional: Analytics Engine creates the dataset on first write, and a
missing binding or a failed write never changes a response.
