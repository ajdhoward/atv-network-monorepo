# ATV Network

Monorepo for the ATV streaming network: a Cloudflare Worker serving the API and the TV client,
a React admin CMS, and shared types.

> **Deployment status (2026-11-21).** This repository deploys the sandbox worker `atv-core-v2`
> (workers.dev, no route). The live `atv-core-orchestrator` behind `atv.acidwurx.org` is a larger,
> separate implementation that is **not** in this repo: it was last changed in the Cloudflare
> dashboard on 2026-10-24 and holds D1, a Durable Object, telemetry and an admin token.
> See [Deploy](#deploy).

- Worker + API: `services/atv-core`
- TV client (Vite + TS): `apps/tv-client` — built to `apps/tv-client/dist` and served as Worker assets
- Admin CMS (React): `apps/admin-cms` — not served by the Worker yet
- Shared types/schema: `packages/ui-shared`

## Layout

```
services/atv-core/src/index.ts      router: /api/status, /api/guide, /api/resolve, /api/idents/random
services/atv-core/src/rules.ts      guide indexing (country/category groups, 8 ms budget)
services/atv-core/src/resolver.ts   id -> media URL, HTTPS only
services/atv-core/src/backup.ts     guide snapshot -> KV (guide:latest)
apps/tv-client/src/                 guide-driven channel grid, player, overlays, D-pad handling
apps/tv-client/public/_headers      response headers for the served client
scripts/staging-kv.mjs             creates the sandbox KV namespaces and points wrangler.toml at them
scripts/seed-kv.mjs                 pushes runtime config into the bound KV namespaces
scripts/smoke.mjs                   post-deploy check of the live origin
scripts/validate-config.mjs         validates a seed config before uploading
wrangler.toml                       sandbox worker atv-core-v2: KV bindings, 10-minute guide cron, assets, no route
wrangler.production.toml            production worker atv-core-orchestrator: route + assets (reference only)
scripts/check-deploy-target.mjs     blocks deploys that would replace production
```

## API

| Route | Behaviour |
| --- | --- |
| `GET /api/status` | build/env/uptime JSON |
| `GET /api/guide` | channels indexed from KV `ATV_CONFIG/channels`, memoised 30 s; the 10-minute cron snapshots it to `ATV_CACHE/guide:latest` |
| `GET /api/resolve?id=<id>` | `{id,url,profile}` from `ATV_CONFIG/gdrive_map`; 400 without id, 404 unknown, 502 non-HTTPS |
| `GET /api/idents/random` | 302 to a random HTTPS ident from `ATV_CONFIG/idents`; 503 when unset |

Anything not under `/api/*` is served from the built client, with SPA fallback (so `/remote` loads the app).

## Local development

```bash
pnpm install
pnpm typecheck                       # worker + tv-client + admin-cms
pnpm test                            # worker route suite (Vitest, in-memory KV)
pnpm run build:client
npx wrangler dev --config wrangler.toml --port 8788 --local
```

The admin CMS builds with `pnpm run build:admin` (output in `apps/admin-cms/dist`); it is not served
by this Worker, so the deploy does not include it.

`wrangler dev --local` uses a local KV store; seed it the same way as production but without `--remote`
(`npx wrangler kv key put channels --binding=ATV_CONFIG --local --path=channels.json`).

## KV data the Worker needs

`ATV_CONFIG`:

The sandbox has separate namespaces (see [Deploy](#deploy)); these keys describe the production ones.
| Key | Shape | Used by |
| --- | --- | --- |
| `channels` | `[{id,name,country,category,genre[]}]` (or `system_config.channels`) | `/api/guide` |
| `idents` | `["https://…"]` media URLs | `/api/idents/random` |
| `gdrive_map` | `{ "<id>": "https://…" }` | `/api/resolve` |

`ATV_CACHE` is written by the Worker's cron trigger (`guide:latest`, every 10 minutes); no manual
seeding needed. The request path never writes KV, so the snapshot costs one write per interval
rather than one per cold isolate.

Seed it from a config file (`version: 1`, `channels: []`, optional `idents` / `gdrive_map`):

```bash
node scripts/seed-kv.mjs --file ./atv-config.json --dry-run   # print the commands
node scripts/seed-kv.mjs --file ./atv-config.json             # upload to production KV
```

## Deploy

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm deploy          # guard -> build client -> wrangler deploy --config wrangler.toml (atv-core-v2)
pnpm smoke <origin>  # checks a deployed origin; see below for Access
```

`pnpm deploy` targets `atv-core-v2` on its workers.dev hostname. It binds its own namespaces,
`atv-cache-staging` and `atv-config-staging`, created once with `pnpm kv:staging` (which rewrites the
namespace ids in `wrangler.toml`). Both `pnpm seed` and `pnpm deploy` refuse to run while the config
still binds production KV, so the sandbox cannot write the live lineup; `ATV_ALLOW_SHARED_KV=1`
overrides that deliberately.

Production is `wrangler.production.toml`, and this repo does **not** deploy it.
`scripts/check-deploy-target.mjs` refuses any config naming `atv-core-orchestrator` or routing
`atv.acidwurx.org` unless `ATV_ALLOW_PROD_DEPLOY=1` is set. CI only deploys on a manual run that
selects the target; pushing to `main` runs install, typecheck, client build and admin build only.

Replacing production without first importing the deployed source (`4fb54df2`, 2026-10-24) would
remove D1 `DB`, `REMOTE_HUB`, `ATV_TELEMETRY`, `ATV_ADMIN_TOKEN` and the provider origins.

Requires an authenticated wrangler (`npx wrangler login`) or `CLOUDFLARE_API_TOKEN` with access to the
`acidwurx.org` zone and both KV namespaces. CI uses the `CF_API_TOKEN` repository secret.

Deploy does **not** seed KV: run `node scripts/seed-kv.mjs` once (and again whenever the lineup changes),
or `/api/guide` serves an empty lineup and `/api/resolve` answers 404.

### Cloudflare Access

The zone-wide application `acidwurx.org` covers `*.acidwurx.org` and the apex with a
device-posture/login policy and no service-token include. Unauthenticated requests to
`atv.acidwurx.org`, `api.atv…`, `remote.atv…` and `stremio-addon…` are redirected to
`acidwurx.cloudflareaccess.com`, so players, Stremio clients and this repo's smoke check cannot reach
them. Fixing it is a Zero Trust change: scope the application to the hosts that need a login, and add
a policy with `any_valid_service_token` so CI can send `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`.

### Still open before production is complete

- No assets on `atv-core-orchestrator`, so nothing serves the TV client at `atv.acidwurx.org`.
- `ATV_VAULT_KEY` is not set on `atv-edge-admin`, so credential sealing and `/api/sync` cannot work.
- `TRAKT_CLIENT_SECRET` is an empty var, and `SyncRoom` is exported without a Durable Object binding.
- `ATV_TELEMETRY` holds no keys and no GitHub token is bound, so telemetry and the private backup
  mirror are both inactive.

## Notes

`DEPLOY_FINAL.sh`, `DEPLOY_FINAL.bat`, `DEPLOY_GH.sh` and `FIX.sh` are the author's local one-shot helpers
(OAuth login, `gh secret set`, push). They assume a `/home/adam/Downloads/cf-token.txt` file and are not
required — the commands above do the same work.
