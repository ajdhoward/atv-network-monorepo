# Changelog

What changed, newest first. This repository deploys a Worker rather than publishing a package, so a
"release" is the `atv-core-v2` deploy that would carry the entry below. Each change names the backlog
item it belongs to, because `docs/agents/backlog.md` holds the detail and the argument behind it.

## Unreleased — branch `freebuff/9b6340e13dd9c5125e906312`

Nothing here is merged or deployed.

### Added

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

- `package.json` declares `engines` — Node `>=22` and pnpm `>=9` — the toolchain the repository already
  assumes in `AGENTS.md` and in CI, so an install on the wrong Node or pnpm says so instead of assuming it —
  a warning, not a failure: there is no `engine-strict` in the repository, and blocking mismatches is the
  workflow half's job. The other half
  of R2, having the workflow take its wrangler version from the lockfile instead of carrying a second pin, is
  untouched: it edits a workflow, which is the operator's call.

### Fixed

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
