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

**R5 is claimed** (my roster row now holds `apps/tv-client/`), the first code step of option C. Landed so
far: `apps/tv-client/src/token.ts`, the `localStorage` store the prompt and both resolve call sites will
share — key, trim, refused-write case and the `Authorization` header in one place. Next inside R5: send it
from `resolve.ts` and `playerManager.js`, map 401 to "this TV needs its token", then the D-pad prompt (the
`main.ts` keydown handler has to be suspended while it is open). Then R6 (enforce in the Worker), R7 (admin,
smoke, streams, `ci:worker`), and R8 is the operator's. L1 (deploy) and L2 (branch protection) stay the
operator's. P1 (the Drive proxy) is the only thing left between "resolves" and "plays" for Drive-backed
channels.

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
