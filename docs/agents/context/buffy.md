# Buffy — context

Working memory for the next session. Canonical state is in the logs; this is what they do not hold.

- **Agent:** Buffy, Freebuff (Codebuff), cloud chat `9b6340e1`
- **Roles:** Integrator, Cartographer, Scribe, Sentinel (sole active agent, so Author/Reviewer/Verifier are
  declared self-review in each change)
- **Paths owned:** `services/atv-core/`, `scripts/`, `docs/`, `README.md`, `AGENTS.md`
- **Last session:** 2026-11-24

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

**The folder tree is keyboard-navigable.** Rows are `<button type="button">` styled by `folderButton` in
`styles.ts`; the "Bind to …" hint is a sibling so no button nests, and the click semantics stayed `enter()`,
so keyboard and mouse share one rule. Checked with real Tab presses in the browser: the order is token →
Check stream links → the four folders, Enter descends, a second Enter is a no-op, and the root crumb becomes
tabbable once inside a folder and takes you back. The row emoji is inside an `aria-hidden` span, because an
emoji in button text is part of the accessible name (a row used to announce "file folder Idents"); the
button's text content still reads `📁 Idents`, so mouse and keyboard behaviour did not move. The breadcrumb uses
the same idiom for its `/` for the same reason: a separator in button text is spoken, so a crumb announced
"slash News". Both keep the visible text and the Tab order and hide only the decoration from the name. The
rest of the panel was audited the same way: the stream-link list's ✅/❌/⚠️ are `aria-hidden` because
`LINK_LABEL` already says the state in words, the stat cards' `—` is hidden behind a clipped "not checked
yet", and `apps/admin-cms/index.html` finally has `lang="en"`. Still asserting nothing about how an actual
screen reader voices any of it — there is none in this VM.

**The grid now has tests** (`apps/tv-client/test/grid.test.ts`, 8), including the click path — which taught me the
one thing a test can: a tile click focuses and plays but does not re-fire `onFocus`, because the hover prefetch
belongs to `mouseenter`. `PlayerManager.detectProfile()` is gone; the review had flagged it as dead.

**P1 has a design and its first file.** `decisions.md` (2026-11-24) proposes `/api/stream/<id>?exp&sig`: the
resolve call (already token-protected) mints a one-hour HMAC ticket, because a `<video src>` cannot send a
header; the proxy verifies the ticket then passes `Range` through to Drive. `stream-sign.ts` implements the
ticket and its tests cover id binding, expiry, forgery and a missing secret. The route and the `/api/resolve`
change wait for the operator to accept the entry — that is a shared shape, so it does not land on my say-so.

**Next: R8, which is the operator's** — deploy the R5 client (L1), get it onto every TV, then set
`ATV_DEVICE_TOKEN` on `atv-core-v2`, then take the token on each TV from the 401 prompt and confirm headerless
resolves have stopped. Client first, secret second: the prompt only opens on a 401, so a TV cannot take the
token before the secret exists, and enforcement is live the moment it does (there is no second switch: the
secret _is_ the switch). Then L2 (branch protection), L4 (seed real links).
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
- **Node's `fetch` throws on a relative URL** (`Failed to parse URL`), and P1 made a relative URL the normal
  answer from resolve. Any script that follows a resolved link has to resolve it against the audited origin
  first; a fixture with an absolute `http://127.0.0.1:<port>/…` link hides the bug completely. `--probe` is
  also the only audit that sees a keyless Drive channel: it follows the stored share page and fails it as HTML,
  where a plain run prints PASS for a channel that cannot play.
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

- **`scripts/test/` can still reach a `.mjs` helper — as a child process, not an import.** `tsc` refuses the
  import (no declaration file), but `spawnSync(process.execPath, ["--input-type=module", "--eval", script])`
  with the module URL produced by `pathToFileURL` runs the real helper, so a parity test compares the shipped
  functions instead of a copy of them.

