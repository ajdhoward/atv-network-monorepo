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
- **Done when:** `GET /install` and `GET /join` answer 200 on the workers.dev host and `pnpm smoke` passes.
- **Paths:** `.github/workflows/deploy.yml` (manual `workflow_dispatch`, target `v2`)
- **Size:** S
- **State:** blocked — needs the operator's go-ahead, because it publishes a public host

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
- **Done when:** `pnpm streams` reports every channel ready, or the gaps are the ones the operator expects.
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
- **State:** proposed — the approach is settled, the design is not; it wants a `decisions.md` entry first

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
- **Done when:** a free external monitor hits `/api/health` on a schedule and alerts the operator.
- **Paths:** none in this repo
- **Size:** S
- **State:** proposed — needs a decision, because a new service needs approval even when it is free

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
  links only, the host sits behind Access with a service token, or resolve requires a per-device token.
- **Paths:** `services/atv-core/src/index.ts`, `wrangler.toml`, Cloudflare Zero Trust
- **Size:** M
- **State:** proposed — needs the decision before L4

### R2 · Pin the toolchain the repo claims it has

- **Why:** `package.json` names no `engines`, and CI runs wrangler 4.166.0 while the dependency range is
  `^4.136.1`, so a local build and the deploy can use different CLIs and disagree about a deploy.
- **Done when:** `engines` states Node 22 and pnpm 9, and the workflow takes its wrangler version from the
  lockfile instead of carrying a second pin.
- **Paths:** `package.json`, `.github/workflows/deploy.yml`
- **Size:** S
- **State:** proposed

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
- **State:** proposed — adds a dev dependency, so it needs the usual approval

## Parked

- **ADB console for the TV.** Needs an always-on LAN host behind a Tunnel; Apps2Fire and Bugjaeger already
  cover the one-off install. Parked 2026-11-23.
- **Weekly role rotation.** Worth doing at three or more agents so review does not harden into one
  perspective; pointless with one. Parked until then.
