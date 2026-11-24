# Changelog

What changed, newest first. This repository deploys a Worker rather than publishing a package, so a
"release" is the `atv-core-v2` deploy that would carry the entry below. Each change names the backlog
item it belongs to, because `docs/agents/backlog.md` holds the detail and the argument behind it.

## Unreleased — branch `freebuff/9b6340e13dd9c5125e906312`

Nothing here is merged or deployed.

### Added

- `pnpm smoke` checks `/api/stream`. It was the one route with no post-deploy check, and the one that fails
  silently if the asset layer answers it instead: a shadowed route returns `200` with the TV shell, the player
  calls the channel broken, and every other smoke check still passes. The check needs no ticket and no Drive
  file — it asks for the route bare and expects the refusal `/api/health` implies: `403 missing` when a signing
  key exists, `503 stream_unconfigured` when it does not. Verified on a real local Worker in both states (19/19
  either way), which is also how the two branches were checked rather than assumed.
- `pnpm budget` counts the Drive proxy. `mediaRequestsPerTvPerDay` (default 300) is a fourth traffic class —
  one Worker request and one Drive subrequest each, no limiter token, because the signed ticket is the
  admission — so a deployment serving proxied video no longer reports the same 0.43% worst share as one that
  never played a channel. Household default is now 0.57% (KV reads).
- `pnpm budget -- --tvs 10` works. pnpm 9.1.0 passes the `--` separator into the script, which read it as a
  flag and exited, so the form the README and `docs/production-cutover.md` print had never run; a lone `--` is
  now skipped.
- `pnpm coverage` and `vitest.config.ts` (R3), so a review can carry a coverage number and name the files at
  zero instead of only a test count. It measures the four `src` trees and leaves `scripts/` out on purpose: its
  tests spawn the CLIs with `spawnSync`, v8 only sees the test process, and a report calling every script
  uncovered would be the lie the measure exists to catch. First baseline: 90.05% lines over 33 files, three at
  zero — the two DOM entry points and `packages/ui-shared`'s runtime half.
- A parity test for `checksum` and `CONFIG_SCHEMA_VERSION`, which exist twice on purpose (`config-meta.ts` for
  the Worker, `config-meta.mjs` for the seed script) and had nothing comparing them. A drift would not fail a
  build: it would warn on every `/api/guide` request against a deployment that looks seeded.
- `docs/r8-rollout.md` — the operator's runbook for R8, written rather than executed: L1 deploy, the client
  on every TV, then `ATV_DEVICE_TOKEN`, the token typed on each TV, and the evidence that headerless
  resolves are refused. Every step carries its own check and its back-out (roll back the deployment, delete
  the secret). It is ordered client-first on purpose: the token prompt only opens on a 401, so setting the
  secret before a TV carries the R5 build is what strands it.
- `/api/health` reports `streamSigningKeySet` beside `deviceTokenSet` (presence only, never the value). P1
  deploys darker than it looks — with no signing key every Drive channel quietly resolves to its stored link —
  and this is the one field a monitor can read to tell a live proxy from a deployed-but-dead one.
- `decisions.md` proposes a reading of whether proxying video through the Worker conflicts with Cloudflare's
  terms: §2.8 was retired in 2023, what replaced it (the CDN entry of the Service-Specific Terms) points at
  the Developer Platform's paid services, and this account is on Workers Paid with no egress charge and one
  subrequest per media request. The entry stays `proposed` with its outcome open, because that log's rule is
  that the operator marks the outcome, not the agent.
- The admin panel's health view shows `Drive proxy: LIVE/OFF/UNKNOWN` and
  `Household token: SET/NOT SET/UNKNOWN` side by side under the worker status; `UNKNOWN` is a deployment too
  old to report a flag, not an assumption the key or token is missing. The proxy's reason sits directly under
  that row rather than in the problems list, and an unset token is never a problem while R8 is pending, because
  the token has to reach every TV before enforcement lands. The channel counts alone cannot show a proxy
  deployed without `ATV_STREAM_SIGNING_KEY`, because every Drive channel still resolves — just to its stored
  link.
