# Buffy — context

Working memory for the next session. Canonical state is in the logs; this is what they do not hold.

- **Agent:** Buffy, Freebuff (Codebuff), cloud chat `9b6340e1`
- **Roles:** Integrator, Cartographer, Scribe, Sentinel (sole active agent, so Author/Reviewer/Verifier are
  declared self-review in each change)
- **Paths owned:** `services/atv-core/`, `scripts/`, `docs/`, `README.md`, `AGENTS.md`
- **Last session:** 2026-11-23

## Where the project stands

- `fd08253` — reviewed backlog, roles, coverage.
- `0fdadee` — `/join` and the shared page shell.
- `866dda1` — full repository evaluation, `docs/agents/reviews.md`, first review record.
- `36e32b2` — `/onboard`, `pnpm handoff`, `docs/agents/handoffs/`.
- `2adcc4d` — `docs/continuity.md`, `docs/README.md`, `pnpm continuity` in `verify`.
- `e75a7b1` — per-agent context files, the roster `Context` column and the check that enforces it.
- `4d58bab` — `/a` short APK redirect (P3) and the release-asset smoke guard (Q2).
- `e967b73`, `7330f49` — the R1 decision record, then its tightening (one shared household token rather than a
  per-device one, and the installed-APK gap that enforcing early would open).
- These are on `freebuff/9b6340e13dd9c5125e906312`, not merged to `main`. Nothing deployed: the sandbox still
  serves the pre-`/install` build.

## What I am doing

**R5 is done** (`61831d3`). The client sends the token from `resolve.ts` and from the player's hover prefetch;
a 401 opens `tokenPrompt.ts`, which distinguishes missing from refused and retries the channel on save. The
store is injectable (`createTokenPrompt({ store })`), which is what made the prompt testable here: this Node
build has no global `localStorage` even under happy-dom. Unverified: whether a Fire TV's on-screen keyboard
and Back key reach a focused `<input>` as themselves — L5 hardware only.

**R6 is done.** `checkDeviceToken` runs in `handleResolve` before the limiter and before any provider call;
the 401 carries `{error,code,requestId}` and a Bearer challenge, unauthorised attempts have their own counter,
`Authorization` is in `Access-Control-Allow-Headers`, and `/api/health` reports `deviceTokenSet`. Nothing
changes without the secret, so it is inert until R8. Verified in workerd: `ci:worker`'s resolve still 200s
because no `.dev.vars` token is set there, which is the unenforced path doing its job.

**R7 is done.** The admin panel takes the token per browser and sends it on resolve batches only; smoke,
streams and `ci:worker` read `ATV_DEVICE_TOKEN` from the environment and name the token on a 401. `ci:worker`
is the useful one: it starts the Worker with `--var ATV_DEVICE_TOKEN:…` and asserts 401 headerless and 200
with the header, so enforcement is exercised in workerd on every run rather than only in the route suite.

**I looked at the admin panel for the first time.** Served the built assets through `wrangler dev` on this
chat's preview port and shot it in the browser at 420px and 1280px, holding `/api/health` to catch the
CHECKING state. Two things the code review could not see: the folder tree printed its path twice (a root crumb
and a `<code>` line saying the same thing), and the token input's 280px floor plus its button overflowed a
420px screen. The tree now steps back instead of appending, and both are in the screenshots under
`artifacts/`. Playwright routes die when the call ends, so a held response has to be photographed in the same
call; `setViewportSize` does nothing on this tab — use a CDP `Emulation.setDeviceMetricsOverride`.

**The grid now has tests** (`apps/tv-client/test/grid.test.ts`, 8), including the click path — which taught me the
one thing a test can: a tile click focuses and plays but does not re-fire `onFocus`, because the hover prefetch
belongs to `mouseenter`. `PlayerManager.detectProfile()` is gone; the review had flagged it as dead.

**P1 has a design and its first file.** `decisions.md` (2026-11-24) proposes `/api/stream/<id>?exp&sig`: the
resolve call (already token-protected) mints a 15-minute HMAC ticket, because a `<video src>` cannot send a
header; the proxy verifies the ticket then passes `Range` through to Drive. `stream-sign.ts` implements the
ticket and its tests cover id binding, expiry, forgery and a missing secret. The route and the `/api/resolve`
change wait for the operator to accept the entry — that is a shared shape, so it does not land on my say-so.

**Next: R8, which is the operator's** — set `ATV_DEVICE_TOKEN` on `atv-core-v2`, deploy the R5 client, get the
token onto each TV, confirm headerless resolves have stopped, then enforcement is already live (there is no
second switch: the secret _is_ the switch). Then L1 (deploy), L2 (branch protection), L4 (seed real links).
P1 (the Drive proxy) is the only thing left between "resolves" and "plays" for Drive-backed channels.

## What I learnt that cost time

- **A fresh cloud VM has no pnpm and no git identity.** `npm install -g pnpm@9.1.0` is refused (EACCES);
  `npm install --prefix "$HOME/.local" pnpm@9.1.0` works, then export `$HOME/.local/node_modules/.bin`.
  Set the repository-local `user.name`/`user.email` from `git log -1 --format='%an|%ae'`, or every commit
  fails with "Author identity unknown".
