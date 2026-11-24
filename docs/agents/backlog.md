# Backlog

The work list for this repository, and the place the work is argued about. Read it at the start of every
session. It is deliberately short: a section here means someone thought it was worth doing and someone
else reviewed it.

More agents only help if they add judgement before the work starts, so an item is reviewed by everyone
active before it is accepted, and the review is written down where the next session will see it.

## How an item moves

`proposed` → `accepted` → `claimed` → `done`, or `parked` / `blocked`.

1. **Propose.** Add a section with why it matters, how you will know it is done, the paths it touches and a
   size. Anyone may propose; nobody needs permission to write a section.
2. **Review.** Every other active agent adds one line the next time it works: `ack — <name>`, or
   `object — <name> — <concrete harm>`, or a smaller alternative. The rule in `decisions.md` applies here
   too: silence is recorded as absence, never as consent.
3. **Decide.** The operator sets priority and accepts, rejects or parks it. An objection is answered in the
   section, not ignored.
4. **Claim.** An accepted item is claimed by naming it and its paths in your roster row. If two agents want
   one item, the Integrator assigns it.
5. **Finish.** Mark it done with the commit that closed it, and write down anything the next agent would
   otherwise have to rediscover.

Sizes: **S** is an afternoon, **M** a day or two, **L** wants a plan in `decisions.md` first.

---

## Live and operator-gated

### L1 · Deploy the sandbox so `/install` and `/join` are served

- **Why:** both pages exist and are tested, but no host serves them, so the phone install and the guest
  agent path are unreachable in practice.
- **Done when:** `GET /install` and `GET /join` answer 200 **with their page body** on the workers.dev host and
  `pnpm smoke` passes. A status code alone proves nothing: the asset layer's SPA fallback answers any path.
- **Paths:** `.github/workflows/deploy.yml` (manual `workflow_dispatch`, target `v2`)
- **Size:** S
- **State:** blocked — needs the operator's go-ahead, because it publishes a public host. On 2026-11-24 the
  deployed sandbox answered `200` for `/install`, `/a`, `/admin/` and `/` while serving the 639-byte SPA shell,
  because `not_found_handling = "single-page-application"` answers every unmatched path — check the body (an
  APK link; `/a` must be a `302` to the release) or run `pnpm smoke`, which does. The same read showed the host
  is on a build from before R5/R6: the live bundle is 9.6 kB with no token prompt, `/api/health` has neither
  `deviceTokenSet` nor `streamSigningKeySet`, and a headerless `/api/resolve` answers `404`, not `401`.

### L2 · Protect `main` with `verify` and a pull request

- **Why:** guest agents hold write tokens. "Branch and PR only" is a page, not enforcement, and a
  `Contents: write` token can push `main` directly today.
- **Done when:** a direct push is rejected and a pull request needs the `verify` check.
- **Paths:** GitHub → Settings → Branches
- **Size:** S
- **State:** blocked — operator, and it should land before the first guest agent is authorised

### L3 · Add the Android signing secrets

- **Why:** without `ANDROID_KEYSTORE_BASE64` and friends each CI build is debug-signed with a new key, so a
  fresh APK will not install over the old one.
- **Done when:** two consecutive workflow runs produce APKs that install over each other.
- **Paths:** `.github/workflows/android.yml`, repository secrets
- **Size:** S
- **State:** blocked — the operator holds the keystore

### L4 · Set `ATV_TORBOX_API_KEY` and `ATV_GDRIVE_MAP`

- **Why:** a TorBox-mapped channel answers 502 and a Drive-mapped one 404 until these exist; `/api/health`
  counts them as missing.
- **Done when:** `pnpm streams --probe` reports every channel ready, or the gaps are the ones the operator
  expects. `--probe` is not optional here: a 200 from `/api/resolve` only means a link is stored or mintable.
  Since P5 a keyless Drive channel answers `503 stream_unconfigured` rather than the share page, so the two
  faults are distinguishable — but a stored link that is not the file the operator meant is still only found
  by following it.