- The Drive proxy (P1), after the operator accepted its `decisions.md` entry: `/api/stream/<id>?exp&sig`
  verifies a signed ticket, re-reads the link for the id and streams the file with `Range` forwarded, so a
  Drive-backed channel can seek instead of resolving to an HTML page it cannot play. `/api/resolve` mints
  the ticket (HMAC-SHA256 over `<id>\n<exp>`, 15 minutes, bound to one id) under the new secret
  `ATV_STREAM_SIGNING_KEY` and leaves every non-Drive link exactly as it was — proxying a playlist without
  rewriting its segments would break it. With no secret, resolve keeps answering the stored link and the
  route says `503 stream_unconfigured` rather than calling a valid ticket a forgery. Everything that describes
  the bytes is passed through, `Content-Encoding` and `Content-Disposition` included: dropping either makes
  the response lie about a body the origin encoded, or hides the filename of a download. Two gaps that the route
  cannot close on its own: the secret is the operator's to set, and a file not shared link-wide still needs
  P2's service-account credential. Everything outside `driveFileId`/`mediaHeaders` is exercised against a
  stubbed origin, not against Drive.
- `apps/admin-cms/test/render.test.tsx` — the first test in the panel that renders JSX, because decoration no logic
  test could see was quietly load-bearing: a folder emoji, four breadcrumb slashes, three link-state
  icons and the pending dash are all hidden with `aria-hidden`, and a wrapper deleted by accident changes what
  a screen reader says without failing anything. The test renders in happy-dom, computes the announcement of an
  element by dropping everything marked hidden, and asserts both halves — the glyph is still on screen, and it
  is not in the name. It also pins the folder-row Tab rule (the step you are on is disabled) and takes its
  icon list from `LINK_ICON` rather than repeating it.
- The grid's first tests (`apps/tv-client/test/grid.test.ts`, 8): wrap-around focus, play-focused, an empty
  and a non-array lineup, notice, show/hide, and a click. It was the last client module with real behaviour
  and no coverage, which is how the click-vs-hover distinction went unrecorded until a test assumed wrong.
- `services/atv-core/src/stream-sign.ts` — the P1 ticket, before the route exists: `/api/resolve` will mint
  `/api/stream/<id>?exp&sig`, signed with HMAC-SHA256 over `<id>\n<exp>`, and the proxy will check for a
  configured secret, a valid signature, the id it was minted for and a 15-minute expiry. Each failure has its
  own answer (`unconfigured`, `missing`, `bad-signature`, `expired`) so a misconfigured Worker never reads as a
  forged link. Nothing calls it yet; the design is a `decisions.md` entry awaiting the operator.
- Every non-TV caller can carry the token (R7). The admin panel takes it once per browser and keeps it in
  `localStorage` (`linkToken.ts`), sends it only on resolve batches — the guide stays public — and reads a 401
  as "the worker needs the household token" instead of scoring every channel as broken. `pnpm smoke`,
  `pnpm streams` and `ci:worker` send `ATV_DEVICE_TOKEN` from the environment when it is set and name the
  token on a 401, because "HTTP 401" in a check with eight other lines in it reads as a broken deployment.
  `ci:worker` boots the local Worker with its own token and asserts both halves: 401 without it, 200 with it.
- `/api/resolve` enforces the household token (R6): a missing or wrong `Authorization: Bearer …` gets a 401
  `{error,code,requestId}` **before** the limiter or any provider call, so a stranger's id sweep spends none of
  the household's allowance and mints no TorBox links. Unauthorised attempts have their own counter,
  `Authorization` is in `Access-Control-Allow-Headers`, and `/api/health` reports `deviceTokenSet` (presence
  only, never the value). With no `ATV_DEVICE_TOKEN` set nothing changes, so this can ship before R8 sets it.
- `services/atv-core/src/device-token.ts` — the R6 check, before it is wired in: reads the credential out of an
  `Authorization` header (scheme case-insensitive, no value with spaces), compares SHA-256 digests byte by
  byte so the timing says nothing about a near miss, and answers `allow`, `reject` or `unenforced` when the
  deployment has no secret. It never returns the token. `/api/resolve` does not call it yet, so no request
  behaves differently than before.
- The TV client carries the household token. `resolve.ts` and the player's hover prefetch send
  `Authorization: Bearer …` when one is stored, read per call so a token entered from the prompt is used by
  the next attempt. A 401 opens `tokenPrompt.ts` instead of reading as an unavailable channel, and the prompt
  says whether the token is missing or was refused; while it is open it takes the keyboard from `main.ts`'s
  handler, so Backspace corrects the field and Back cancels, and saving it retries the channel that failed.
  The guide still renders without a token, because it never asked for one. (R5)
- `GET /a` — 302 to the release APK, so the download step on a TV is four characters in Downloader instead
  of a release URL typed with a remote. Worker-routed via `run_worker_first`, `no-store`, no KV read. The
  `/install` page now names that address next to the QR and the sideload steps. (P3)
