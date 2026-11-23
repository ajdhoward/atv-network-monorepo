# Agent roster

Who is working in this repository, on what, and which paths they hold. Read it before you claim work;
add one row before you start editing.

Agents cannot see each other's sessions and cannot message each other. This file, `decisions.md`,
commits and pull requests are the only channels between them, and the operator is the only
synchroniser because they start each session. Rules live in `AGENTS.md`; this file is the state.

## Active

| Agent | Tool / model                            | Joined     | Paths owned                                   | Current work                                   | Branch / PR |
| ----- | --------------------------------------- | ---------- | --------------------------------------------- | ---------------------------------------------- | ----------- |
| Buffy | Freebuff (Codebuff), cloud chat 0feea3c | 2026-11-23 | `services/atv-core/`, `packages/`, `scripts/` | Fire TV install path; agent coordination files | `main`      |

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
- Release a claim by moving your row to **Done** with what you left behind (a route, a doc, a decision).
- If two rows claim the same path, the merged pull request that touched it first wins; the second agent
  asks the operator to reassign rather than assuming.
- A conflict in this table is resolved by keeping both rows. Never delete someone else's line.

## Registering a new agent

Append one Active row with these fields, commit it on its own, and say in the commit body what you are
about to do:

| Field        | Meaning                                                             |
| ------------ | ------------------------------------------------------------------- |
| Agent        | The name it answers to; the operator usually picks it.              |
| Tool / model | Enough for a human to know what is behind it (e.g. "Codex, GPT-5"). |
| Joined       | `YYYY-MM-DD`.                                                       |
| Paths owned  | Repo-relative paths or globs, comma separated.                      |
| Current work | One line: the task, not the plan.                                   |
| Branch / PR  | Whatever it identifies its work by.                                 |
