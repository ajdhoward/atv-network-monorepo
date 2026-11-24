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
