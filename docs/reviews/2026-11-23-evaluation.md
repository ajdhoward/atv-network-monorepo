# Review — 2026-11-23

First review under [`docs/agents/reviews.md`](../agents/reviews.md). Scope: the whole repository as it
stands at commit `fd08253`, not just the last change. Run by Buffy (Freebuff), which holds every role,
so this is declared self-review and self-verification; no second agent has reviewed it.

## Scorecard

| Measure                   | Value                                                    |
| ------------------------- | -------------------------------------------------------- |
| Tests                     | 160 passing, 18 files                                    |
| Typecheck / lint / format | pass / pass / pass                                       |
| Worker smoke checks       | 15/15, including `/join`, cron snapshot and the limiter  |
| CI                        | Deploy runs #44 and #45 green                            |
| Budget headroom           | worst metric 0.43% of the included allowance             |
| Size                      | 102 tracked files, ~6.6k lines of code, 57 commits       |
| Backlog                   | 14 proposed or blocked, 0 accepted, 0 done               |
| Secrets in tracked files  | none found (token patterns, private-key headers, `.env`) |

## Findings

| #   | Severity | Finding                                                                                                                                                                                        | Action |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | High     | `/api/resolve` answers any caller with a stream URL, and the sandbox host is not behind Access. Harmless while the sandbox is unseeded; it becomes real the moment real links are seeded (L4). | R1     |
| 2   | High     | `main` is unprotected. Guest agents will hold write tokens and "PR only" is currently a page, not enforcement.                                                                                 | L2     |
| 3   | Medium   | `README.md` API table was malformed: the new `/join` row had been appended inside the `/install/qr.svg` row, so the table rendered wrong.                                                      | fixed  |
| 4   | Medium   | `AGENTS.md` Map table was split in two by a blank line left when two rows were removed, so five rows lost their header.                                                                        | fixed  |
| 5   | Medium   | The $5 ceiling is not enforced by CI: `pnpm budget` exists and exits non-zero, but no workflow runs it.                                                                                        | Q1     |
| 6   | Medium   | The release asset that every installed APK updates from is not checked after a deploy; a renamed or deleted asset fails silently until someone reinstalls.                                     | Q2     |
| 7   | Low      | `package.json` states no `engines`, and CI pins wrangler 4.166.0 while the dependency range is `^4.136.1`, so a local build and the deploy can use different CLIs.                             | R2     |
| 8   | Low      | No coverage signal. 160 tests say nothing about which files have none, and a new module can land unexercised without anything noticing.                                                        | R3     |
| 9   | Low      | `/admin/` is unauthenticated on the public sandbox. It reads public data only and says so, so this is acceptable — but it must not become a view onto real links while finding 1 stands.       | R1     |
| 10  | Info     | Nothing has ever run on a Fire TV. Every playback and D-pad claim is inference from the code.                                                                                                  | L5     |

## What the numbers say

The engineering base is in better shape than the shipping base. Checks, tests and the budget model are
solid and cheap to keep green; what is missing is everything that needs the operator, a device or a real
secret: the host that serves the pages, the protection on `main`, the signing key, the provider tokens, the
Drive proxy, and one install on hardware. The most valuable next hour is not code.

Two things are worth naming because the scorecard hides them. First, 0.43% headroom is not a reason to
ignore the budget — it is the reason the model is trustworthy, since its assumptions are upper bounds
(no CDN cache, no isolate memo). Second, `main` has never been red for a behaviour reason in this history;
every failure has been process or docs, which is why findings 3 and 4 matter more than their severity
suggests: a brief that misleads an agent costs more than a flaky test.

## Changes made in this review

- Fixed both documentation defects (findings 3 and 4).
- Added `page.ts` and `join.ts` to the README layout, which still described the worker as it was before the
  shared page shell.
- Added [`docs/agents/reviews.md`](../agents/reviews.md) and the backlog items R1–R3.
- Added the reviews pointer to `AGENTS.md` and a decisions entry for the cadence.

## Not checked

- No Fire TV, so no install, playback, seek or D-pad behaviour.
- No TorBox token or Drive map, so every resolve path beyond the fixtures is unexercised.
- No second agent, so no independent review of this record.
- Coverage was not measured (finding 8 is the reason).
