# Production cutover runbook: `atv-core-orchestrator` → repo Worker

This document lives at `docs/production-cutover.md`. It is the operator-facing plan for moving production
from the incumbent Worker to the Worker built from `services/atv-core`; update it alongside
`wrangler.production.toml`, the deploy scripts and the `package.json` scripts it names.

**Status:** draft for review. **Nothing in this runbook has been executed.** It is a plan, not a record.

**Goal:** move the production origin `atv.acidwurx.org` from the incumbent Worker
`atv-core-orchestrator` to the Worker built from `services/atv-core` in this repository, with a rollback
that does not depend on rebuilding the incumbent.

## 1. The constraint that shapes everything

The incumbent's source **cannot be imported**: it was last changed in the Cloudflare dashboard on
2026-10-24 (version `4fb54df2`), and the API returns a truncated bundle. It owns bindings this repo does
not declare:

| Incumbent binding                         | What it is                                    | Repo Worker equivalent                               |
| ----------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| D1 `DB`                                   | SQL database, contents unknown                | **none**                                             |
| Durable Object `REMOTE_HUB` → `RemoteHub` | remote-control hub                            | **none** (repo has only `RateLimiter`)               |
| `ATV_TELEMETRY`                           | telemetry store, README says it holds no keys | `ATV_METRICS` (Analytics Engine) — different thing   |
| `ATV_ADMIN_TOKEN`                         | admin auth token                              | **none** (`/admin/` relies on Cloudflare Access)     |
| five provider origins                     | outbound provider calls                       | **none** (`/api/resolve` only serves operator links) |

Two consequences drive the whole plan:

1. **Never deploy over the incumbent.** `ATV_ALLOW_PROD_DEPLOY=1 pnpm deploy:prod` would replace
   `atv-core-orchestrator` in place, deleting D1, `REMOTE_HUB`, telemetry, the admin token and the
   provider origins, and destroying the only rollback target. That command is _not_ the cutover.
2. **Cutover is a route reassignment, not a deploy.** Deploy the repo Worker under a **new name** on a
   temporary hostname, verify it, then move the `atv.acidwurx.org/*` route to it. The incumbent stays
   deployed and untouched, so rollback is moving the route back — seconds, not a rebuild.

Because the source cannot be read, the incumbent is treated as a **black box**: capture its observable
contract and its data before changing anything, and compare against it afterwards.

## 2. Prerequisites

None of these are optional. Stop at the first one you cannot satisfy.

### 2.1 A product decision about the lost bindings

Someone who owns the product must decide, in writing, which of these is true:

- **A — Replace and accept the loss.** D1 and `RemoteHub` have no live traffic (or their features are
  retired), telemetry and the admin token are unused, and provider calls are no longer needed. Proceed.
- **B — Split the hostnames.** The remote-control and D1-backed features stay on the incumbent under a
  different hostname (for example `remote.atv.acidwurx.org`) and only the TV/guide/API paths move.
  This changes the plan below: the route for the new Worker must be scoped, and the client's
  same-origin `/api` calls must still land on the new Worker.
- **C — Stop.** Something on the incumbent is still needed and cannot live without D1 or `RemoteHub`.
  Replacing it is a reimplementation project, not a cutover.

Do not proceed on an assumption. Option B is the safe default if traffic evidence is inconclusive.

### 2.2 Access and credentials

- Cloudflare account access to `d9491f1ab703e0a99b69919230410f2a` with rights to edit Workers, routes,
  KV, D1 (export only) and Zero Trust Access.
- An API token with **Workers Scripts: Edit**, **Workers KV Storage: Edit**, **Workers Routes: Edit**,
  **Account Settings: Read**, and read access to D1. Keep it in the operator's secret store, never in the
  repo, shell history or chat.