- `pnpm smoke` sends a `HEAD` to the release asset `/a` points at, so a renamed or unpublished release
  fails a deploy instead of a household's install. A 4xx fails; a 5xx or an unreachable GitHub warns,
  because neither is this Worker's fault and a GitHub outage must not turn a good deploy red. (Q2)
- `apps/tv-client/src/token.ts` — the client's store for the household token: the storage key, the trim, a
  refused write reported instead of swallowed, and the `Authorization` header in one place so the prompt
  and both resolve call sites cannot disagree. The first file of R5; the guide still renders without it.

- `.env.example` — every environment variable the scripts read, plus the ones deliberately absent because
  they are `wrangler.toml` vars or Worker secrets, so a secret is not added to a file nothing loads.

### Changed

- The R8 runbook's token advice is now a value you can type on a remote: `openssl rand -hex 8` (16
  characters, 64 bits) instead of 64 characters, with the trade-off stated so the longer value stays a choice.
  It also spells out a trap nothing said before — a token containing a space can never be accepted, because
  `Bearer` carries one token (`\S+`), so the right value is rejected and every TV reports "that token was not
  accepted". `docs/continuity.md` and `.dev.vars.example` record the no-whitespace rule, and a test pins the
  behaviour: a secret with a space in it is a `reject` today.
- The R8 runbook now says what happens to deploys _after_ the token lands: `deploy.yml`'s sandbox smoke step
  runs without `ATV_DEVICE_TOKEN`, so the deploy succeeds and the job goes red one step later on a `401` it
  cannot authenticate. The runbook gives both ways forward (a repository secret passed to that step, or the
  local `pnpm deploy` route meanwhile) and points at Q9, because a workflow edit is not an agent's call.
- `docs/production-cutover.md` caught up with P1, R6 and `/a`. It had no `ATV_STREAM_SIGNING_KEY` anywhere, no
  `/api/stream` row in the parity table or the functional matrix, and it told the operator to copy a
  `wrangler.production.toml` that declares none of this build's bindings and omits `/a` from `run_worker_first`.
  A cutover followed literally would have put production live with every Drive channel resolving to an
  unplayable link and the short install address answering the TV shell instead of the APK. The parity section
  now names the trap — with the key set, resolve answers a ticket path instead of a Drive URL, so the client
  has to be the current one — and §5.1 says exactly which bindings and routes the candidate has to add.
- `docs/agents/reviews.md` records the commit the last review read, and `pnpm continuity` counts changes from
  it, warning at five. The trigger had been missed twice because it was a judgement about whether enough had
  happened; with the commit in the file it is arithmetic. It stays a warning: starting a review is the
  operator's call, and a failing check must not block a correctness fix.
- `docs/reviews/2026-11-24-p2.md` is this window's record (7 commits) — the continuity direction below, the
  budget model and the runbook correction, with the scorecard's first coverage number.
- R8's Step 2 is now "prove every TV is running this Worker's client" rather than "install it everywhere". The
  check it had — the guide renders — passes on a TV pointed at production, which is exactly the TV Step 3
  strands, and it also asks for a reinstall an already-installed app does not need. The step now says why a
  reinstall is unnecessary (nothing is bundled; assets revalidate), and proves the origin per TV: the
  unseeded sandbox answers an empty guide while production shows channels, and `wrangler tail` shows the TV's
  `/api/guide` arriving.
- L4's done-when is `pnpm streams --probe`, not a plain run. A 200 from `/api/resolve` says a link is stored,
  and P1 exists because a stored Drive link is not playable: with no `ATV_STREAM_SIGNING_KEY` the channel
  resolves to its share page, which the probe fails as HTML. The audit that decides whether L4 is finished had
  to be the one that follows the link.
- The R8 runbook's commands were exercised against a local `wrangler dev` with a plain `--var` test token (no
  deploy, no secret) and two needed fixing: Steps 3 and 5 now set `BASE` and Step 5 re-derives `ID`, so each
  block runs in a fresh shell, and `pnpm streams` is documented as exiting 1 without `atv-config.json`. The same
  read of the sandbox showed `/install` and `/a` answering `200` through the SPA fallback on a build from before
  R5/R6, which L1's state now records so a status code is not mistaken for a deploy.
- The token order is stated one way everywhere now. `AGENTS.md` and the R1 record in `decisions.md` said
  "enforcement must never land before every TV has taken the token", which the shipped prompt cannot do: it
  opens only on a 401, so a TV can take the token only after the secret exists. Both now say client first,
  secret second and point at `docs/r8-rollout.md`, which is the authority on the rollout; the R1 record keeps
  a `corrected` line so the original wording is not quietly rewritten.