- **Paths:** Worker secrets (never the repo)
- **Size:** S
- **State:** blocked — operator, out of band

### L5 · Install and play on a real Fire TV

- **Why:** no build of this app has ever run on hardware. Every claim about D-pad focus, playback and the
  retry screen is inference from the code.
- **Done when:** one channel resolves and plays from the installed APK, and the notes are written down.
- **Paths:** none; findings go in `docs/`
- **Size:** M
- **State:** blocked — needs a device and the operator's hands

## Playing

### P1 · Google Drive proxy at `/api/stream/<id>`

- **Why:** Drive has no direct-play URL. Until this exists a Drive-backed channel cannot play at all, and
  the alternatives are expiring links or exposing the drive.
- **Done when:** the Worker serves `Range` requests with 206 and seeks work in a TV player; signed URLs are
  covered by tests, including expiry and a bad signature.
- **Paths:** `services/atv-core/src/`, `services/atv-core/test/`
- **Size:** L
- **State:** done — operator accepted the 2026-11-24 entry. `stream.ts` holds the Drive id parsing, the
  media URL and the response headers; `/api/stream/<id>` verifies the ticket, re-reads the link and forwards
  `Range`; `/api/resolve` mints a ticket for a Drive link and leaves every other link alone. Route tests
  cover a mid-file 206, a whole-file 200, a 416, each refusal and a resolve→stream round trip. `pnpm smoke`
  now asks for the route with no ticket and expects the refusal health implies (`403 missing` with the key,
  `503 stream_unconfigured` without), because a shadowed route answers `200` with the TV shell and every other
  post-deploy check still passes. Not exercised against Drive itself: a Drive channel with no
  `ATV_STREAM_SIGNING_KEY` now answers `503 stream_unconfigured` (P5) instead of resolving to its unusable
  link, and a file not shared link-wide still needs P2's service-account credential.

### P2 · Drive service-account secret for P1

- **Why:** the proxy authenticates to Drive server-side, so the key must live in a Worker secret.
- **Done when:** the secret exists and a check reads one byte range through the proxy.
- **Paths:** Worker secrets
- **Size:** S
- **State:** blocked — operator, and only useful after P1

### P3 · Short path `/a` that redirects to the APK

- **Why:** typing a release URL with a TV remote is the worst step of the install; `/a` is four characters
  in Downloader.
- **Done when:** `GET /a` 302s to the release asset and smoke checks the redirect rather than a body.
- **Paths:** `services/atv-core/src/index.ts`, `services/atv-core/src/install.ts`, `wrangler.toml`,
  `scripts/smoke.mjs`
- **Size:** S
- **State:** done — `4d58bab`, claimed on the operator's session go-ahead. `/a` is Worker-routed
  (`run_worker_first`), the install page names it, and the route suite, smoke and `ci:worker` cover it.

### P4 · A paused TV outlives its stream ticket

- **Why:** P1 mints a 15-minute ticket per resolve. A film paused for longer resumes by sending a `Range` on
  an expired URL, which `/api/stream` answers `403 expired`; the player treats that as a source error and the
  retry path resolves again, so playback restarts at the beginning. A long pause is normal viewing, not an
  edge case, and nothing has exercised it: no TV has played a proxied channel yet (L5).
- **Done when:** a film paused past the ticket's life resumes where it was, or the ticket's life is longer
  than a viewing session — and `decisions.md` records which, with the reasoning.
- **Paths:** `services/atv-core/src/stream-sign.ts`, `apps/tv-client/src/`, tests
- **Size:** S
- **State:** done — `6edfab4`. The ticket's life is one hour, with the reasoning in `decisions.md`; the route
  test's "stale" ticket is now derived from `DEFAULT_TTL_S` instead of a fixed 20-minute offset, which is what
  the change caught. Still unverified until L5: a real `<video>` resuming after a pause. The longer life removes
  the 15-minute trap; it cannot prove a Fire TV's Range behaviour.

### P5 · A Drive channel with no signing key should fail loudly