**The panel has a render test now** (`apps/admin-cms/test/render.test.tsx`, 4 tests). happy-dom plus
`createRoot` and `React.act` (React is 18.3.1, so `act` is on the `react` export), with `fetch` stubbed per
test; `spoken()` clones an element, drops every `[aria-hidden="true"]` descendant and returns the text, which
is the assertion that keeps the decorations out of the announcement while their glyphs stay on screen. Two
traps: `no-misleading-character-class` rejects a character class holding `⚠️` (emoji plus variation
selector), so the icon list comes from `LINK_ICON`; and react/react-dom live in `apps/admin-cms/node_modules`,
not at the root, so version checks have to `cd` there first. `package.json` also got the `engines` half of R2
(Node `>=22`, pnpm `>=9`); the workflow half is still the operator's. Note it is a warning, not a gate: no
`.npmrc` sets `engine-strict`, so pnpm only prints the mismatch. Enforcement belongs with the workflow change.
The mutation check is worth repeating on any aria-hidden work: replacing every `aria-hidden="true"` in
`App.tsx` failed all four tests, which is what shows the test has teeth rather than just green.

**P1 is built** after the operator accepted the 2026-11-24 entry. `stream.ts` holds `driveFileId` (the three
share-URL shapes, refusing anything shorter than a 10-character id), `driveMediaUrl` (Drive's
`usercontent/download` origin — the one that honours `Range` without a credential), `proxyTicket` (Drive link →
signed path, but only when `ATV_STREAM_SIGNING_KEY` is set, otherwise the stored link, so nothing regresses
before the operator acts) and `mediaHeaders`. The route is in `index.ts` because that is where the failure
shape and the counters live; `resolver.ts` grew `mappedLink` so a media request never spends a TorBox
resolve, and `resolveStream` ends in `proxyTicket`. Tests: 9 route tests (mid-file 206 with `Content-Range`
asserted, whole-file 200, synthesised `Accept-Ranges`, 416, expired/forged/ticketless 403s that never reach
Drive, 503 unconfigured, 404 for unknown and non-Drive ids, the resolve→stream round trip, and a 502 whose
log carries no id and no link) plus 8 unit tests. Unverified against Drive itself: no file, no credential, and
P2 is still blocked. Health now reports `streamSigningKeySet` beside `deviceTokenSet`, because P1 without the key
is a deployment that looks fine and serves every Drive channel its old link. The Cloudflare terms question is
**proposed** in `decisions.md` (2026-11-24), not settled: §2.8 was retired in 2023, its replacement names the
Developer Platform's paid services, and Workers Paid — no egress charge, one subrequest per media request, body
streamed not buffered — is where this account sits; the reading and its two caveats (stay paid, stay
household-scale) are written down there rather than carried in someone's head. The entry stays `state: proposed`
with its outcome open, because that log's own rule is that the operator marks the outcome, not the agent. The passthrough list is deliberately longer than the four headers a 206 needs
(`Content-Encoding` and `Content-Disposition` included): a proxy that drops what describes the bytes is
lying about them, and the route test pins both. `pnpm ci:worker` was run to confirm the built Worker still boots with the new route.

**The R8 runbook is written, not executed** (`docs/r8-rollout.md`). Order: L1 deploy → client on every TV →
set `ATV_DEVICE_TOKEN` → type it into each TV's prompt → confirm headerless resolves are 401 and
`resolve_unauthorized` is not still climbing. It is client-first because the prompt only opens on a 401, so
the secret before the R5 build is what strands a TV; each step has a check and a back-out (roll back the
deployment, delete the secret). Nothing in it has been run, and no secret was touched while writing it.

