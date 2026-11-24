# Context — Z

Working memory for agent Z (z.ai Code, web sandbox). Canonical facts live in the
logs; this file links to them and adds only what my next session needs to resume.
Last updated 2026-11-24.

## Who I am

- Agent: Z. Tool: z.ai Code (web sandbox). Joined 2026-11-24.
- Roles: Reviewer, Verifier (per-change). I hold no standing role.
- Paths owned: none. I author nothing, so I never collide with an Author's claim.
- Roster row: `docs/agents/roster.md` (Active table). This file:
  `docs/agents/context/z.md`.

## What I can and cannot verify

- I operate over the GitHub API only: I read diffs, CI runs and files, and post
  review comments and PR reviews.
- I cannot run `pnpm` here — this sandbox is a Next.js dev box, not the pnpm
  workspace, so `typecheck`/`lint`/`format:check`/`test`/`ci:worker` are not
  available. The Verifier role is therefore partial: I read CI run conclusions
  and check a diff against the brief and the docs, and I name any path I could
  not exercise as untested rather than claiming "tests passed".

## Review verdicts (independent — the second-agent pass)

Buffy authored the Drive proxy and token enforcement with self-review declared
(team of one). I read the merged code on `main` at `dc803a0` as the independent
Reviewer the protocol says a second agent provides.

- `device-token.ts` (R6): **approve.** Constant-time `equalBytes` (XOR fold, no
  early exit), SHA-256 digest comparison, `bearerToken` regex case-insensitive
  per RFC 6750 §2.1, `unenforced` distinct from `allow` (safe to ship pre-R8),
  token never in logs/responses/return values. No defects.
- `stream-sign.ts` (P1 signing): **approve.** HMAC-SHA256 via WebCrypto, `\n`
  separator prevents id+exp collision, `equalHex` constant-time, expiry checked
  after signature (forged ticket not told about expiry), non-integer exp →
  `bad-signature` not `missing`, `unconfigured` distinct. No defects.
- `stream.ts` (P1 proxy): **approve.** Hostname whitelist for `driveFileId`,
  `FILE_ID` regex `[A-Za-z0-9_-]{10,}` prevents injection, `PASSTHROUGH` is a
  header whitelist not passthrough-all, `no-store` throughout, graceful
  degradation (returns original link if no signing key). Note:
  `Access-Control-Allow-Origin: *` on `/api/stream` is correct given the ticket
  model — the 15-min signed ticket IS the authorization, and `<video
  crossOrigin="anonymous">` needs it. Not a defect.
- `resolver.ts`: **approve.** Operator secret wins over KV (correct precedence),
  per-isolate `operatorCache` with raw-string invalidation, malformed secret
  warned+ignored (doesn't take resolve down), HTTPS check, TorBox resolve only
  on resolve (not stream). No defects.

Not exercised by me: `pnpm test`, `pnpm run ci:worker` (no pnpm in this
sandbox). Buffy's review record (`docs/reviews/2026-11-24.md`) reports 236
passing tests and `ci:worker` 18/18; I take that on trust as Verifier-limited.

## Current task

Announcing (roster row + this file + docs/README.md entry, on branch
`z-join-v2`). This is the second attempt — the first (PR #10, branch `z-join`)
was closed because main moved: Buffy pushed P1, P3, Q2, R2-engines, R5-R7 and a
merge while I was working, so the roster table widths and the backlog both
changed and the v1 PRs went stale.

After announcing: review the open PRs (reviews from v1 still stand on #1-#9)
and ack the items still `proposed` on current main (Q1, Q3, T1, R3, R4, and the
workflow half of R2). Also acked the proposed Cloudflare-terms decision (PR #14).

## Next session

1. If the announcement PR merged: open the backlog-acks PR (append-only to
   `docs/agents/backlog.md`), acking only items still `proposed` on the current
   main. Items that became `done`/`accepted` while I worked (P1, P3, Q2, R1,
   R5-R7) need no ack.
2. I do not merge my own announcement: a second agent is now active, so
   Author != Reviewer (AGENTS.md). Buffy merges, or the operator is the
   fallback gate.
3. Open items needing the operator, not my ack: R8, L1-L5, Q3, Q4, Q5.

## Lessons (so the next session does not rediscover them)

- Main can move while I work: Buffy is an active agent on a long branch
  (`freebuff/9b6340e1`). Always re-fetch main HEAD before pushing; a PR based on
  a stale main will have misaligned table widths or stale backlog state.
- One write per step: batching two confirmation-gated writes (e.g. two PR
  reviews) in one function_calls block triggers an approval hold on the second.
- `docs/README.md` must list every doc under `docs/`; adding a context file
  without listing it fails `pnpm continuity` on merge.
- Buffy's branch can converge with main (merge commit `d34050b` brought main
  into her branch, then her commits landed on main). Her branch HEAD can equal
  main HEAD without a PR — check both before assuming a PR is the review surface.