- **Why:** P1 kept answering the stored link while `ATV_STREAM_SIGNING_KEY` is unset, so the deploy changed
  nothing before the operator acted. The household result is a channel that resolves `200` to a share page a
  `<video>` cannot play — "no stream configured" for a channel that is configured. `/api/health` and the panel
  report the flag, but anything reading resolve status alone still sees a healthy channel.
- **Done when:** a Drive link with no key answers `503 stream_unconfigured` (`/api/stream`'s existing code),
  the batch form carries a fourth `unconfigured` list, and `smoke`, `pnpm streams` and the panel understand it.
- **Paths:** `services/atv-core/src/resolver.ts`, `services/atv-core/src/index.ts`, `services/atv-core/test/`,
  `scripts/`, `apps/admin-cms/src/`, `packages/ui-shared`
- **Size:** S
- **State:** done — `2c06b68`. Single resolve answers `503 stream_unconfigured` (the code `/api/stream` already
  uses), the batch body carries an `unconfigured` list, the panel shows it as its own state and `pnpm streams`
  names the missing secret.

## Safety and quality

### Q1 · Make `pnpm budget` part of CI

- **Why:** the $5 ceiling is honour-system outside the budget unit tests; nothing fails a change that would
  leave the allowance.
- **Done when:** `verify` fails when the modelled usage exceeds the plan.
- **Paths:** `.github/workflows/deploy.yml`, `scripts/budget.mjs`
- **Size:** S
- **State:** proposed

### Q2 · Smoke-check the release asset

- **Why:** an existing install updates from one URL. If the release or the asset name changes, nothing
  notices until someone tries to install.
- **Done when:** the deploy smoke sends a HEAD to the asset URL and fails on a non-200.
- **Paths:** `scripts/smoke.mjs`
- **Size:** S
- **State:** done — `4d58bab`. The smoke HEs the location `/a` gives it: a 4xx fails, while a 5xx or an
  unreachable host warns, because neither is this Worker's fault.

### Q3 · Alert when the Worker is down

- **Why:** health is only checked when a person runs smoke, so a dead guide is found by someone sitting in
  front of the TV.
- **Done when:** a free external monitor hits `/api/health` on a schedule and alerts the operator when the
  body stops reporting `"status": "ok"`. A status code alone is not enough: health answers `200` while
  reporting `degraded` — unseeded, or a schema mismatch that makes every guide request a 503 — and a
  status-code monitor would call that healthy.
- **Recommendation (researched 2026-11-24; no account created):** UptimeRobot's free plan — $0, no card, 50
  monitors, 5-minute intervals, keyword monitors included on Free, email and app push. The exact settings, the
  keyword and the triage order are in [`../uptime.md`](../uptime.md). The keyword is `"ok"` **with the quotes**
  rather than `"status": "ok"`: the pretty-printed spacing is a serialiser detail, and only the quoted value
  survives a change to it. Health stays public after R8, so no credential goes to the monitor.
- **Alternatives:** Better Stack (10 monitors, 3-minute checks, keyword included) and Checkly (checks as code)
  both work. Healthchecks.io is heartbeat-only and would need a cron job to ping it, which is a second thing to
  break. A GitHub Actions schedule plus an issue avoids a new account, but needs a workflow edit and GitHub
  disables scheduled workflows in a public repository after 60 days without activity.
- **Paths:** none in this repo; the monitor lives in the operator's account
- **Size:** S
- **State:** done in the repository — `6940d3f`. `docs/uptime.md` is the setup sheet; nothing has been signed
  up for here. The operator's part is three clicks in their own account: create the keyword monitor at five
  minutes, alerting when the keyword is absent.

### Q6 · `@atv/ui-shared`'s runtime half is dead, and the schema version lives three times

- **Why:** coverage found the shared package at 0% and the reason is not a missing test: every importer writes
  `import type`, so `validateConfig` and `CONFIG_SCHEMA_VERSION` are executed by nothing. The constant they
  duplicate is maintained again in `services/atv-core/src/config-meta.ts` and
  `scripts/lib/config-meta.mjs`, so the one number the seed, the Worker and the wire contract must agree on has
  three homes. The two that are actually read now have a parity test; the third has no reader at all.
- **Done when:** `packages/ui-shared` exports types only (the two unused exports deleted) or is the single
  source of the constant, and nothing imports as a value what it does not execute.
- **Paths:** `packages/ui-shared/src/index.ts`, `README.md` if the package description changes
- **Size:** S
- **State:** done — `32dedf3`. The package is types only, and all three packages still typecheck, which proves
  nothing was importing either export as a value.

### Q7 · Model the Drive proxy in `pnpm budget`, and accept a pasted `--`

- **Why:** P1 made this Worker the origin of every Drive channel's bytes and the traffic model never learned
  about them: it counted guide loads, resolves and health checks, so a deployment serving proxied video
  reported the same 0.43% worst share as one that never played. Separately, the documented
  `pnpm budget -- --tvs 10` form failed — pnpm 9.1.0 passes the separator through and the CLI read it as a
  flag. Either one makes the model's number, or the instruction that produces it, wrong.
- **Done when:** media requests are a modelled class with a default and a flag, the assumption line prints
  them, and a lone `--` in argv is ignored; a test covers each.
- **Paths:** `scripts/lib/budget.mjs`, `scripts/budget.mjs`, `scripts/test/budget.test.ts`, `README.md`
- **Size:** S
- **State:** done — picked as this session's next step under the operator's standing "execute the next logical
  steps" instruction, the same footing P3 was claimed on. Household default is now 0.57% (KV reads) rather
  than 0.43%, with the proxy counted at 300 media requests per TV per day, each one a Worker request and a
  Drive subrequest and no limiter token.

### Q8 · `wrangler.production.toml` no longer describes the Worker this repo builds

- **Why:** it is the repository's declaration of production's shape and the file `docs/production-cutover.md`
  tells the operator to copy. It declares neither `ATV_RATE_LIMITER`, nor the `ATV_LIMITER` Durable Object
  with its migration, nor `ATV_METRICS`, and its `run_worker_first` omits `/a` and `/a/*` — so a candidate
  built from it would answer the short install address with the TV shell and resolve without the per-client
  limiter. Everything it does declare is the incumbent's: its name, its route and the two KV ids.
  The cutover doc now lists what to add by hand; this item is about the file telling the truth on its own.
- **Done when:** it declares every binding `wrangler.toml` declares, with production's own names and ids, its
  `run_worker_first` matches, and `node scripts/check-deploy-target.mjs wrangler.production.toml` still refuses
  a deploy without the explicit override — the file stays a declaration, not a deploy path.
- **Paths:** `wrangler.production.toml`
- **Size:** S
- **State:** done — `95f33b0`. The file mirrors the sandbox's bindings, migration and routes, and
  `check-deploy-target` still refuses it without `ATV_ALLOW_PROD_DEPLOY=1`, so it stays a declaration rather
  than a deploy path.

### Q9 · The Actions deploy's smoke step fails once the household token is enforced

- **Why:** `deploy.yml`'s sandbox smoke runs `pnpm smoke` with no `ATV_DEVICE_TOKEN`, which was correct before
  R8 and is wrong after it: smoke's resolve check gets a `401`, names the token and exits 1, so a successful
  deploy ends with a red job. That is the same "a red check that means you forgot a token teaches people to
  distrust checks" failure R7 fixed for local callers, now sitting on the CI path that L4 and every later
  client change will use.
- **Done when:** either the repository secret `ATV_DEVICE_TOKEN` is set and passed to that step — so CI proves
  resolve as well as the routes — or the step stops claiming a check it cannot make and says why, with the
  reason written down.
- **Paths:** `.github/workflows/deploy.yml`, repository secrets, `docs/r8-rollout.md`
- **Size:** S
- **State:** done in the repository — `78047ba`. The sandbox smoke step receives `secrets.ATV_DEVICE_TOKEN`.
  The operator's half remains: add that repository secret in the R8 sitting. Without it the step still goes
  red, and the red now means the repository cannot authenticate rather than that the check is broken.

### Q10 · A household token that can never be accepted must not read as a wrong token

- **Why:** `bearerToken` takes one token (`(\S+)`), so a secret containing a space can never match: every TV
  holding the right value says _That token was not accepted_, which blames the household for the deployment's
  mistake and sends someone to retype a value that could never work. The runbook now warns and the inventory
  records the rule, but a document cannot fail at request time and the Worker can.
- **Done when:** `checkDeviceToken` tells a secret that cannot be presented from one that was presented wrongly,
  `/api/resolve` answers the first with the deployment's own error (503, not 401), and a test covers it. R8's
  Step 3 check would then read the difference, and the token prompt would stop being the bearer of bad news.
- **Paths:** `services/atv-core/src/device-token.ts`, `services/atv-core/src/index.ts`, tests
- **Size:** S
- **State:** done — `2c06b68`. `checkDeviceToken` answers `unpresentable`, `/api/resolve` turns it into
  `503 device_token_invalid`, and tests cover it both with a header and without one — plus a secret whose only
  whitespace is at the ends, which is still `allow`.

### Q11 · Exercise an unpresentable token in `ci:worker`

- **Why:** both 503 codes are unit-tested, and `ci:worker` boots the Worker with a presentable token, so the one
  state that confused an operator — every request refused because the deployment's own token contains
  whitespace — has never been seen in workerd. `6233cbf` fixed the scripts that read it, and the review proved
  the fix by hand against two local Workers; the check itself still cannot reach it.
- **Done when:** `ci:worker` runs a short separate pass whose Worker gets `--var ATV_DEVICE_TOKEN:has space` and
  asserts `pnpm streams` and `pnpm smoke` both name the token and neither names the signing key.
- **Paths:** `scripts/ci-worker.mjs`, `scripts/test/`, `.github/workflows/deploy.yml` if it becomes a CI step
- **Size:** S
- **State:** proposed — a second Worker boot doubles the slowest check's runtime, so the operator decides
  whether it runs on every push or only in the deploy workflow.

## Production cutover

### Q4 · Download and commit the deployed `4fb54df2` source

- **Why:** the live `atv-core-orchestrator` is not in git. Replacing it without its source loses D1,
  `REMOTE_HUB`, telemetry and the admin token.
- **Done when:** that source is in the repo (or a branch) and matches the deployed bindings.
- **Paths:** new, per `docs/production-cutover.md`
- **Size:** M
- **State:** blocked — operator, dashboard access

### Q5 · Scope the zone-wide Access application

- **Why:** the `acidwurx.org` application covers every host, so players and CI cannot reach api/atv hosts
  without a browser login.
- **Done when:** the app covers only the hosts that need a login and a service-token policy lets CI through.
- **Paths:** Cloudflare Zero Trust
- **Size:** M
- **State:** blocked — operator

## Team

### T1 · Roster row and a nested `android/AGENTS.md` for the next agent

- **Why:** a guest with no map edits the wrong area, and the Android module has conventions that do not
  belong in the root brief.
- **Done when:** the row exists and, only if `android/` is theirs, the nested file explains just that
  subtree.
- **Paths:** `docs/agents/roster.md`, `android/AGENTS.md`
- **Also:** an agent with no repository access sends a handoff file instead (`pnpm handoff`,
  `docs/agents/handoffs/README.md`), so its paths and proposal reach the channel before access does.
- **Size:** S
- **State:** proposed — waits for the operator to say which paths the next agent owns

## Findings from the 2026-11-23 review

### R1 · Decide how `/api/resolve` stays private on a public host

- **Why:** the sandbox has no Access in front of it and `/api/resolve?id=` answers any caller with the
  stream URL. That is harmless while the sandbox is unseeded and stops being harmless the moment L4 seeds
  it.
- **Done when:** one of these is chosen in `decisions.md` and enforced — the sandbox is seeded with test
  links only, the host sits behind Access with a service token, or resolve requires a household token.
- **Paths:** `services/atv-core/src/index.ts`, `wrangler.toml`, Cloudflare Zero Trust
- **Size:** M
- **State:** accepted — option C, the operator, 2026-11-23: one household token shared by every TV, Access
  kept for the control planes, enforcement only after the client ships. Split into R5–R8 below; L4 still waits
  for R8, because seeding real links before resolve is authenticated is the one thing this decision stops.

### R2 · Pin the toolchain the repo claims it has

- **Why:** `package.json` names no `engines`, and CI runs wrangler 4.166.0 while the dependency range is
  `^4.136.1`, so a local build and the deploy can use different CLIs and disagree about a deploy.
- **Done when:** `engines` states Node 22 and pnpm 9, and the workflow takes its wrangler version from the
  lockfile instead of carrying a second pin.
- **Paths:** `package.json`, `.github/workflows/deploy.yml`
- **Size:** S
- **State:** partly done — `package.json` declares `engines` (Node `>=22`, pnpm `>=9`). The workflow half is
  untouched and still proposed: it edits `.github/workflows/deploy.yml`, which is the operator's call.

### R4 · Decide where the line-up and secrets are backed up

- **Why:** `docs/continuity.md` can record names and rebuild steps, but the line-up itself is only in the
  operator's store, KV and one repository secret. Losing all three loses the network, and a public repo
  cannot hold it.
- **Done when:** one option is chosen in `decisions.md` and the recovery steps work from it — a private
  companion repo, an encrypted blob committed here with the passphrase held elsewhere, or a password
  manager entry plus KV as the live copy.
- **Paths:** `docs/continuity.md`
- **Size:** S
- **State:** proposed — the operator decides, because every option touches where a secret lives

### R3 · Report test coverage in the review

- **Why:** 160 tests say nothing about the files with none, so a new module can land unexercised without a
  signal.
- **Done when:** each review record carries a coverage number and names the files at zero.
- **Paths:** `vitest.config`, `docs/agents/reviews.md`
- **Size:** S
- **State:** done — `vitest.config.ts` and `pnpm coverage` (`@vitest/coverage-v8` 3.2.7, MIT, matching the
  pinned `vitest`). The scorecard has a Coverage row and "Outputs" now requires the number plus the files at
  zero; the 2026-11-24 P1 record carries the baseline as an addendum (90.05% lines over 33 files, three at
  zero). `scripts/` is excluded deliberately: its tests spawn the CLIs, v8 only sees the test process, and a
  report that calls every script uncovered would be a lie. Not wired into CI — a review instrument, not a gate.

### R5 · The client sends the household token, and asks for it on a TV remote

- **Why:** option C (R1) is only real if the player carries the token, and the served client is the one place it
  can be entered without re-sideloading every TV.
- **Done when:** `resolve.ts` and `playerManager.js` send `Authorization: Bearer <token>`; a 401 opens the token
  prompt instead of "unavailable", and a wrong token says it is wrong rather than blaming the channel; the token
  lives in `localStorage`; the guide still renders without one, so a TV that has not been set up is not blank.
- **Constraint (checked 2026-11-23):** the prompt has to be usable with a D-pad. `main.ts` prevents default on
  Backspace, Enter, Escape and the arrows from one document-level `keydown` listener, so an `<input>` added
  without suspending that handler can neither be corrected nor submitted. Short grouped code, handler suspended
  while it is open, and a way back in after a rotation. Untested on a remote until L5.
- **Paths:** `apps/tv-client/src/`, `apps/tv-client/test/`
- **Size:** S
- **State:** done — `61831d3`. `resolve.ts` and the player's hover prefetch send the header; a 401 becomes
  `unauthorized` and opens `tokenPrompt.ts`, which says "missing" or "refused" rather than letting a wrong
  token look like a broken channel, and saving it retries the channel that hit the 401. The guide still
  renders without a token because it never asked for one. The prompt's D-pad behaviour is exercised in
  happy-dom only: whether a Fire TV's on-screen keyboard and Back key reach a focused `<input>` as
  themselves is unverified until L5.

### R6 · Enforce the token on `/api/resolve`

- **Why:** the check is what stops a stranger pulling the whole line-up from an id sweep; until it lands the
  prompt protects nothing.
- **Done when:** single and `?ids=` resolve reject a headerless request with a 401 carrying
  `{error,code,requestId}`, before a limiter token or a TorBox call; the token is compared as a digest, never
  logged, never read from the query string; `Authorization` is in `Access-Control-Allow-Headers`; unauthorised
  attempts get their own counter; `/api/health` says whether the secret is set; `ATV_DEVICE_TOKEN` is in
  `env.ts`, in the inventory in `docs/continuity.md` in the same change (that check fails on an inventoried name
  the repository does not use, which is the right failure), and in `AGENTS.md`'s settled decisions.
- **Paths:** `services/atv-core/src/`, `services/atv-core/test/`, `docs/continuity.md`, `AGENTS.md`
- **Size:** S
- **State:** done — `device-token.ts` is called from `handleResolve` ahead of the limiter; unauthorised
  attempts get their own counter, `Authorization` is in `Access-Control-Allow-Headers`, and health reports
  `deviceTokenSet`. `ATV_DEVICE_TOKEN` is in `env.ts`, `.dev.vars.example` and the inventory in
  `docs/continuity.md`; `AGENTS.md` records the order. A deployment without the secret answers exactly as
  before, so this is inert until R8 sets it — and **R7 must land first**, or the admin panel, smoke,
  `pnpm streams` and `ci:worker` fail closed the moment it is switched on.

### R7 · Teach every non-TV caller the header

- **Why:** after R6 the admin link check, `pnpm smoke`, `pnpm streams` and `ci:worker` all fail closed, and a red
  check that really means "you forgot a token" teaches the next agent to distrust the checks.
- **Done when:** `apps/admin-cms/src/links.ts` and `scripts/smoke.mjs`, `scripts/check-streams.mjs`,
  `scripts/ci-worker.mjs` send the header when the token is in the environment and say plainly when it is not;
  `ci:worker` uses its own local token against the fixture; the audit path is `pnpm streams` with the token in
  the operator's environment.
- **Paths:** `apps/admin-cms/src/links.ts`, `scripts/`, `docs/`
- **Size:** S
- **State:** done — the admin panel takes the token once per browser (`apps/admin-cms/src/linkToken.ts`),
  sends it on resolve batches only, and reports "the worker needs the household token" on a 401 instead of
  scoring every channel broken. `pnpm smoke`, `pnpm streams` and `ci:worker` send `ATV_DEVICE_TOKEN` from the
  environment and name the token on a 401; `ci:worker` boots the Worker with a local token and asserts both
  halves (401 without it, 200 with it), so enforcement is exercised in workerd before R8 turns it on.

### R8 · Roll C out in the enforced order, with the operator

- **Why:** enforcing before the client ships strands every installed TV on a 401 it cannot clear, and that
  ordering is the only thing between this decision and a household that cannot watch anything.
- **Done when:** the client with the prompt is deployed (L1) and installed on every TV; then `ATV_DEVICE_TOKEN`
  is set on `atv-core-v2`, which is the switch; each TV has taken the token from the 401 prompt; resolves
  arriving without the header have fallen to none apart from TVs that have not been switched on; and a
  headerless resolve answers 401 while a TV plays.
- **Paths:** Worker secrets, `.github/workflows/deploy.yml`, the TVs
- **Runbook:** [`../r8-rollout.md`](../r8-rollout.md). The order in it is client first, secret second: the
  token is entered from a prompt that only opens on a 401, so the secret cannot land before every TV carries
  the R5 build without stranding the ones that do not.
- **Size:** M
- **State:** blocked — operator (a secret and a deploy), after R5–R7. This is what unblocks L4.

## Parked

- **ADB console for the TV.** Needs an always-on LAN host behind a Tunnel; Apps2Fire and Bugjaeger already
  cover the one-off install. Parked 2026-11-23.
- **Weekly role rotation.** Worth doing at three or more agents so review does not harden into one
  perspective; pointless with one. Parked until then.
