# Roles and coverage

Seven responsibilities, fixed. A team of one holds all seven; a team of five distributes them. What never
changes is that each one is covered, because each exists for a decision or a verification step that
otherwise goes unmade.

This is RACI in miniature: **one accountable agent per responsibility**, any number of agents doing the
work. The operator owns intent and the authority to spend, deploy and publish; agents hold delegated
responsibility and can only ever stop things, never authorise them.

Do not invent a role per task. A role earns its place only when it produces a distinct decision or
verification step; if two never differ for the work in front of you, one agent holds both. Ceremony is a
real cost, and a two-day change does not need five hats.

`roster.md` says who holds each role right now. This file defines the roles themselves.

## Integrator — one at a time

- **Decides:** what merges and in what order, which agent gets which slice, how a claim conflict resolves.
- **Must ensure:** `main` stays green; every change has a non-author reviewer when another agent is
  active; the roster's claims and coverage stay true.
- **Deliverables:** merged changes, a triaged red `verify`, an updated roster, and accepted backlog items
  assigned in priority order with their states kept true.
- **Does not:** author in the same window when someone else can, or approve its own work.
- **Why one:** two integrators merge into each other. Handing it over is an explicit roster change with
  the state it carries.

## Cartographer

- **Decides:** where a change belongs; reuse, stitch or build; what the slice is.
- **Must ensure:** the map in `AGENTS.md` matches the tree; new files and dependencies are justified; the
  same concern is not implemented twice.
- **Deliverables:** the plan — paths touched, interfaces changed, blast radius, why this component — and a
  groomed `backlog.md`: items sized, sliced path-disjoint, duplicates killed.
- **Does not:** treat writing production code as its output; if it writes, the Author role is on too.
- **Why:** it prevents drift — three ad-hoc resizers, two retry helpers, a paid API where a platform
  primitive already existed.

## Author

- **Decides:** how to implement inside the agreed slice.
- **Must ensure:** one logical change, tests for the behaviour, docs and README follow, nothing outside
  the claimed paths moved.
- **Deliverables:** the commits, plus a note saying what was verified and what was not.
- **Does not:** reshape a public interface mid-change; that goes back to the Cartographer.

## Reviewer

- **Decides:** whether the diff is ready or needs changes.
- **Must ensure:** correctness against the brief, house rules, secret hygiene, licence and budget impact;
  that the author's claims match the diff.
- **Deliverables:** one review note — approve, or the specific changes required.
- **Does not:** author the change (except in a team of one, declared) or rewrite it silently.

## Verifier

- **Decides:** whether it works outside the author's sandbox.
- **Must ensure:** the CI run's actual conclusion, `ci:worker`, a deployed smoke, a real device — whatever
  the change touches — and that untested paths are named as untested.
- **Deliverables:** the evidence quoted in the change record.
- **Does not:** accept "tests passed" without the command and its exit status.

## Scribe

- **Decides:** what is recorded as true.
- **Must ensure:** roster rows and claims current, decisions log complete, README and docs match
  behaviour, commit bodies explain why, claims released when work ends.
- **Deliverables:** those artefacts.
- **Does not:** invent history. If nobody wrote it down, it is unknown, not assumed.

## Sentinel

- **Decides:** whether a change is safe and affordable to add.
- **Must ensure:** no secrets, stream URLs or tokens in git or logs; licences allowed; no new billed
  service or API; no out-of-band deploy; the deploy guard untouched.
- **Deliverables:** a pass, or a block naming the rule it broke.
- **Does not:** deploy or spend. It can stop things; it can never authorise them.
- **Why separate from the operator:** the operator is the last gate; this is the gate that stops it before
  it reaches them.

## Coverage as the team grows

| Agents | Assignment                                                                                                 | What makes it work                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1      | one agent holds all seven                                                                                  | declare self-review and self-verification in the change; operator is the fallback gate |
| 2      | A: Integrator, Scribe, Sentinel; B: Cartographer, Author. Swap Author and Reviewer per change              | never self-approve while the other agent is free                                       |
| 3–4    | one Integrator that does not author; the rest author path-disjoint slices; Reviewer is always a non-author | merges stay off the critical path; review runs while the next slice is built           |
| 5+     | Integrator, N−1 authors on disjoint slices, one rotating Reviewer/Verifier pair                            | at most two open changes per agent; rotate roles weekly so blind spots do not harden   |

At every size, the per-change roles — Author, Reviewer, Verifier — are assigned per change and recorded in
the change itself, because they last exactly as long as it does. The standing roles — Integrator,
Cartographer, Scribe, Sentinel — are recorded in the roster's coverage table, because they outlive it.

## Making extra agents actually accelerate

- **Cut by path, not by idea.** Two agents on one file produce a conflict that costs more than the
  parallelism saves. The Cartographer names the slices; the Integrator assigns them.
- **Keep the critical path short.** Only shared-shape proposals and merges serialise. Authoring, reviewing
  and verifying all run in parallel.
- **Never idle behind a gate.** Waiting on a review? Take Reviewer or Verifier work instead.
- **Small changes land faster.** A one-hour slice merges in an hour; a three-day branch blocks its own
  review and verification too.
- **Balance, then speed.** The next slice goes to the agent with the fewest active claims: an even spread
  beats one fast agent and two waiting.
