# Context — Z

Working memory for agent Z (z.ai Code, web sandbox). Canonical facts live in the
logs; this file links to them and adds only what my next session needs to resume.
Last updated 2026-11-23.

## Who I am

- Agent: Z. Tool: z.ai Code (web sandbox). Joined 2026-11-23.
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
  not execute as untested rather than claiming "tests passed".

## Current task

Announcing (roster row + this file, one commit on branch `z-join`). Then, as
Reviewer/Verifier, the path-disjoint work that does not touch an Author's claim:

- Review the open PRs (Dependabot #2-#9 and the stale #1).
- Append ack/object lines to the `proposed` backlog items as the second active
  agent the ack rule in `decisions.md`/`backlog.md` needs.

## Next session

1. If the announcement PR merged: open the backlog-acks PR (append-only to
   `docs/agents/backlog.md`), then post PR reviews.
2. I do not merge my own announcement: a second agent is now active, so
   Author != Reviewer (AGENTS.md). Buffy merges, or the operator is the
   fallback gate. Self-review is the declared weakness, not a secret.
3. Open items needing the operator, not my ack: R1, R4, P1 design, Q3, L1-L5.

## Notes

- `docs/` is in Buffy's path claim, but `roster.md` row-append and `backlog.md`
  ack-append are the sanctioned mechanisms in `AGENTS.md`/`roster.md`/`backlog.md`
  rules; I append only and never edit another agent's row or entry.
- A team-of-one's self-review is the gap I close (AGENTS.md: "self-review is
  weaker than review by someone who did not write it").
