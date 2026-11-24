# Reviews: the loop checked on itself

The backlog decides what to build. This file decides when the way we build gets checked. Without it a
process only accumulates rules, and the rules that stopped earning their context are never noticed.

## When

A review runs at whichever of these comes first:

- every five changes merged to `main` (a change is a commit that altered behaviour or process, not a typo),
- every two weeks,
- immediately after any of: `main` red for more than an hour, a deploy that had to be rolled back, a
  secret-shaped string committed even if reverted, two agents colliding on a claimed path, or a backlog item
  that turned out to be the wrong thing to build.

The operator starts it by saying "review". Anyone may ask for one sooner.

## Where the last review ended

A window has to start somewhere, and "every five changes" only counts if the commit the last record read is
written down. Keep the line below current in the same change that adds a record; `pnpm continuity` counts from
it and warns at five, so the trigger is arithmetic instead of a judgement about whether enough has happened.

Last review: `6ad6e40`, 2026-11-24 ([`reviews/2026-11-24-p3.md`](../reviews/2026-11-24-p3.md)) — the next
window starts after the commits that record it, by design.

## Who

The Scribe runs it and writes the record. The Reviewer takes the code half, the Verifier re-runs the
scorecard numbers. With one active agent, that agent does all three and says so in the record: self-review
is declared, never implied.

## Scorecard

Copy numbers, do not describe them.

| Measure                    | Where it comes from                                     |
| -------------------------- | ------------------------------------------------------- |
| Tests and files            | `pnpm test`                                             |
| Coverage                   | `pnpm coverage`: lines % overall, and every file at 0   |
| Typecheck, lint, format    | the three commands                                      |
| Worker smoke checks        | `pnpm run ci:worker`                                    |
| Budget headroom            | `pnpm budget`: the worst share                          |
| Files and code lines       | `git ls-files`, `wc -l`                                 |
| Changes since last review  | `git log --oneline <last-review>..HEAD`                 |
| Red runs since last review | Actions → Deploy runs                                   |
| Backlog by state           | `backlog.md`: proposed, accepted, done, blocked         |
| Docs that are now false    | spot-check the API table and the Map against the router |

## What to ask

1. Did anything in `AGENTS.md` cost more context than it saved? Cut or merge it.
2. Did a rule get broken? A rule broken habitually is the wrong rule — change it, and say why.
3. Did two agents collide or idle? What in the claims model allowed that?
4. Did a check pass while the thing it guards was broken? That check is lying; fix the check.
5. Is the backlog honest — are `blocked` items still blocked, are done items actually done?
6. What did we learn that the next session would otherwise rediscover?
7. Is every active agent's context file current — could that agent's next session resume from it alone?

## Outputs

- A record at `docs/reviews/YYYY-MM-DD.md`: the scorecard, the answers, and what changes. Records are
  indexed in `docs/README.md`, which `pnpm continuity` enforces, so a review cannot become private.
- Each accepted change becomes a backlog item, or a direct edit when it is small enough to do in the
  review itself.
- Process edits go to `AGENTS.md`, `roles.md`, this file, or `decisions.md` when the change is a settled
  shape.
- Every record carries a coverage number and names the files at zero (R3). A test count says nothing
  about the files with no test, so the scorecard has to show both.
- A rejection is recorded with its reason, so it does not come back next quarter.

The record is short on purpose: a review that takes longer to write than to do will stop happening.
