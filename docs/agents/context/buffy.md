# Buffy — context

Working memory for the next session. Canonical state is in the logs; this is what they do not hold.

- **Agent:** Buffy, Freebuff (Codebuff), cloud chat `0feea3c`
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
- All pushed; `verify` green to run #49. Nothing deployed: the sandbox still serves the pre-`/install` build.

## What I am doing

Nothing claimed. The queue is the backlog; the first three moves are L1 (deploy the sandbox), L2 (protect
`main`) and the R1 decision (`/api/resolve` is unauthenticated on a public host). L1 and L2 are the
operator's to authorise; R1 needs a decision before L4 seeds real links.

## What I learnt that cost time

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

## What I tried that failed

- `/tmp/pnpm-cli/bin` is how pnpm is available here; `corepack` is not on `PATH`. Export it before `pnpm`.
- `read_files` and shell calls are sometimes refused once with the project brief injected; retrying the same
  call works.
- There are no Cloudflare credentials in the shell and no browser for an OAuth callback, so `wrangler` cannot
  authenticate here. The connected Cloudflare integration is the only path and it is server-side: it reads the
  account, KV and scripts, and it exposes _Create Worker Version_ with `deploy: true`, which does accept
  bindings. It exposes no KV-namespace creation and no worker deletion — so a deploy is possible, provisioning
  is not.

## Outside this repository

- A separate project, `mcp-onboard` (a Cloudflare Worker with one KV binding), was reviewed in this chat and
  left **undeployed**: the account has no `ONBOARD_KV` namespace, the connected integration cannot create one,
  and the environment cannot run `wrangler login`. Its code was verified end to end under local workerd and
  one bug fixed (the landing page printed a hardcoded host instead of the request origin). The checkout was
  `/tmp/mcp-onboard` and is **gone**: `/tmp` is not checkpointed and the account has no `mcp-onboard`
  repository to clone from, so the code has to be re-supplied. Next time it goes into its own repo before any
  work starts. What this session established, so it is not re-derived: the credential can deploy a version
  with a `kv_namespace` binding, so once a namespace exists the deploy is one API call; the only missing step
  is creating that namespace, which the integration does not offer at all. The operator creates it in the
  dashboard (Workers & Pages → KV → Create), and the name and id are recorded here when they do.

## Next session, in order

1. With the operator: L1 deploy, then L2 branch protection; re-run `pnpm smoke` against the deployed host.
2. R1: choose how `/api/resolve` stays private, in `decisions.md`, before L4.
3. P1: the Drive proxy, which is the only thing between "resolves" and "plays" for Drive-backed channels.
4. Keep this file and the roster row honest, or the next session starts blind.
