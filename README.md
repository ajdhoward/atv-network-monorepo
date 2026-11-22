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
services/atv-core/src/backup.ts     guide snapshot -> KV (guide:latest)
services/atv-core/test/             route suite (Vitest, in-memory KV)
apps/tv-client/src/                 guide-driven channel grid, player, overlays, D-pad handling
apps/tv-client/test/                guide, player and overlay tests
apps/admin-cms/src/                 admin CMS
scripts/staging-kv.mjs              creates the sandbox KV namespaces and points wrangler.toml at them
scripts/copy-kv.mjs                 copies the production lineup into the staging namespaces
scripts/seed-kv.mjs                 pushes runtime config (incl. config_meta) into the bound KV
scripts/smoke.mjs                   post-deploy check of a deployed origin
scripts/validate-config.mjs         validates a seed config before uploading
scripts/pack-assets.mjs             copies the admin build under the TV client's assets
scripts/check-deploy-target.mjs     blocks deploys that would replace production or write prod KV
scripts/test/                       deploy-guard suite
wrangler.toml                       sandbox worker atv-core-v2: KV bindings, cron, assets, /admin
wrangler.production.toml            production worker atv-core-orchestrator (reference only)
```

## API

| Route                      | Behaviour                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/status`          | name/env/time JSON                                                                                                                                                                                                                                          |
| `GET /api/health`          | `{status, schemaVersion, config:{seeded,channels,updatedAt}, guideSnapshot}`; `degraded` when the lineup is empty or `config_meta` names a schema this build refuses; `config.schemaMatches` / `config.checksumMatches` expose that drift                   |
| `GET /api/guide`           | channels indexed from KV `ATV_CONFIG/channels`, sorted by id, memoised 30 s, `Cache-Control: public, max-age=30, s-maxage=60` + `ETag` (304 on `If-None-Match`). Paged with `?limit=` (default 500, max 1000) and `?cursor=`; the body carries `nextCursor` |
| `GET /api/resolve?id=<id>` | `{id,url,profile}` from `ATV_CONFIG/gdrive_map`; 400 without id, 404 unknown, 502 non-HTTPS, 429 per-IP when the limiter trips                                                                                                                              |
| `GET /api/idents/random`   | 302 to a random HTTPS ident from `ATV_CONFIG/idents`; 503 when unset                                                                                                                                                                                        |
| `GET /admin`               | 308 to `/admin/`; the CMS is served from the asset directory                                                                                                                                                                                                |

Error bodies are `{error, code, requestId}` and every response carries `X-Request-Id`. Internal
failures return a generic 503 and are logged with the same id instead of echoing the exception.
`/admin/` is served without authentication in the sandbox: it is a UI shell that makes no privileged
calls, but in production it must stay behind Cloudflare Access (see below).

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

The admin CMS is not served by `vite`; `pnpm run build:deploy` packs it into
`apps/tv-client/dist/admin` and the Worker serves it at `/admin/`.

`wrangler dev --local` uses a local KV store; seed it the same way as production but without `--remote`
(`npx wrangler kv key put channels --binding=ATV_CONFIG --local --path=channels.json`).

## KV data the Worker needs

`ATV_CONFIG`:

| Key           | Shape                                                                | Used by                      |
| ------------- | -------------------------------------------------------------------- | ---------------------------- |
| `channels`    | `[{id,name,country,category,genre[]}]` (or `system_config.channels`) | `/api/guide`                 |
| `idents`      | `["https://…"]` media URLs                                           | `/api/idents/random`         |
| `gdrive_map`  | `{ "<id>": "https://…" }`                                            | `/api/resolve`               |
| `config_meta` | `{schemaVersion, checksum, channels, updatedAt}`                     | schema guard in `/api/guide` |

`ATV_CACHE` is written by the Worker's cron trigger (`guide:latest`, every 10 minutes); no manual
seeding needed. The request path never writes KV, so the snapshot costs one write per interval rather
than one per cold isolate.

`pnpm seed -- --prune` also deletes the keys this script owns that the config no longer supplies
(an emptied `idents`, for example). Without it those keys keep being served.

`config_meta` is written by `scripts/seed-kv.mjs`. A lineup whose `schemaVersion` differs from the
Worker's (`1`) is refused with `503 config_schema_mismatch`; channels edited without re-seeding add
`warning: "config_checksum_mismatch"` to the guide payload.

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
remove D1 `DB`, `REMOTE_HUB`, `ATV_TELEMETRY`, `ATV_ADMIN_TOKEN` and the provider origins.

CI (`verify`) runs install, typecheck, lint, `format:check`, tests and the full `build:deploy` on
every push. Deployment is a manual `workflow_dispatch` with a target choice. A `v2` run first executes
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

## Notes

Observability samples 10% of requests (`head_sampling_rate = 0.1`); 100% burned the free log allowance
on `/api/guide` polls. The guide snapshot runs from a `*/10` cron trigger, declared in `wrangler.toml`
only — production's Worker is not built from this repo.

`/api/resolve` is rate limited per client IP by the `ATV_RATE_LIMITER` binding: 300 requests per
minute, applied per Cloudflare location. The only client is one TV, whose busiest legitimate pattern
is one prefetch per 350 ms hover debounce (~170/minute) while the grid is swept, so 300 leaves room
for the play request and still catches a scraper or a runaway loop rather than metering traffic. A
429 carries `Retry-After`, which the client waits out and retries instead of reporting the channel as
unavailable. Requests with no `CF-Connecting-IP` are not counted: a shared "unknown" bucket would let
one anonymous caller spend every other one's allowance. The binding is optional and the Worker fails
open if it errors.

Resolve and ident counters write to the `ATV_METRICS` Analytics Engine dataset. The binding is
declared in `wrangler.toml` and optional: Analytics Engine creates the dataset on first write, and a
missing binding or a failed write never changes a response.
