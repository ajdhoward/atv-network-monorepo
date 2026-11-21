# ATV Network

Monorepo for the ATV streaming network: a Cloudflare Worker (`atv-core-orchestrator`) serving
the API and the TV client, a React admin CMS, and shared types.

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
scripts/seed-kv.mjs                 pushes runtime config into production KV
scripts/smoke.mjs                   post-deploy check of the live origin
scripts/validate-config.mjs         validates a seed config before uploading
wrangler.toml                       worker, route atv.acidwurx.org/*, KV bindings, assets
```

## API

| Route | Behaviour |
| --- | --- |
| `GET /api/status` | build/env/uptime JSON |
| `GET /api/guide` | channels indexed from KV `ATV_CONFIG/channels`, memoised 30 s, snapshotted to `ATV_CACHE/guide:latest` |
| `GET /api/resolve?id=<id>` | `{id,url,profile}` from `ATV_CONFIG/gdrive_map`; 400 without id, 404 unknown, 502 non-HTTPS |
| `GET /api/idents/random` | 302 to a random HTTPS ident from `ATV_CONFIG/idents`; 503 when unset |

Anything not under `/api/*` is served from the built client, with SPA fallback (so `/remote` loads the app).

## Local development

```bash
pnpm install
pnpm typecheck                       # worker + tv-client + admin-cms
pnpm run build:client
npx wrangler dev --config wrangler.toml --port 8788 --local
```

The admin CMS builds with `pnpm run build:admin` (output in `apps/admin-cms/dist`); it is not served
by this Worker, so the deploy does not include it.

`wrangler dev --local` uses a local KV store; seed it the same way as production but without `--remote`
(`npx wrangler kv key put channels --binding=ATV_CONFIG --local --path=channels.json`).

## KV data the Worker needs

`ATV_CONFIG`:

| Key | Shape | Used by |
| --- | --- | --- |
| `channels` | `[{id,name,country,category,genre[]}]` (or `system_config.channels`) | `/api/guide` |
| `idents` | `["https://…"]` media URLs | `/api/idents/random` |
| `gdrive_map` | `{ "<id>": "https://…" }` | `/api/resolve` |

`ATV_CACHE` is written by the Worker (`guide:latest`); no manual seeding needed.

Seed it from a config file (`version: 1`, `channels: []`, optional `idents` / `gdrive_map`):

```bash
node scripts/seed-kv.mjs --file ./atv-config.json --dry-run   # print the commands
node scripts/seed-kv.mjs --file ./atv-config.json             # upload to production KV
```

## Deploy

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm deploy          # builds the client, then wrangler deploy --config wrangler.toml
pnpm smoke           # checks the live origin; see below for Access
```

Requires an authenticated wrangler (`npx wrangler login`) or `CLOUDFLARE_API_TOKEN` with access to the
`acidwurx.org` zone and both KV namespaces. Pushing to `main` runs the same steps in
`.github/workflows/deploy.yml` using the `CF_API_TOKEN` repository secret.

Deploy does **not** seed KV: run `node scripts/seed-kv.mjs` once (and again whenever the lineup changes),
or `/api/guide` serves an empty lineup and `/api/resolve` answers 404.

### Cloudflare Access

`atv.acidwurx.org` currently sits behind Cloudflare Access — an unauthenticated request to any path,
including `/api/status`, is redirected to `acidwurx.cloudflareaccess.com`. Players and the TV client
cannot follow that, so before deploying for real either add an Access policy that bypasses `/api/*`
and the client shell, or issue a Service Token and send `CF-Access-Client-Id` / `CF-Access-Client-Secret`
from the client. Both are Zero Trust dashboard settings, not repository changes.

The smoke check needs the same treatment: with a service token, pass it through
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` so `pnpm smoke` can reach the origin.

## Notes

`DEPLOY_FINAL.sh`, `DEPLOY_FINAL.bat`, `DEPLOY_GH.sh` and `FIX.sh` are the author's local one-shot helpers
(OAuth login, `gh secret set`, push). They assume a `/home/adam/Downloads/cf-token.txt` file and are not
required — the commands above do the same work.