- `package.json` declares `engines` — Node `>=22` and pnpm `>=9` — the toolchain the repository already
  assumes in `AGENTS.md` and in CI, so an install on the wrong Node or pnpm says so instead of assuming it —
  a warning, not a failure: there is no `engine-strict` in the repository, and blocking mismatches is the
  workflow half's job. The other half
  of R2, having the workflow take its wrangler version from the lockfile instead of carrying a second pin, is
  untouched: it edits a workflow, which is the operator's call.

### Fixed

- `pnpm continuity` checked the secret inventory in one direction only: every inventoried name still existed,
  and never that a secret the Worker reads is inventoried. A name added to `env.ts` and written down nowhere —
  the case that matters after the account is gone — left the check printing "the repository is
  self-sufficient". It now reads the `ATV_*` entries typed `string` from `env.ts` (bindings are infrastructure,
  with nothing to rebuild) and fails on one the inventory does not name. All four real secrets are recorded
  today, and adding a fifth makes it fail with the name.
- `pnpm streams --probe` follows the link P1's resolve answers for a Drive channel. The ticket is a path,
  `/api/stream/<id>?exp&sig`, because the TV resolves it against the page and only the minting host can verify
  the signature; Node's `fetch` has no page and threw on it, so the audit called every Drive channel an
  unreachable link on exactly the deployment where the proxy works. The probe resolves against the audited
  origin now, and its fixture carries a hostless ticket the way resolve really answers — the new test fails
  without the fix.
- The rest of the panel's decorations were read aloud too: the stream-link list said "white heavy check mark"
  or "cross mark" before every channel whose label already states the state (✅/❌/⚠️ are `aria-hidden`
  now), and a stat card said "em dash" where a count belongs — the dash is hidden and a clipped "not checked
  yet" says what it means. `apps/admin-cms/index.html` also gained `lang="en"`, which the panel never had, so
  a screen reader was free to guess the language of all of the above.
- The breadcrumb steps announced their separator along with the folder — "slash ATV Network", "slash News" —
  because the `/` was inside the button's text. It is an `aria-hidden` span now and each crumb's name is the
  folder alone. The slashes still show, and the Tab order is the one the tree pass checked: root crumb once
  inside a folder, then the steps up to but not including the level you are on.
- A Drive tree row announced itself as "file folder Idents" before the folder name, because an emoji in
  button text is part of its accessible name. The 📁 now sits in an `aria-hidden="true"` span, so a screen
  reader reads the folder name alone; the visible label and the click semantics are unchanged.
- The Drive folder rows are real `<button type="button">` elements, so the tree can be walked with Tab and
  opened with Enter instead of needing a mouse; `styles.ts` holds the shared reset as `folderButton`. The
  binding hint stays a sibling rather than nesting a button, and the click semantics are the breadcrumb's own
  `enter()`, so keyboard and mouse cannot drift apart. Verified in the browser: Tab reaches each folder and
  the root crumb once inside a folder, and Enter walks in, repeats as a no-op, and comes back out.
- The Drive folder tree went in and never came out: each row click appended to one path, so clicking Idents
  twice gave `/ATV Network/Idents/Idents` and the only way back was a reload. `apps/admin-cms/src/folders.ts`
  now decides what a click means — a folder already on the path is a step back to it, anything else descends —
  and the breadcrumb slices the path. The path line that repeated the root crumb is gone, and the token field
  wraps instead of pushing its button past the edge of a 420px screen.
- A route that threw was a bare platform 500 with no request id to search for: `/a`, `/install`, `/join`,
  `/onboard` and the asset fetch sat outside every handler guard. The whole dispatch now falls through one
  catch that logs the id and answers 503 JSON, and `apkUrl` raises a named error when `GITHUB_USERNAME` is
  missing or blank instead of a `TypeError` from inside a template string.
- Seeded input was trusted exactly as it came out of KV: a blank or repeated channel id counted twice and
  addressed nothing, a non-string genre rendered as `[object Object]` in the tile, and an ident of `https://`
  on its own redirected the TV to an address that cannot load. Each is validated at the boundary now.
- A stream that failed after the grid hid itself left a black screen with no explanation. The player reports
  the media error and the TV brings the guide back naming the channel, so Enter on it is an obvious retry.
- Two races that spent duplicate work: a cold isolate issued one KV read per channel in a grid sweep, and a
  hover prefetch plus the Enter that followed it minted two TorBox links for one file. Both now share one
  in-flight call, dropped when it settles so a failure is retried rather than remembered.