- **A new Worker route is swallowed by the asset layer** unless it is in `run_worker_first` in
  `wrangler.toml`: the SPA fallback answers 200 with the TV shell and the Worker never sees it. `/a` needed
  both the exact and the `/*` form.
- `wrangler.toml` has no Prettier parser, so `prettier --write` on it exits 2. `pnpm format:check` is the
  real gate, and it passes.
- The `gh` device flow issues an **account-wide** token (`repo`, `read:org`, `gist`, `workflow`). Fine-grained
  PAT first for any hosted agent; the page and decision record both say so.
- A fixed client IP in `scripts/ci-worker.mjs`'s limiter burst makes a second run inside the minute fail on
  request zero, because the Durable Object's window persists in the local store. The client key is now unique
  per run. Do not "simplify" it back.
- Tests in `scripts/test/` drive CLIs with `spawnSync`; they never import a `.mjs` helper into the typed
  project — `tsc` refuses it (no declaration file). `scripts/lib/budget.mjs` is consumed only by its CLI.
- Two of my own edits broke Markdown tables: deleting a table row without its newline leaves a blank line
  that splits the table, and inserting a row by anchoring on the blank line after it lands mid-line. Prettier
  does not repair either. Edit tables with a script that rewrites whole lines.
- **An installed APK does pick up a client change, and the proof is three files.** `MainActivity` bundles
  nothing and loads `BuildConfig.ATV_BASE_URL` with DOM storage enabled; the client registers no service
  worker; Workers' asset default is `public, max-age=0, must-revalidate` with an ETag and `public/_headers`
  overrides no cache header, so `/` revalidates on every launch and names a fresh hashed `/assets/*.js`. What
  that does not give you is text entry: `main.ts` prevents default on Backspace, Enter, Escape and the arrows
  from one document-level listener, so a token `<input>` needs that handler suspended or it can neither be
  corrected nor submitted.
- `docs/continuity.md`'s secret inventory is checked against the repository, so adding `ATV_DEVICE_TOKEN`
  there before the code uses it fails `pnpm continuity`. It goes in with R6, not with the decision.
- **A gate that runs before the commit does not cover the commit.** `pnpm continuity`'s tracked-file rule reads
  `git ls-files`, so it passed while `.env.example` was untracked and failed the moment it was committed — the
  branch was red on a check I had just reported green. Run the tracked-file checks after `git add`, or on a
  clean tree; `git stash`-style reasoning is not enough because untracked files are invisible to it.
- **Two concurrency gaps were left alone on 2026-11-23, deliberately.** `PlayerManager.onTileHover`'s prefetch
  can land after `play()` and sit in the hidden buffer element that the next `ended` swap promotes, so a stale
  hover can become the stream; changing it is a decision about what prebuffering is for, not a static-analysis
  fix. And `kvJson`'s memo is keyed by the KV key alone, not by namespace: safe while the key names differ
  between `ATV_CONFIG` and `ATV_CACHE`, wrong the day one name is used in both.

## What I tried that failed

- `read_files` and shell calls are sometimes refused once with the project brief injected; retrying the same
  call works.
- There are no Cloudflare credentials in the shell and no browser for an OAuth callback, so `wrangler` cannot
  authenticate here. The connected Cloudflare integration is the only path and it is server-side: it reads the
  account, KV and scripts, and it exposes _Create Worker Version_ with `deploy: true`, which does accept
  bindings. It exposes no KV-namespace creation and no worker deletion — so a deploy is possible, provisioning
  is not.

## Outside this repository

- A separate project, `mcp-onboard` (a Cloudflare Worker with one KV binding), lives in its own private
  repository: `ajdhoward/mcp-onboard`. Its namespace `mcp-onboard-ONBOARD_KV` was created 2026-11-23 on
  `CF_API_TOKEN`; the id lives in that repository's `wrangler.toml`, not here, because this repository is
  public. `worker.js` is a **reconstruction**: the original died with `/tmp`, so it was rebuilt from the
  behaviour recorded there and labelled as such in its README. It runs under local workerd with
  `test/smoke.sh` at 42/42, and is still not deployed (the account answers 404 for `mcp-onboard`);
  `/authorize*` needs a Cloudflare Access application first. The provisioning workflow is gone.

## Next session, in order

1. Merge the branch (P3/Q2, the R1 record, this split), then with the operator: L1 deploy, L2 branch
   protection; re-run `pnpm smoke` against the deployed host, which now also checks `/a` and the asset.
2. Claim and build R5 (the client), then R6/R7, and hand R8 to the operator; L4 seeds real links only after it.
3. P1: the Drive proxy.
4. Keep this file and the roster row honest, or the next session starts blind.

- **The router guarded its API handlers and nothing else.** `/a`, `/install`, `/join`, `/onboard` and the
  asset fetch answered a bare platform 500 when they threw, with no request id, which is the one failure
  `wrangler tail` cannot help with. They now go through one `route()` call inside a single catch: add a new
  page route to that case switch, not beside it.
