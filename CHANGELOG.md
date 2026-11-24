# Changelog

What changed, newest first. This repository deploys a Worker rather than publishing a package, so a
"release" is the `atv-core-v2` deploy that would carry the entry below. Each change names the backlog
item it belongs to, because `docs/agents/backlog.md` holds the detail and the argument behind it.

## Unreleased — branch `freebuff/9b6340e13dd9c5125e906312`

Nothing here is merged or deployed.

### Added

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

### Fixed

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

### Removed

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