- A superseded tune could win the screen: Enter, arrow, Enter left the slower answer free to hide the grid and
  play the channel already left. Only the newest attempt paints a notice, hides the grid or plays.
- The admin panel reported the worker `UNREACHABLE`, listed problems and showed four zeros before its first
  answer arrived. It now says `CHECKING…` with unmeasured figures as a dash until a response settles.
- The TV grid painted an empty lineup with a blank status line while the guide loaded, and the paused banner
  named the first channel in the lineup rather than the one on screen.

- The admin panel trusted the guide, the one payload it does not control: a channel with no id became an
  `?ids=undefined` batch and a nameless row. It now narrows the payload the way the TV client does, reports
  how far the link walk has got, and navigates the folder tree with crumbs instead of appending to a string
  until nothing could return to the root.
- The TV client's colours lived per file — `#d3e429` in the grid, `#9a9a9a` and `#666` both meaning muted, two
  different blacks behind video. Unchanged in value, named once in `theme.ts`.

- `pnpm continuity` was red on this branch: the new `.env.example` matched the rule forbidding a tracked `.env`,
  so the guard reported a template as a leaked secret. Templates are allowed now and real files still are not,
  and `.dev.vars` — the file `wrangler dev` loads — is both ignored and guarded, because that is where a
  developer's TorBox token or stream map would have landed in a public repository.

### Removed

- `PlayerManager.detectProfile()` from `@atv/tv-client` — dead since the player started swapping `<video>`
  elements: nothing called it and no response carried its answer. Flagged by the 2026-11-24 review.
- `video.js` from `@atv/tv-client`: declared, never imported — the player is a plain `<video>` element that
  the manager swaps. Its 175 lines of lockfile and its Node-version peer range go with it.

### Decided

- Q10 is proposed: a household token that can never be presented should answer as the deployment's own error
  (503), not as a wrong token. Today the only recovery is retyping a value that could never work, which is
  the most expensive kind of wrong for someone standing in front of a TV.
- Q9 is proposed: once the household token is enforced, the Actions deploy's smoke step fails on a check it
  cannot make, which is the failure mode R7 removed for local callers. Named in the runbook and in the
  backlog so the red job is understood rather than debugged.
- Q8 is proposed: `wrangler.production.toml` is the repo's declaration of production's shape and no longer
  describes the Worker this branch builds. The cutover doc now says what to add by hand; the item is about the
  file telling the truth on its own.
- Q3 (alert when the Worker is down) has a recommendation instead of an open question: a free UptimeRobot
  **keyword** monitor on `/api/health` for `"status": "ok"`, because health answers `200` while reporting
  `degraded`. The keyword needs the space — the body is pretty-printed — or it would alert forever. Still
  `proposed`, because a new service is the operator's call; nothing has been signed up for.
- Two proposals are open for the operator beside the Drive proxy they belong to: a keyless Drive resolve should
  answer `503 stream_unconfigured` rather than a share page it cannot play (which makes the batch shape a
  fourth list), and a ticket that lives 15 minutes can be outlived by a paused TV, so either the TTL or the
  client's recovery has to change. Both are `proposed` in `decisions.md`, with P4 and P5 in the backlog.
- `/api/resolve` stays private with **one household token** (option C). Cloudflare Access is kept for the
  control planes only: a WebView page load cannot carry an Access header, a token compiled into the bundle
  is published to anyone who opens the JS, and Access in front of the player risks objective 1 to protect
  objective 3. Accepted by the operator, 2026-11-23.
- Enforcement is ordered, not immediate: client and prompt, then the token on each TV, then watch resolves
  that arrive without the header, then enforce. Delivery is verified — the shell loads the served client and
  the asset layer revalidates it, so an already-installed APK needs no re-sideload. Entry on a D-pad is the
  open risk, which is exactly why the prompt ships first.
- The work is split into R5 (client), R6 (enforce in the Worker), R7 (admin, smoke, streams and `ci:worker`
  carry the header) and R8 (the secret and the rollout, the operator's, which unblocks L4).

### Not in this branch

- R5 is one file: neither resolve call site sends the header yet, a 401 is not mapped to "this TV needs its
  token", and there is no prompt. R6 is not written, so `/api/resolve` still answers any caller.
- Nothing is deployed and `main` is untouched. L1 (deploy the sandbox), L2 (branch protection), L3 (signing
  secrets) and the secrets themselves stay the operator's, and P1 (the Drive proxy) is still unbuilt.