- A **Cloudflare Access service token** (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`) for
  non-interactive verification. Without it, `curl` and `scripts/smoke.mjs` cannot see past the login
  redirect described in §2.3.

### 2.3 Access is currently a blocker in its own right

The zone-wide Access application on `acidwurx.org` covers `*.acidwurx.org` with a login policy and **no
service-token include**, so unauthenticated requests (players, Stremio, smoke) are redirected to
`acidwurx.cloudflareaccess.com` today. The cutover does not fix that and does not depend on it — but
verification does, and a TV that is blocked before the cutover will be equally blocked after. The Access
change is a separate, pre-approved step in §7.4.

### 2.4 Content and secrets prepared

- The production lineup JSON, kept outside git (`atv-config.json` is gitignored; CI uses the
  `ATV_SEED_CONFIG` repository secret).
- The stream-link map as a JSON file of `id → https://…`, validated with
  `node scripts/set-gdrive-map.mjs <map.json> --dry-run`. Links never appear in logs, documents, chat or git.
- Confirmation of whether `ATV_GDRIVE_MAP` is a Worker secret on the incumbent (names only — never read
  values) so you know what you are replacing.
- Both Worker secrets this build reads, and the decision each one forces. They are not optional extras: the
  repo Worker is the Drive proxy, and without the key the proxy is deployed but dead.
  - `ATV_STREAM_SIGNING_KEY`. Unset, a Drive-backed channel resolves to its stored link, which a `<video>`
    cannot play, and `/api/stream` answers `503 stream_unconfigured`. Set, `/api/resolve` answers a Drive
    link with a same-origin `/api/stream/<id>?exp&sig` ticket instead, so the TV that reads it has to be the
    R5 build — the same client-first order `docs/r8-rollout.md` applies to the token.
  - `ATV_DEVICE_TOKEN`. Unset, resolve answers any caller: the cutover is then not worse than today and not
    better. Set, every TV needs the token, so the cutover has to happen after the R8 rollout has reached the
    TVs. Reusing the value the sandbox holds is what lets a TV that already stored it survive the move.

### 2.5 Operational readiness

- A maintenance window agreed with the household (the TV is the user-facing surface).
- A named operator and a named decision-maker for rollback.
- An evidence directory outside the repo: `~/atv-cutover/<date>/`.
- `pnpm install --frozen-lockfile`, `pnpm test` and `pnpm run build:deploy` green on the exact commit to be
  deployed. Record the commit SHA in the evidence directory.

## 3. Phase 0 — Capture the incumbent's contract (read-only)

Everything here is read-only and safe to run against production. Do it **before** any deploy.

### 3.1 Export what can be exported

```bash
mkdir -p ~/atv-cutover/$(date +%F) && cd ~/atv-cutover/$(date +%F)

# D1: export the database by name, not through a binding this repo does not declare.
npx wrangler d1 list
npx wrangler d1 export <database-name> --remote --output d1-export.sql

# KV: inventory keys only (no values, no links).
npx wrangler kv key list --namespace-id 7e635f2e4ac44488a336f9d509b63061 --remote > kv-cache-keys.json
npx wrangler kv key list --namespace-id a59048e76fbd47c185bd4fc62fc3111a --remote > kv-config-keys.json

# Secret *names* on the incumbent (values are never printed).
npx wrangler secret list --name atv-core-orchestrator > secrets-names.json
```

Also record, from the dashboard: the route table, the cron triggers, the Durable Object class list, the
Access applications and policies, and the current deployment version id (`4fb54df2`).

### 3.2 Capture the wire contract

With the Access service token in the environment, record status, content-type, cache headers and the
**shape** of the body for every endpoint the clients use. Capture shapes, not stream URLs.

```bash
BASE=https://atv.acidwurx.org
AUTH=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")

for path in "/api/status" "/api/health" "/api/guide" "/api/guide?limit=1" \
            "/api/idents/random" "/api/resolve?id=<known-id>" "/admin/" "/" ; do
  name=$(printf '%s' "$path" | tr '/?=&' '____')
  curl -sS "${AUTH[@]}" -o "body$name" -D "head$name" -w '%{http_code}\n' "$BASE$path"
done

# Body *keys* only, so no link or token is copied into the evidence directory.
node -e '
const fs=require("fs");
for (const f of fs.readdirSync(".").filter(n=>n.startsWith("body"))) {
  try { const v=JSON.parse(fs.readFileSync(f,"utf8"));
        console.log(f, Array.isArray(v) ? "array" : Object.keys(v)); } catch {}
}'
```

Note especially: does the incumbent serve `/api/guide` with the same field names (`channels`,
`nextCursor`, `eTag`, `counts`)? Does `/api/resolve` return `{id,url,profile}`? Does `/api/status` exist
at all in the repo Worker's form? Divergence here is the main compatibility risk, because the TV client
in this repo is written against the repo's shapes.

### 3.3 Sample live traffic

```bash
npx wrangler tail atv-core-orchestrator --format json > tail-phase0.ndjson
# leave it running through one normal TV session (tune, playback), then Ctrl-C
```

Answer from the tail: which paths are actually hit, whether `/remote`, `/api/sync` or `/api/remote` see
traffic (this decides §2.1), and what the incumbent's typical latency and error rate look like. Strip
request bodies before sharing the file.

### 3.4 Write down the unknowns

Keep a short list, e.g. "what reads D1 `DB`", "does anything use `ATV_TELEMETRY`", "who holds
`ATV_ADMIN_TOKEN`". Anything still unknown at the end of Phase 0 is a reason to choose option B or C in
§2.1, not a reason to guess.

## 4. Phase 1 — Parity gate

No deploy happens until this table is filled in from Phase 0 evidence and the gate is signed off.

| Area                                | Incumbent (from Phase 0) | Repo Worker                                                                                         | Verdict                                                                          |
| ----------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/guide`                    | shape recorded           | `channels/nextCursor/eTag/counts`, `max-age=30`, `s-maxage=60`, SWR 300, 304 on `If-None-Match`     | must match or client updated                                                     |
| `GET /api/resolve?id=`              | shape recorded           | `{id,url,profile}`, 400/404/502/429, `no-store`; 401 once `ATV_DEVICE_TOKEN` is set (R6)            | must match, or every TV needs the token                                          |
| `GET /api/resolve?ids=`             | likely absent            | batch of 20, `{resolved,missing,invalid}`                                                           | additive, fine                                                                   |
| `GET /api/stream/<id>`              | absent                   | signed-ticket Drive proxy: 206 with `Range`, 403 expired/bad-signature/missing, 503 without the key | additive route, **but** resolve answers differently with the key set (see below) |
| `GET /api/health`                   | may differ or be absent  | `status/config/resolve/guideSnapshot`                                                               | additive, fine                                                                   |
| `GET /api/status`                   | shape recorded           | confirm the repo serves the same contract the TV client expects                                     | **verify**                                                                       |
| `GET /api/idents/random`            | shape recorded           | 302 to HTTPS ident, else 503                                                                        | must match                                                                       |
| `GET /`                             | Phase 0                  | TV client from `apps/tv-client/dist`                                                                | new behaviour (incumbent has no assets)                                          |
| `GET /admin/`                       | may be absent            | static panel + public health                                                                        | new behaviour                                                                    |
| D1 `DB`                             | exported                 | unused                                                                                              | **product decision §2.1**                                                        |
| `REMOTE_HUB` / `/remote`            | traffic measured         | absent                                                                                              | **product decision §2.1**                                                        |
| `ATV_TELEMETRY` / `ATV_ADMIN_TOKEN` | names only               | absent; Access replaces admin auth                                                                  | **product decision §2.1**                                                        |
| Provider origins                    | observed egress          | none                                                                                                | **product decision §2.1**                                                        |

**The row that is easy to miss:** with `ATV_STREAM_SIGNING_KEY` set, a Drive-backed id stops resolving to
its store link and resolves to a ticket path instead. That is the whole point of P1, and it means the parity
question for Drive is not "does resolve match" but "is the client that reads it the current one". With the
key unset the client sees the old, unplayable link and every parity check still passes — so decide it here,
not by accident.

**Gate:** §2.1 answered in writing; every "must match" row confirmed; no `**verify**` or `**product decision**` row left open. If the gate cannot be passed, stop here — the rest of the runbook is not safe to start.

## 5. Phase 2 — Stage the candidate on a temporary hostname

The candidate is a **new Worker with its own name**. The incumbent is never redeployed.

### 5.1 Create the candidate config

Copy the repo's production config and change exactly four things. The file is a declaration of the
**incumbent's** shape, not of what this build needs, so the fourth is the longest:

```bash
cp wrangler.production.toml wrangler.cutover.toml
```

- `name = "atv-core-prod"` (not `atv-core-orchestrator`)
- route pattern `next.atv.acidwurx.org/*` for now (the real route is attached in §7)
- its **own** KV namespaces:

```bash
npx wrangler kv namespace create atv-config-prod
npx wrangler kv namespace create atv-cache-prod
# put the two returned ids into wrangler.cutover.toml's ATV_CONFIG / ATV_CACHE blocks
```

**Why separate KV, not production's:** the Worker _writes_ on its own — the `*/10` cron puts
`guide:latest` into `ATV_CACHE`, and seeding writes `channels`, `system_config`, `config_meta`,
`idents` and `gdrive_map` into `ATV_CONFIG`. Pointing it at production's namespaces before cutover
would have it write into the incumbent's data, and `guide:latest` may be a key the incumbent reads.
Separate namespaces also survive rollback cleanly: there is nothing to undo.

With separate ids, `scripts/check-deploy-target.mjs` sees a non-production name, a non-production
route and no shared namespace ids, so it passes without any override. **Do not set
`ATV_ALLOW_PROD_DEPLOY=1` for this deploy**, and do not set `ATV_ALLOW_SHARED_KV=1` unless §5.3
requires it.

- the bindings this build reads and `wrangler.production.toml` does not declare. Without them the candidate
  deploys, answers the guide, and fails the checks that matter:
  - `[[ratelimits]] name = "ATV_RATE_LIMITER"` — the coarse fallback limiter.
  - `[[durable_objects.bindings]] name = "ATV_LIMITER", class_name = "RateLimiter"` plus the
    `[[migrations]]` entry `tag = "v1", new_sqlite_classes = ["RateLimiter"]`, copied from `wrangler.toml`.
    Without it `/api/resolve` is not rate limited per client key at all, which §6.2 tests.
  - `[[analytics_engine_datasets]] binding = "ATV_METRICS"` — optional, but without it the counters
    (`resolve_unauthorized` and the rest) go nowhere and §8's tail-and-metrics checks read a blank.
  - `run_worker_first` must match `wrangler.toml`'s list **exactly**. `wrangler.production.toml` omits `/a`
    and `/a/*`, so a candidate copied from it answers the SPA shell at the short install address instead of
    the 302 to the APK — the same trap the sandbox hit when `/a` was first added. `pnpm smoke`'s `/a` row
    catches it, but only if smoke runs.

`wrangler.cutover.toml` is a local, uncommitted file: keep it out of git (it names the candidate's KV
ids and temporary route, and it exists only for the window).

### 5.2 Build and deploy the candidate

```bash
pnpm install --frozen-lockfile
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
pnpm run build:deploy
node scripts/check-deploy-target.mjs wrangler.cutover.toml   # expect: ok — atv-core-prod (next.atv…/*)
npx wrangler deploy --config wrangler.cutover.toml
```

### 5.3 Seed the candidate's lineup

`scripts/seed-kv.mjs` takes `--config`, so the candidate is seeded directly and `wrangler.toml` is not
touched:

1. `node scripts/seed-kv.mjs --file ./atv-config.json --config wrangler.cutover.toml` writes the five
   keys (`channels`, `system_config`, `config_meta`, `idents`, `gdrive_map`) into the candidate's
   `ATV_CONFIG`.
2. The shared-namespace guard reads that same config, so a cutover config that still bound production KV
   is refused; the candidate's own namespace ids pass without `ATV_ALLOW_SHARED_KV`.

After seeding, verify that `config_meta` matches: the Worker reports `checksumMatches` and
`schemaMatches` in `/api/health`, and a mismatch there means the seed was partial.

Push the stream links as a **secret** on the candidate (the script supports `--config`):

```bash
node scripts/set-gdrive-map.mjs ./gdrive-map.json --config wrangler.cutover.toml
node scripts/set-gdrive-map.mjs ./gdrive-map.json --dry-run   # confirms ids valid, prints no links
```

### 5.4 Give the candidate a hostname you can reach

Attach `next.atv.acidwurx.org` to `atv-core-prod` (Workers → the Worker → Settings → Domains & Routes →
Add custom domain; the zone is already in the account, so DNS is created for you). Then either add the
service-token include to the Access application for that host, or a temporary `bypass` policy for the
operator's own session, and **record that it must be removed in §7.4**. Without this, §6 cannot run.

## 6. Phase 3 — Verify the candidate before the route moves

Run everything against `https://next.atv.acidwurx.org`, with the candidate's own KV and secrets. Record
command output in the evidence directory.

### 6.1 Functional matrix

```bash
BASE=https://next.atv.acidwurx.org
AUTH=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")

curl -sS "${AUTH[@]}" "$BASE/api/health" | tee health.json
node -e '
const h=require("/dev/stdin");
console.log(h.status, h.config.seeded, h.config.channels, h.config.schemaMatches, h.config.checksumMatches);
console.log(h.resolve);' < health.json
```

Expected: `ok true <n> true true`, where `<n>` is the number of channels in the seeded lineup, and
`resolve.configured` equal to the number of links you pushed.

| Check                | Command / evidence                                                   | Pass condition                                                                            |
| -------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Guide                | `curl "$BASE/api/guide"`                                             | 200, same channels and field names as Phase 0                                             |
| Guide pages          | `?limit=1`                                                           | `channels.length == 1`, `nextCursor` non-null when more exist                             |
| Conditional GET      | send `If-None-Match` with the ETag                                   | 304, no body                                                                              |
| Resolve single       | `?id=<known>`                                                        | 200 `{id,url,profile}`, `Cache-Control: no-store`                                         |
| Resolve missing      | `?id=__nope__`                                                       | 404 `not_found`                                                                           |
| Resolve batch        | `?ids=a,b,c`                                                         | 200 grouped as `resolved`/`missing`/`invalid`/`unconfigured`; 21 ids → 400 `too_many_ids` |
| Resolve unconfigured | a Drive-backed id against a build with no `ATV_STREAM_SIGNING_KEY`   | 503 `stream_unconfigured`; the batch form names the id in `unconfigured`                  |
| Resolve bad token    | a build whose `ATV_DEVICE_TOKEN` contains whitespace                 | 503 `device_token_invalid` (never a 401), and no secret echoed                            |
| Link leakage         | batch response for unknown ids                                       | no URL for any unresolved id                                                              |
| Proxy ticket         | resolve a Drive-backed id, read `.url` only                          | with the key set: a path starting `/api/stream/`, never a Drive URL                       |
| Proxy range          | ranged request at that path                                          | 206 with `Content-Range` and `Accept-Ranges`; whole-file request 200                      |
| Proxy refusals       | the same URL with one `sig` character changed, and with no ticket    | 403 `bad-signature` / 403 `missing`, and no request reaches Drive                         |
| Proxy without key    | the same rows against a build whose key is unset (the sandbox today) | 503 `stream_unconfigured`, so the ticket row is proven to depend on the key               |
| Idents               | `/api/idents/random`                                                 | 302 to an `https://` URL, or 503 with no idents seeded                                    |
| Assets               | `/` and the referenced `/assets/*.js`                                | 200, HTML contains the root div, JS is `javascript`                                       |
| Admin                | `/admin` → `/admin/`                                                 | 308 to `/admin/`; 200 HTML; bundle 200                                                    |
| Unknown API          | `/api/does-not-exist`                                                | 404 JSON with a request id                                                                |
| Smoke                | `pnpm smoke https://next.atv.acidwurx.org`                           | all checks pass (no `--allow-empty` if the lineup is seeded)                              |

### 6.2 Rate limiter and cron

```bash
# 400 requests, concurrency 40: expect ~300 allowed, ~100 × 429 with Retry-After
seq 1 400 | xargs -P 40 -I{} curl -sS -o /dev/null -w '%{http_code}\n' \
  "${AUTH[@]}" "$BASE/api/resolve?id=<known-id>" | sort | uniq -c

# One scheduled invocation and its KV write
npx wrangler tail atv-core-prod --format json | grep -i scheduled
npx wrangler kv key get guide:latest --namespace-id <atv-cache-prod id> --remote | head -c 120
```

Expect the 429 split documented in the README (the Durable Object is strict per client key; the
rate-limit binding alone is not), a `scheduled` invocation within ten minutes, and a `guide:latest`
object that contains channels but no stream URLs. If the limiter fails open (no 429s at all), treat that
as a failure of this phase, not a quirk.

### 6.3 Client checks

- Open `https://next.atv.acidwurx.org` in a browser: the grid lists every channel, focus and scroll work,
  and selecting a channel with a link plays.
- Open `/admin/`, confirm the status cards match `/api/health`, and press **Check stream links**: every
  channel with a pushed link shows ✅ and the rest show ❌.
- Reload with the network throttled to offline for the second load: the guide falls back to the cached
  lineup and shows the stale banner rather than an empty grid.

### 6.4 Budget check

```bash
pnpm budget                              # household default
pnpm budget -- --tvs 10 --resolves 120   # headroom check
```

Both must exit 0. Record the numbers; after cutover the real figures come from the dashboard under
Workers & Pages → the Worker → Metrics, and they should sit far below the model because it assumes no CDN
cache and no isolate memo. The model counts the proxy's media requests separately (`--media-requests`, 300
per TV per day by default) because one play is many ranged requests: set it to what the household actually
watches before treating the number as evidence, and note that the bytes are Drive's egress, not this
account's.

### 6.5 Gate to proceed

All of §6.1–6.4 pass, the evidence is saved, and the rollback owner is present. If any of it fails, fix
it on the candidate; the incumbent is still serving and nobody has noticed.

## 7. Phase 4 — Cutover

### 7.1 Freeze and final pre-swap checks

1. Announce the window; nobody seeds, pushes to `main` or edits KV during it.
2. Confirm the candidate's commit SHA equals the tested SHA (`git rev-parse HEAD`).
3. Re-run, against the candidate hostname: `pnpm smoke https://next.atv.acidwurx.org`, the §6.1 matrix, and `pnpm test`.
4. Confirm the rollback owner can open the route page in the dashboard (readiness, not action).
5. Note the incumbent's current version id (`4fb54df2` unless it changed) in the evidence directory.

### 7.2 Move the route (the only production-changing step)

In **Cloudflare dashboard → account `d949…f2a` → Workers Routes** (or the zone `acidwurx.org` → Workers
Routes), edit the existing `atv.acidwurx.org/*` route and point it from `atv-core-orchestrator` to
`atv-core-prod`.

- Prefer the dashboard route edit: it is one atomic association change and touches nothing else. A
  `wrangler deploy` with the route in `wrangler.cutover.toml` would also attach it, but it redeploys code
  as part of a routing change, which is two things to reason about at once.
- Do **not** attach `atv.acidwurx.org` as a custom domain on the candidate while the route still exists;
  a host cannot be served by a route and a custom domain on different Workers at the same time.
- Do **not** run `ATV_ALLOW_PROD_DEPLOY=1 pnpm deploy:prod` at any point in this runbook. It overwrites
  `atv-core-orchestrator` and deletes the rollback target.

### 7.3 Purge what the edge may still hold

```bash
# Zone cache purge for the API and shell paths (dashboard → Caching → Purge, or the API).
# At minimum: https://atv.acidwurx.org/api/guide and https://atv.acidwurx.org/
```

Asset URLs carry content hashes, so the client bundle does not need a purge; `/api/guide` is edge-cached
(`s-maxage=60`) and could otherwise serve the incumbent's body for up to a minute.

### 7.4 Access

Leave the Access application exactly as it is for this step. The cutover does **not** change Access: the
household's existing login continues to work, and players that are blocked today stay blocked. Fixing
that (scoping the zone-wide app, adding a service-token include) is a separate Zero Trust change, done
and verified after the cutover, not mixed into it.

Remove any temporary bypass you created for `next.atv.acidwurx.org` in §5.4 once the real hostname is
verified.

## 8. Phase 5 — Verify after the swap (first 60 minutes)

```bash
BASE=https://atv.acidwurx.org
AUTH=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")

curl -sS "${AUTH[@]}" "$BASE/api/health"
pnpm smoke "$BASE"
npx wrangler tail atv-core-prod --format json | tee tail-post-cutover.ndjson
```

| Time      | Check             | Pass condition                                                               |
| --------- | ----------------- | ---------------------------------------------------------------------------- |
| T+0       | `/api/health`     | `ok`, same channel count, `schemaMatches`/`checksumMatches` true             |
| T+0       | `/api/guide`      | 200, full lineup, ETag present                                               |
| T+0       | `pnpm smoke`      | all checks pass                                                              |
| T+0       | `/` and `/admin/` | shell + assets 200; admin status matches health                              |
| T+5       | TV client         | grid loads, a channel with a link plays, hover prefetch does not produce 5xx |
| T+5       | Drive channel     | a Drive-backed channel plays and seeks; `tail` shows 206s on `/api/stream`   |
| T+10      | `tail`            | no unexpected 5xx; requests land on the new paths (batch resolve, health)    |
| T+15      | limiter           | a deliberate burst still yields 429s with `Retry-After`                      |
| T+10…T+20 | cron              | one `scheduled` invocation and a fresh `guide:latest` write                  |
| T+30      | dashboard metrics | error rate and CPU in line with Phase 0; no KV write storm                   |
| T+60      | logs              | no repeated `internal_error`/`config_schema_mismatch`                        |

If everything passes, keep the incumbent deployed as a cold spare and leave it alone for the soak period.

## 9. Rollback

Rollback is a route move, not a rebuild. It takes about two minutes and needs no source.

### 9.1 Triggers — roll back if any of these is true

- The TV cannot load the guide or play a channel that worked before.
- Sustained 5xx above roughly 1% of requests for five minutes, or any `internal_error` loop in `tail`.
- `/api/resolve` returns 404/502 for channels that previously resolved.
- `/admin/` or `/` fails to load, or assets 404.
- Cron fails repeatedly (visible as scheduled invocations erroring in `tail`).
- Access breaks for the household and cannot be restored quickly.

Do not debug on the production hostname while the household is watching. Swap back first, then debug on the
candidate hostname.

### 9.2 Steps

1. Dashboard → Workers Routes → point `atv.acidwurx.org/*` back to `atv-core-orchestrator`.
2. Purge `/api/guide` and `/` in the zone cache.
3. `curl` `/api/health` and `/api/guide` with the service token; confirm the incumbent is answering again.
4. Have the TV reload and play one channel.
5. Record the time, the trigger and what was observed in the evidence directory.
6. Leave `atv-core-prod` deployed but routed only to `next.atv.acidwurx.org` for debugging. Do not delete it
   during an incident.
7. If the problem was candidate _code_ rather than the cutover itself, roll the candidate back to its
   previous version (`npx wrangler rollback --config wrangler.cutover.toml`) before trying again.

Because the candidate used its own KV namespaces, rollback needs no data cleanup: the incumbent's
`ATV_CACHE` and `ATV_CONFIG` were never written to.

## 10. Phase 6 — Soak and decommission

Only after **seven days** with no rollback trigger and no unexplained 5xx:

1. Re-run the §8 table once more, plus `pnpm budget` and a dashboard metrics review.
2. Archive the evidence directory (contract captures, D1 export, KV inventories, tail files) somewhere
   durable and access-controlled. Stream URLs never enter it.
3. Remove the `next.atv.acidwurx.org` hostname from the candidate and delete the temporary Access bypass.
4. Decide, with explicit sign-off, what happens to `atv-core-orchestrator`. Deleting the Worker is
   irreversible for its code (already unobtainable) and drops its bindings; the D1 database should be kept
   for at least 30 days after cutover, then deleted deliberately, not by tidying up.
5. Record the new production Worker's name, route, KV ids, secret names and cron in the README, so the
   next operator does not repeat this discovery.

## 11. Budget and monitoring after cutover

- The repo Worker uses the same account-level allowances: Workers requests, CPU, KV reads/writes,
  Durable Object requests/duration, Analytics Engine writes. Static asset requests are free.
- New recurring costs of the move, in allowance terms: the `*/10` cron (about 4,320 KV writes/month and
  4,320 scheduled invocations), the `RateLimiter` Durable Object (one instance per client key), and
  Analytics Engine writes from `ATV_METRICS`. All are small multiples of the sandbox figures and are
  covered by `pnpm budget`'s model.
- The incumbent's D1 and `REMOTE_HUB` usage disappears under option A, which _reduces_ spend.
- Keep observability at the 10% sample rate; 100% burns the free log allowance on guide polls.
- The Drive proxy is a request class of its own: one Worker request and one Drive subrequest per ranged
  media request, no egress charge on Workers Paid, and no Durable Object call (the signed ticket is the
  admission). It is the class that grows with viewing time rather than with tuning, so it is the one to
  watch if the household starts watching more.
- Watch: 5xx rate, 429 ratio against 200s on `/api/resolve`, scheduled invocation failures, KV writes per
  hour, and Durable Object errors. Any sustained change is a rollback signal, not a tuning opportunity.

## 12. Risk register

| Risk                                                                                      | Likelihood           | Impact       | Mitigation                                                                         |
| ----------------------------------------------------------------------------------------- | -------------------- | ------------ | ---------------------------------------------------------------------------------- |
| Incumbent features depend on D1/`RemoteHub` and break                                     | medium               | high         | §2.1 decision + Phase 0 traffic evidence; choose option B if unclear               |
| Repo Worker's wire shapes differ from the incumbent's and the old client misbehaves       | medium               | high         | §4 parity table + §6.1 diff before the route moves                                 |
| Candidate writes into production KV (`guide:latest`, seeded keys)                         | low if §5.1 followed | high         | separate namespaces; never set `ATV_ALLOW_SHARED_KV=1` without a written reason    |
| Every Drive channel is dead after the move (no `ATV_STREAM_SIGNING_KEY` on the candidate) | medium               | high         | §2.4 decides the key up front; §6.1's proxy rows prove it before the route moves   |
| Route change done without a rollback rehearsal                                            | low                  | high         | dashboard route edit is reversible in seconds; rehearse on `next.*` first          |
| Access blocks verification or the household                                               | certain today        | medium       | service token prepared; Access fix kept as a separate change                       |
| Seed tooling targets the wrong config                                                     | low                  | low          | `--config` selects the target and the guard reads the same file (§5.3)             |
| Stale edge cache serves the incumbent's guide after swap                                  | medium               | low          | purge `/api/guide` and `/` (§7.3)                                                  |
| Incumbent source never becomes available, so a subtle feature is missed                   | certain              | medium       | treat as black box; parity matrix + seven-day soak; keep incumbent as spare        |
| Rollback target deleted too early                                                         | low                  | catastrophic | never delete `atv-core-orchestrator` before the soak ends and sign-off is recorded |

## 13. One-page order of operations

1. Decide §2.1 (A, B or C). If C, stop.
2. Prepare access, service token, lineup, link map, window.
3. Phase 0: export D1, inventory KV keys and secret names, capture endpoint shapes, sample traffic.
4. Fill the §4 parity table; pass the gate.
5. Create `wrangler.cutover.toml`: new name `atv-core-prod`, its own KV, temporary route `next.*`, and the
   bindings and `run_worker_first` this build needs (§5.1) — the copied file lacks the limiter, the counters
   and `/a`.
6. Build, guard, deploy the candidate. Seed it. Push links as a secret, set `ATV_STREAM_SIGNING_KEY`, and set
   `ATV_DEVICE_TOKEN` only if every TV already carries the R5 client.
7. Verify the candidate completely (§6) — functional including the Drive proxy, limiter, cron, clients,
   budget.
8. Freeze; re-check; record the incumbent version.
9. Point `atv.acidwurx.org/*` at `atv-core-prod`; purge `/api/guide` and `/`.
10. Verify for 60 minutes (§8), watching `tail` and metrics.
11. On any trigger, move the route back (§9). Debug on `next.*`, not in production.
12. Soak seven days, archive evidence, remove the temporary hostname, then decommission deliberately.
