# Agent roster

Who is working in this repository, what they hold, and which roles are covered. Read it before you claim
work; add one row before you start editing.

Agents cannot see each other's sessions and cannot message each other. This file, `roles.md`,
`decisions.md`, commits and pull requests are the only channels between them, and the operator is the only
synchroniser because they start each session. Rules live in `AGENTS.md`; role definitions live in
`roles.md`; this file is the state.

## Coverage

One accountable agent per role, always. A role is never left empty: if the agent holding it leaves, the
handover is recorded here before its row moves.

| Role                         | Accountable now | Since      | Notes                                                                           |
| ---------------------------- | --------------- | ---------- | ------------------------------------------------------------------------------- |
| Integrator                   | Buffy           | 2026-11-23 | Singleton: merges and claim conflicts                                           |
| Cartographer                 | Buffy           | 2026-11-23 | Where a change belongs; reuse before build                                      |
| Scribe                       | Buffy           | 2026-11-23 | Roster, decisions log, docs                                                     |
| Sentinel                     | Buffy           | 2026-11-23 | Secrets, licences, budget, deploy authority                                     |
| Author / Reviewer / Verifier | per change      | —          | Recorded in the change; Reviewer is never the Author when two agents are active |

A team of one holds every role. That is expected, not a gap — but a change made that way says so, because
self-review is weaker than review by someone who did not write it.

## Active

| Agent | Tool / model                             | Roles                                      | Joined     | Paths owned                                                               | Current work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Branch / PR         | Context                              |
| ----- | ---------------------------------------- | ------------------------------------------ | ---------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------ |
| Buffy | Freebuff (Codebuff), cloud chat 9b6340e1 | Integrator, Cartographer, Scribe, Sentinel | 2026-11-23 | `services/atv-core/`, `apps/tv-client/`, `scripts/`, `docs/`, root briefs | R5–R7 and P1 done on this branch: the client carries and prompts for the household token, `/api/resolve` enforces it (`device-token.ts`), the Drive proxy serves `/api/stream/<id>` behind a signed ticket, `docs/r8-rollout.md` is the rollout authority and its commands were exercised locally. Latest: R3 landed (`pnpm coverage`, 90.05% lines, the files at zero named) with a config-meta parity test, then `pnpm budget` learned the Drive proxy's media class and stopped rejecting the documented `--` separator (Q7); P4's evidence is in `decisions.md`; P4 (ticket life), P5 (keyless resolve) and Q6 still wait on the operator. R8 (secret, TVs, enforcement order) is the operator's; nothing merged or deployed | `freebuff/9b6340e1` | [context/buffy.md](context/buffy.md) |

## Done

Agent rows stay for one week after finishing so a later agent can see who last touched what, then move
here and are deleted.

| Agent | Tool / model | Joined | Finished | Left behind |
| ----- | ------------ | ------ | -------- | ----------- |
| —     | —            | —      | —        | —           |

## Rules for this file

- One row per agent. Append at the end of the table; never reorder or edit another agent's row.
- `Paths owned` is a claim. While the row is in **Active**, no other agent edits those paths.
- Keep the claim as small as truth allows. A whole-package claim two agents could share is a mistake.
- A standing role moves by editing **both** the coverage table and the two agent rows, in one commit, with
  what the role carries: open changes, red CI, unclaimed paths.
- A claim must name an accepted item in `backlog.md`; the two have to agree, and a claim without an item
  is not a claim.
- The row links your own `docs/agents/context/<slug>.md`. Keep that file current: it is the only memory
  your next session gets, and `pnpm continuity` fails when an active row does not link one.
- Release a claim by moving your row to **Done** with what you left behind (a route, a doc, a decision).
- If two rows claim the same path, the merged pull request that touched it first wins; the second agent
  asks the operator to reassign rather than assuming.
- A conflict in this table is resolved by keeping both rows. Never delete someone else's line.

## Registering a new agent

Append one Active row with these fields, commit it on its own, and say in the commit body what you are
about to do:

| Field        | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| Agent        | The name it answers to; the operator usually picks it.                  |
| Tool / model | Enough for a human to know what is behind it (e.g. "Codex, GPT-5").     |
| Roles        | The roles it takes, from `roles.md`; "Author, Reviewer" is enough.      |
| Joined       | `YYYY-MM-DD`.                                                           |
| Paths owned  | Repo-relative paths or globs, comma separated.                          |
| Current work | One line: the task, not the plan.                                       |
| Branch / PR  | Whatever it identifies its work by.                                     |
| Context      | `docs/agents/context/<slug>.md`, created in the same commit as the row. |

Adding an agent accelerates the project only if it takes a path-disjoint slice and a role that is not
already the Integrator's. Two agents claiming the same paths is slower than one.