**The runbook's commands were exercised, not run against the sandbox** (2026-11-24). A local `wrangler dev` with
a plain `--var ATV_DEVICE_TOKEN:` test value — no deploy, no secret — behaved exactly as written: the health
snapshot and parse, the status checks, the guide-id derivation, the headerless `401` with
`WWW-Authenticate: Bearer realm="atv"`, the with-token `200`, all three Step 5 curls, and `smoke` 18/18 with
the token and 17/18 without, naming the token. Two fixes came out of it: Steps 3 and 5 now set `BASE` (and
Step 5 re-derives `ID`) instead of leaning on an earlier shell, and `pnpm streams` is documented as exiting 1
without `atv-config.json`. Unrun: `wrangler secret put`/`delete` and `wrangler tail` (credentials), and
anything on a TV. The same session found the live sandbox is pre-R5/R6 and that `/install` and `/a` answer
`200` through the SPA fallback — L1's state says so, so nobody reads a status code as a deploy.

**The P1 layer got its own review** (`docs/reviews/2026-11-24-p1.md`, `23bfffd..HEAD`, 23 commits), because the
five-change trigger fired again inside the same day. It found one real defect: `pnpm streams --probe` could not
follow the link P1's resolve answers for a Drive channel. The ticket is a path (`/api/stream/<id>?exp&sig`),
which the TV resolves against its page, and Node's `fetch` throws on a path — so the audit called every Drive
channel unreachable on exactly the deployment where the proxy works, while its own suite stayed green on an
absolute fixture link. Fixed in `39f5a7a` with a test that fails without it; the fixture now carries a hostless
ticket. Two proposals came out of the same pass and are waiting on the operator: **P5** (a keyless Drive
resolve should answer `503 stream_unconfigured` instead of a share page, which makes the batch shape a fourth
list) and **P4** (a one-hour ticket now covers a pause; the client's recovery is unchanged and L5 still owes
has to change). L4's done-when now says `--probe`, because a plain run only proves a link is stored.

**R3 is done, and coverage paid for itself on its first run.** `vitest.config.ts` plus `pnpm coverage`
(`@vitest/coverage-v8` 3.2.7, MIT, the same range as the pinned `vitest`) measure the four `src` trees.
`scripts/` is out on purpose: its tests spawn the CLIs with `spawnSync`, v8 only sees the test process, and a
report calling every script 0% would be a lie. Baseline at `5ce7b7e`: **90.05% lines over 33 files**, three at
zero — `apps/admin-cms/src/main.tsx` and `apps/tv-client/src/main.ts` (DOM entry points, expected) and
`packages/ui-shared/src/index.ts`, which is the finding: every importer writes `import type`, so the package's
only runtime exports (`CONFIG_SCHEMA_VERSION`, `validateConfig`) execute nowhere. That is **Q6**, proposed, not
deleted, because the shared package is a contract. Lowest covered file with real logic is `playerManager.js`
at 73.5% lines / 55.6% functions, which matches the untested hardware path rather than a gap the suite could
close here.

The same pass found an untested duplication: `checksum` and `CONFIG_SCHEMA_VERSION` exist twice on purpose
(Worker `.ts`, seed `.mjs`) and nothing compared them, so a drift would have warned on every `/api/guide`
request against a deployment that looks seeded. `scripts/test/config-meta.test.ts` asks the `.mjs` copy in a
child process (`--input-type=module --eval`) and compares version and checksums over six samples including
unicode. No threshold was set on coverage: `pnpm coverage` is a review instrument, not a gate, and a floor
nothing enforces is decoration.

**`pnpm budget` was lying about the proxy (Q7).** The model counted guide loads, resolves and health checks and
nothing for `/api/stream`, so a deployment serving proxied video printed the same 0.43% worst share as one that
never played — after P1 that number is the one thing the $5 constraint rests on. Media requests are now a fourth
class (`mediaRequestsPerTvPerDay`, default 300: a four-hour viewing day at about a request a minute plus seeks),
each one a Worker request and a KV read with no limiter token, because the signed ticket is the admission and the
bytes are Drive's egress, not this account's. Household default is now 0.57% (KV reads). While testing it I found
that the documented `pnpm budget -- --tvs 10` had never run on this pnpm: 9.1.0 hands the `--` to the script,
which read it as a flag and exited with "Unknown flag --". The CLI now skips a lone separator and a test runs the
very argv pnpm produces. `pnpm dev -- --dry-run` was checked the same way and already tolerated it.

