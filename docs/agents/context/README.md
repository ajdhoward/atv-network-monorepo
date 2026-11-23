# Context: one file per agent

Sessions end. Context does not have to. Every active agent has exactly one file here,
`docs/agents/context/<slug>.md`, linked from its roster row, and that file is the memory its next session
starts from.

This is working memory, not documentation. It holds what _this_ agent needs to resume: what it owns, what it
is doing, what it tried that failed and why, what it learnt that cost time, and what the next session should
do first.

## The rule that keeps it honest

**Canonical facts live in the logs; the context file links to them and never copies them.** The roster says
who is here, the backlog says what is next, decisions say what was settled, continuity says where a secret
lives. A context file that restates those is a second source of truth and will drift. Link, date, and move
on.

Compartmentalisation follows from the same rule: an agent reads `AGENTS.md`, the three logs, and **its own**
context file. It does not need another agent's file. Anything another agent must know goes to the roster, a
decision, the backlog or a handoff — never into someone else's context.

## What goes where

| Fact                                                     | Lives in                      |
| -------------------------------------------------------- | ----------------------------- |
| Who is active, which roles, which paths they own         | `docs/agents/roster.md`       |
| What is next, what is claimed, what is blocked           | `docs/agents/backlog.md`      |
| What was decided, by whom, and why                       | `docs/agents/decisions.md`    |
| How the process is doing                                 | `docs/agents/reviews.md`      |
| What _I_ am doing, what I learnt, what failed, what next | `docs/agents/context/<me>.md` |
| What cannot be in git, and how to rebuild it             | `docs/continuity.md`          |
| How a stranger joins, with or without access             | `docs/agents/onboarding.md`   |

## One session, start to finish

1. **Read** `AGENTS.md`, the three logs, and your own context file.
2. **Review** the backlog: ack, object with a concrete harm, or add an item.
3. **Claim** an accepted item with a roster row that names your context file and your paths.
4. **Work** inside those paths; propose in `decisions.md` before a shared shape changes.
5. **Verify** with the checks that cover the change, then commit and push.
6. **Close**: roster row true, decisions recorded, context file current, continuity inventory updated if a
   secret's name changed, handoffs landed.

## Writing the file

- Under about 80 lines. If it is longer, something in it belongs in the logs.
- Facts with dates. "Tried X, failed because Y" is worth more than "X is hard".
- File paths and commit hashes, not pasted code.
- Prune what has since become a log entry, or a future session inherits last month's scratchpad.
- Never a secret. Names and locations only, exactly as `docs/continuity.md` does it.

`pnpm continuity` fails when an active roster row names no context file, so the file and the row cannot
drift apart.