**P4's pending decision got a code read instead of a guess.** A pause starts no request — the element keeps the
stream it holds — so the expired ticket only bites at the next range request (a seek, or a resume after the TV
dropped its buffer), and nothing re-resolves automatically: the grid comes back with a notice and the viewer
presses Enter, which mints a fresh ticket and starts at 0. So option (b) is three changes (remember channel and
`currentTime`, re-resolve once, restore on `loadedmetadata`, with a second failure still showing the notice)
while option (a) is cheaper than it looked. Both are recorded in `decisions.md` under the entry; neither is built.

**R8's Step 2 was checking the wrong thing.** It asked for a reinstall on every TV and accepted "the guide
renders" as proof. But the app bundles nothing — it loads `BuildConfig.ATV_BASE_URL` on every launch and the
Worker's assets revalidate — so an installed app needs no reinstall, while a TV whose APK was built against
`atv.acidwurx.org` renders a perfect production guide and never gets the R5 prompt: the exact TV Step 3
strands, passing the check. Step 2 now proves the origin per TV — while the sandbox is unseeded an empty guide
is the signature of the right Worker, and once it is seeded `wrangler tail atv-core-v2` shows that TV's
`/api/guide` arriving — and the troubleshooting row that blamed a "pre-R5 client" now says "another Worker",
because with live assets that is the only way a TV can miss this build.

**Q3 has a recommendation instead of an open question.** The service index's recommendation engine returned
nothing for uptime monitoring, but its catalog lists real options (UptimeRobot, Better Stack, Checkly, Cronitor,
StatusCake). UptimeRobot's free plan fits the household exactly: $0, no card, 50 monitors, a 5-minute interval,
keyword monitors included on Free, email plus app-push alerts. The keyword must be `"status": "ok"` **with the
space**: `json()` serialises with `JSON.stringify(data, null, 2)`, so health is pretty-printed, and a monitor
searching for `"status":"ok"` would match nothing and alert forever — a false alarm is worse than no monitor.
Health stays public after R8 (the token guards `/api/resolve` only), so no credential goes to the monitor. It
stays `proposed` because a new service is the operator's yes, and nothing has been signed up for.

**The third review of 2026-11-24 (`docs/reviews/2026-11-24-p2.md`) found the checks' blind side.**
`pnpm continuity` verified that every inventoried secret still exists in the repository and never that a secret
the Worker reads is inventoried — so `env.ts` could gain a name that nothing records and the check would still
print "the repository is self-sufficient", which is the exact failure `docs/continuity.md` exists to prevent.
It now reads the `ATV_*` entries typed `string` in `env.ts` and fails on an unrecorded one; bindings are
excluded because nothing about a KV namespace needs rebuilding. The mutation check was adding
`ATV_TMP_SECRET?: string;` and watching it fail by name. Scorecard: 295 tests/32 files, coverage 90.05%, and
`ci:worker` 30/30.

The pattern across three findings is worth keeping: the probe (a URL shape it could not follow), the budget (a
traffic class it never counted) and the inventory (a direction it never read) all asked _"is what I know still
true?"_ and none asked _"what am I not looking at?"_. Before trusting the next check, ask the second question.

The review trigger is no longer a memory. `docs/agents/reviews.md` carries `Last review: <sha>` and
`pnpm continuity` counts from it, warning at five and never failing — a due review is information, and starting
one is the operator's call. This window reached seven changes before anyone counted, twice now.

**The production cutover runbook had not caught up with three releases of this branch.** It is the only
authority for replacing the live network, and it did not contain `ATV_STREAM_SIGNING_KEY` at all, had no
`/api/stream` row in the parity gate or the functional matrix, and its §5.1 said to copy
`wrangler.production.toml` — which declares neither `ATV_RATE_LIMITER`, nor the `ATV_LIMITER` Durable Object
with its migration, nor `ATV_METRICS`, and whose `run_worker_first` omits `/a` and `/a/*`. Followed literally,
a cutover puts production live with every Drive channel resolving to a link a `<video>` cannot play, no
per-client limiter, and the short install address answering the TV shell. All of that is now written into the
doc: the secrets and the decision each forces, the parity row that explains resolve's Drive answer changing
with the key, four proxy checks in §6.1, the proxy's request class in §6.4/§11, a risk-register row, and the
exact bindings and routes the candidate config must add. `Q8` proposes fixing the config file itself rather
than every cutover remembering — deploy config is the operator's call, so it is proposed, not edited.

The lesson is the same shape as this morning's runbook fix: a `blocked` document rots exactly like a `blocked`
step, and nothing checks it. `pnpm smoke` would have caught `/a` on the candidate and §6.2 the limiter, so the
failures were loud but late — on the day of the cutover, with the household waiting.

**R8 leaves one loose end in CI, now written down as Q9.** `deploy.yml`'s sandbox smoke step runs `pnpm smoke`
with no `ATV_DEVICE_TOKEN` — correct before R8, wrong after it: smoke's resolve check gets a `401`, names the
token and exits 1, so the deploy succeeds and the job goes red one step later. It is the same "red check that
means you forgot a token" failure R7 removed for local callers, now on the CI path that L4 and every later
client change will use. The runbook's Step 3 carries both ways forward (repository secret passed to the step,
which keeps the check strict and duplicates the value into GitHub; or the local `pnpm deploy` route until
Q9 is decided). The workflow itself matches what the runbook says about Step 1: manual dispatch, target `v2`,
`kv:staging`, an optional seed, and smoke with `--allow-empty` — all verified by reading it, not by running it.

**`pnpm smoke` now proves the proxy route, which nothing checked before.** `/api/stream` had no post-deploy
check, and it is the route that fails silently when something shadows it: the asset layer answers 200 with the
TV shell, the player calls the channel broken, and every other smoke check still passes — the same shape `/a`
hit when it was added. The check needs no ticket and no Drive file: it asks for the route bare and expects the
refusal `/api/health` already implies — `403 missing` with a signing key, `503 stream_unconfigured` without.
Both branches were verified against a real `wrangler dev` (`19/19` either way, no listener left behind), and
`wrangler` has to be run as `pnpm exec wrangler` here because it is not on the shell PATH. That is the second
check in this project fixed by asking what it does _not_ look at.

**Continuity has now been caught looking only at what it knew three times**, so assume a fourth blind spot
exists rather than that the check is finished: it verified documents are indexed, then that inventoried secrets
still exist, then that every secret the Worker reads is inventoried, and at review `2026-11-24-p3` that every
`package.json` script is named in a document (its first run found `build:client` and `build:admin`), and then
that no document names a command the repository lacks — both directions of the command contract. The rules
read Markdown only, in `pnpm <name>`/`pnpm run <name>` form, and the reverse direction reads code spans and
fences rather than prose ("with pnpm 9" is not a command), so a script documented in a code comment does not
count — document it in `README.md`. When adding any new machinery, ask what reads it back; if nothing does,
that is the next blind spot.

**The token contract had a trap that only shows up on hardware.** `normaliseToken` trims and changes nothing
else — correctly, it is a secret — but `bearerToken` takes one token (`(\S+)`), so a secret containing a space
can never be presented: the right value is rejected and the prompt can only say "that token was not accepted",
which blames the household. The runbook now recommends `openssl rand -hex 8` (16 characters, 64 bits, typable
on a remote) and names the whitespace rule, `docs/continuity.md` and `.dev.vars.example` record it, and a test
pins the current answer (`reject`). Q10 proposes the Worker give it its own error instead. What is _not_
verified: how a Fire TV's on-screen keyboard delivers 16 characters, which is L5's ground — the shorter value
is the mitigation, not a proof.

**The panel shows both flags.** `summariseHealth` maps `streamSigningKeySet` to
`driveProxy: "live" | "off" | "unknown"` and `deviceTokenSet` to `householdToken: "set" | "unset" | "unknown"`;
an absent flag is `unknown`, never `off`/`unset`, so an older deployment is not blamed for a key or token it
cannot report. The health view prints `Drive proxy: LIVE/OFF/UNKNOWN` and `Household token: SET/NOT SET/UNKNOWN`
side by side under the worker status. The proxy's explanation is a note under that row (`driveProxyNote`), not
a problems entry, so it sits beside the state it explains; and `NOT SET` is deliberately never a problem,
because R8's order makes an unset token correct until enforcement lands — an amber warning there would train
the operator to ignore the page. Covered by three logic cases per flag in `health.test.ts` and two
`render.test.tsx` assertions: the proxy line with its note, and the token line with no problems entry.

- The GitHub integration's write proxy refuses some file bodies with a 403 its message does not explain: a
  page whose markup held a shell line of the form `curl -sS -X POST ${…}` was refused, while a 3-byte file
  and the same rendered output built by JavaScript concatenation (`"curl -sS -X POST " + escapeHtml(origin)`)
  were accepted. Message text, HTML escaping and file size were all ruled out by probe files. Build such a
  string by concatenation instead of re-probing payloads.

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

1. The operator's, in one sitting, from `docs/r8-rollout.md`: L1 deploy, the R5 client on every TV, then
   `ATV_DEVICE_TOKEN`, the token typed on each TV, then confirm headerless resolves are 401. `--var` in a local
   `wrangler dev` is how a token was tested here; no secret has ever been set. L2 (branch protection) and L3
   (signing secrets) belong in the same conversation, L3 before R8's Step 2 if a new APK is needed.
2. After R8, the panel's `Household token: NOT SET` flips from neutral grey to a problem — designed, not built.
3. P4 and P5 are done (`6edfab4`, `2c06b68`). P2 (`ATV_STREAM_SIGNING_KEY` plus a Drive read) is what makes P1
   real on the sandbox; the fifth review ([`reviews/2026-11-24-p4.md`](../../reviews/2026-11-24-p4.md)) records
   the rest.
4. L5 is the only ground truth for playback, the prompt's on-screen keyboard and P4's expired-range behaviour.
5. Keep this file and the roster row honest, or the next session starts blind.

- **The router guarded its API handlers and nothing else.** `/a`, `/install`, `/join`, `/onboard` and the
  asset fetch answered a bare platform 500 when they threw, with no request id, which is the one failure
  `wrangler tail` cannot help with. They now go through one `route()` call inside a single catch: add a new
  page route to that case switch, not beside it.

## Session 2026-11-24 (the decision batch)

The operator took seven proposed items and asked for them in my recommended order: P4, Q10, P5, Q6, Q8, Q9, Q3.
All seven are `state: accepted` in `decisions.md`; six landed as behaviour or declarations, and Q3 is a document
because the monitor lives in the operator's account. What is left is theirs, not mine: the R8 sitting (secret,
client on every TV, enforcement), the repository `ATV_DEVICE_TOKEN`-style secret for CI smoke (same value as the
Worker's), the UptimeRobot monitor, then L4 and P2.

Lessons worth keeping:

- **A constant change has coupled tests, and the suite finds them.** `DEFAULT_TTL_S` 900 → 3600 broke a route
  test that hardcoded "20 minutes ago" as stale. Deriving staleness from the constant is the fix, not a longer
  offset — and it is the kind of test coupling that only a full run reveals.
- **`git commit -- <path>` requires tracked paths.** A brand-new file needs `git add` first; a chained commit
  command stops at the first pathspec it cannot resolve, which is how the seventh commit was left behind for a
  moment this session.
- **A keyword monitor's keyword is a contract with the serialiser.** `"ok"` with quotes survives both pretty and
  compact bodies; `"status": "ok"` did not, and that spacing was never a promise.
- **Whitespace is not a token.** `Bearer` carries `\S+`, so a secret with a space can never be presented; that is
  now a 503 (`device_token_invalid`) rather than a 401 that blames the household.

## Session 2026-11-24 (the 503 that was two secrets)

`pnpm streams` labelled every 503 "this deployment has no ATV_STREAM_SIGNING_KEY". Since Q10 that status is also
`device_token_invalid` — an `ATV_DEVICE_TOKEN` with whitespace — so the audit's fix pointed at a signing key while
the secret that blocks every request stayed unnamed. It now reads the body's `code`; only `stream_unconfigured` is
the signing-key diagnosis, `device_token_invalid` stops the audit after one request (one deployment-wide fault, not
one per channel), and any other 503 reports its code. `pnpm smoke` gets the same treatment on `/api/resolve` and
names the token rather than the key when a 503 carries that code.

- **A status is not a diagnosis.** Two 503s with two different fixes; the body's `code` is the only thing that
  distinguishes them, and `health.deviceTokenSet` cannot see an unpresentable value.
- Both README's API table and the §6.1 parity matrix now list the batch `unconfigured` list and both 503 codes, so
  an operator reading either learns that a 503 can mean the household token.

## Session 2026-11-24 (the verification the fixtures could not make)

Ran the 503 diagnosis against real Workers in workerd, not a fixture. `wrangler dev --local` with
`--var 'ATV_DEVICE_TOKEN:correct horse battery'` answers `503 device_token_invalid` to every request: `pnpm
smoke` fails exactly one of 19 checks (`GET /api/resolve`, naming the token) while its `/api/stream`
`stream_unconfigured` check still passes on the same Worker, and `pnpm streams` stops after one request naming
the token. A control Worker with a presentable token, a real-shaped Drive id in `ATV_GDRIVE_MAP` and no signing
key answers `503 stream_unconfigured (this deployment has no ATV_STREAM_SIGNING_KEY)`, smoke 19/19 — so the fix
did not turn every 503 into a token. Neither script has ever been run against a deployment whose token is
unenforced; that is still R8's sitting.

- **`/api/health`'s `deviceTokenSet` is presence, not presentability.** It reads `true` on the Worker that
  refuses every request; only the 503's `code` tells the two faults apart.
- **`driveFileId` wants a realistic id** (`[A-Za-z0-9_-]{10,}`). A toy id like `abc` is not a Drive link, so it
  resolves untouched and the first control run misled itself: it "passed" with no signing key at all.
- **One `wrangler dev` per port, and its child outlives the parent.** 8791 was already taken in this VM by
  another chat; killing the `pnpm` parent leaves `workerd` listening, so kill the PID that holds the port.
- **`node_modules/.bin` can be empty after a workspace restore while `pnpm exec` still resolves from the
  store**, and `npx wrangler` then fetches a different version (4.168.0 here against the pinned 4.166.0).
  `pnpm install --frozen-lockfile` rebuilds the links in seconds.
- **`pnpm ci:worker` outlives the five-minute command cap** (300 limiter requests in workerd); start it detached
  with a log and poll it. Finished 31/31 — its own smoke 19/19 plus 12 route, cron and limiter checks.

## Session 2026-11-24 (rotation, and the prompt seen working)

Wrote [`docs/rotating-secrets.md`](../../rotating-secrets.md) (Q12): what replacing `ATV_DEVICE_TOKEN` and
`ATV_STREAM_SIGNING_KEY` costs, the order, the checks and the back-out for each. Rotation order is secret first,
then TVs — the reverse of R8's first-time rule, because the prompt-bearing client is already everywhere and
only the `401` opens the dialog. One shared token has no per-device identity, so "revoke one TV" does not exist;
the signing key rotates with no device work but restarts a paused film.

Then observed the prompt path instead of trusting happy-dom, with `wrangler dev --local` enforcing
`--var ATV_DEVICE_TOKEN:house-token-1234` and the cloud browser on the chat's preview origin:

- guide renders with no prompt (public), channel press → `401` → dialog _This TV has no household token yet._;
- a wrong value → dialog returns as _That token was not accepted._ (not "channel unavailable");
- the right value → resolve `200`, dialog closes, the channel retries; the fixture host fails so the notice is
  _CI One would not play — press Enter to try again_;
- reload → plays without asking (stored token used, `200`, no `401`);
- Escape cancels and leaves the notice; pressing the channel again reopens the dialog.

- **The cloud browser cannot reach `127.0.0.1`.** It runs outside the dev-server namespace
  (`ERR_CONNECTION_REFUSED`), and `cloud_show_dev_server` only accepts this chat's port 3000. Run the Worker with
  `--ip 0.0.0.0 --port 3000`, call `cloud_show_dev_server`, then open the returned `*.style.dev` hostname in the
  browser. A cured 401 loop is normal: one click produced several identical `resolve` 401s (hover prefetch plus
  the retry), which is noise in the log, not a fault.
- **Still unverified:** the Fire TV on-screen keyboard and Back key (L5), `wrangler secret put`/`delete`, and
  every step against the sandbox — the runbook says so in its own words.

## Session 2026-11-24 (what was checked, said out loud; drift as a command)

`docs/rotating-secrets.md` stated its steps without saying which of them had been run, so a reader could not
tell the browser-observed prompt path from the parts that need a credential or a TV. It now opens with a short
"What was checked, and how": exercised against a local Worker in the cloud browser, nothing against the sandbox,
and the rest named as needing a credential, a TV or the deployment.

New: `pnpm drift` (`scripts/check-drift.mjs`, `scripts/test/drift.test.ts`, Q13), a read-only check that an
origin serves this checkout's build. It compares the `/` and `/admin/` entry assets (content-hashed names) with
`apps/tv-client/dist`, fetches the asset each page names so a reference to nothing is caught, and checks health
for the fields this build adds (`deviceTokenSet`, `streamSigningKeySet`, `config.schemaMatches`/`checksumMatches`,
`resolve`, `guideSnapshot`) plus `schemaVersion`. Measured against the sandbox: 2/5 — client `index-ZN5Kcyr4`
against `index-D8Do0dvy`, admin `index-7V4mIGVB` against `index-BqxNKxS8`, and a pre-R6 health body.

- **The test has to `execFile`, not `spawnSync`.** The stub origin lives in the test process, and a synchronous
  spawn blocks its event loop, so the child's requests would never be answered. `check-streams.test.ts` already
  does it this way for the same reason.
- **The blind spot is real and written down in three places:** a Worker-only change leaves both asset hashes
  identical, so the check passes. Closing it needs a build id in `/api/health` — a public shape, so a
  `decisions.md` entry before any code.

## Session 2026-11-24 (drift in the deploy job, and the build id proposed)

The deploy job now ends with `pnpm drift` against the URL it just deployed, so "the deploy did not take
effect" is a red job. Two details worth keeping: the step is one step for both targets (v2 takes
`steps.deploy.outputs.deployment-url`, production takes `https://atv.acidwurx.org` and exits early without
`CF_ACCESS_*`, because a secret cannot appear in an `if:`); and it retries 3 × 10s, because an edge can serve
the previous version for a few seconds after a deploy and a spurious red teaches people to ignore red. The loop
is `if pnpm drift ...; then exit 0; fi` rather than `pnpm drift ... && exit 0`, which under the runner's
`bash -e` is the form whose behaviour nobody has to reason about.

The build id is proposed, not built: `decisions.md` 2026-11-24 proposes `build.id` on `/api/health`, supplied
at deploy time as `ATV_BUILD_ID` (a Worker cannot read its own deployment id), compared by `pnpm drift` with
the checkout's `HEAD`. If accepted it needs `ATV_BUILD_ID` in `docs/continuity.md`'s inventory or
`pnpm continuity` fails.

- **Not exercised:** the new workflow step has not run — no `CF_API_TOKEN`, so no deploy and no `workflow_dispatch`.
  `pnpm drift` itself is unchanged; only its header comment moved.
