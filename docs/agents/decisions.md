# Decisions and consensus

An append-only log of proposals, acks and outcomes. `AGENTS.md` holds the constraints that are already
settled; this file holds everything that was argued about, so a later agent can see why instead of
reopening it.

Agents cannot reply to each other in real time. The ack rule below assumes each agent reads this file
when it next works, which is why an entry records who is absent rather than treating silence as a yes.

## Rules

- Append only: never edit or delete another agent's entry. Add your own lines under it.
- Newest first, one entry per proposal.
- `state:` is `proposed`, `accepted`, `rejected` or `withdrawn`.
- The operator marks the outcome. Consensus never authorises a deploy, a spend, a secret or a new
  dependency — those stay the operator's per-change decision.

## Template

```markdown
### YYYY-MM-DD — one-line title

- state: proposed
- proposed by: <agent>
- touches: <paths, routes, KV keys>
- why: <the problem, and the cost of doing nothing>
- change: <what would change, in one or two lines>
- risk: <what could break and how it would be noticed>
- cost: <new dependency, API or spend — or "none">
- acks: <other agents append `ack — <name>` or `object — <name> — <concrete harm>`>
- outcome: <filled in by the operator: accepted, rejected, decided against an objection>
```

## Log

### 2026-11-23 — Agent coordination files

- state: accepted
- proposed by: Buffy (Freebuff)
- touches: `AGENTS.md`, `docs/agents/`
- why: more than one agent will work in this repo. Without a shared roster and log, two of them edit the
  same file and the operator becomes the message bus, re-explaining state in every session.
- change: a join protocol in `AGENTS.md`, an append-only roster that doubles as a path claim, and this
  log with an ack rule for shared-shape changes.
- risk: the tables rot if agents skip the row. Mitigation: the protocol is a numbered step in
  `AGENTS.md`, and a claim is required before touching a claimed path.
- cost: none — two Markdown files, no runtime code.
- acks: operator (2026-11-23)
- outcome: accepted

### 2026-11-23 — Fixed roles, scaling assignments

- state: accepted
- proposed by: Buffy (Freebuff)
- touches: `AGENTS.md`, `docs/agents/`
- why: adding agents had no division of responsibility, so two of them could both integrate while nobody
  reviewed, and nothing guaranteed the licence, secret or documentation checks happened at all.
- change: seven fixed responsibilities in `docs/agents/roles.md`, a coverage table in the roster, and the
  rule that coverage is constant while assignments scale — a team of one holds all seven.
- risk: ceremony. Mitigation: a role only exists where it produces a distinct decision or verification
  step, and one agent may hold several.
- cost: none — Markdown only, no runtime code.
- acks: operator (2026-11-23)
- outcome: accepted

### 2026-11-23 — A public join URL for agents without a GitHub app

- state: accepted
- proposed by: Buffy (Freebuff)
- touches: `services/atv-core/src/join.ts`, `src/page.ts`, `AGENTS.md`, `docs/agents/join.md`, `README.md`
- why: a coding agent with no GitHub integration had no documented way in, and the operator would have to
  explain the same authorisation handshake in chat for each one.
- change: `/join` on the Worker plus `docs/agents/join.md`, documenting a fine-grained token scoped to this
  repository and the `gh` device-code flow, where the agent prints a one-time code the operator approves.
  Guest agents get Author and Reviewer only, on branches and pull requests.
- risk: a device-code login issues an account-wide token (`repo`, `read:org`, `gist`, `workflow`) that
  reaches every repository the account administers, so a hosted agent authorised that way holds far more
  than this project needs. Mitigation: the fine-grained token is the recommendation for hosted agents, the
  page states the account-wide scope plainly, revocation is documented, and guest work lands by pull
  request so a mistake is reviewable.
- cost: none — two static pages, no dependency, no billed service.
- acks: operator (2026-11-23)
- outcome: accepted

### 2026-11-23 — A reviewed backlog as the single work list

- state: accepted
- proposed by: operator, written by Buffy (Freebuff)
- touches: `docs/agents/backlog.md` (new), `AGENTS.md`, `roles.md`, `roster.md`, `README.md`
- why: the suggestions raised in one session lived in chat and in prose scattered across `README.md`, so a
  new agent could not see the queue, and each agent only ever brought its own judgement to its own task.
- change: `backlog.md` holds every known next step with why, done-when, paths, size and state. Items move
  proposed → accepted → claimed → done under the same propose/ack/decide rule as this log: every active
  agent acks or objects before the operator sets priority. Cartographer grooms and slices items, Integrator
  assigns them, and a roster claim must name an accepted item.
- cost: none — Markdown only.
- acks: operator (2026-11-23)
- outcome: accepted

### 2026-11-23 — A periodic review of the process itself

- state: accepted
- proposed by: operator, written by Buffy (Freebuff)
- touches: `docs/agents/reviews.md` (new), `docs/reviews/`, `AGENTS.md`
- why: the rules that coordinate the agents were being added but never re-read. A process that only
  accumulates rules slowly costs more context than it saves, and nothing would notice.
- change: a review every five merged changes, every two weeks, or immediately after an incident, run by the
  Scribe with the Reviewer and Verifier, recorded in `docs/reviews/YYYY-MM-DD.md` with a fixed scorecard and
  six questions about the process. Its outputs are backlog items, direct edits, or a rejection with a
  reason.
- risk: a review that is expensive to write stops happening. Mitigation: the record is a scorecard and
  short answers, and the operator triggers it in a session rather than watching for the trigger.
- cost: none — Markdown only.
- acks: operator (2026-11-23)
- outcome: accepted

### 2026-11-23 — One onboarding URL, and a handoff file for agents with no repository access

- state: accepted
- proposed by: operator, written by Buffy (Freebuff)
- touches: `services/atv-core/src/onboard.ts` (new), `scripts/handoff.mjs` (new), `docs/agents/handoffs/`,
  `AGENTS.md`, `README.md`
- why: the operator was explaining the same process in chat for every agent brought in, and an agent with
  no GitHub integration had no way to contribute anything at all — not even a proposal.
- change: `/onboard` is the single public URL to hand to a new agent, separate from `/join` (which stays
  authorisation) and from the project's objectives. Path A is clone, review the backlog, announce, claim,
  pull request. Path B is one file with fixed fields, landed by the operator with `pnpm handoff <file>
--commit --push` into `docs/agents/handoffs/`, which the validator checks for required fields, size and
  credential-shaped strings before anything is written.
- risk: a handoff could be mistaken for an ownership claim, or carry a secret. Mitigation: the template
  says paths are proposals, only a roster row claims a path, the validator rejects credential-shaped
  content outright rather than warning, and the page states both.
- cost: none — two static pages and a script with no dependency.
- acks: operator (2026-11-23)
- outcome: accepted

### 2026-11-23 — Nothing vital lives outside the repository

- state: accepted
- proposed by: operator, written by Buffy (Freebuff)
- touches: `docs/continuity.md` (new), `docs/README.md` (new), `scripts/check-continuity.mjs` (new),
  `.github/workflows/deploy.yml`, `AGENTS.md`
- why: knowledge was accumulating in sessions and chats, and one document (the first review record) was
  already unreachable from anywhere. A new agent given only the repository would not have found it, and a
  secret whose name is remembered by one agent is a secret the next agent cannot rotate.
- change: a continuity inventory records what is in the repo, what cannot be (with its name, location and
  rebuild step), the order to rebuild from a clone, and a session-close checklist. `pnpm continuity`
  enforces the mechanical half in `verify`: no broken relative links, every doc listed in `docs/README.md`,
  every inventoried secret name still present in the repository, and no gitignored-but-vital file tracked.
- risk: a check on prose can be gamed by writing docs to satisfy it. Mitigation: it only asserts
  reachability and names, which is exactly what a new agent needs; it makes no claim about whether a doc
  is accurate, and the reviews still sample that.
- cost: none — no dependency, one CI step that reads files.
- acks: operator (2026-11-23)
- outcome: accepted

### 2026-11-23 — One context file per agent, and one loop

- state: accepted
- proposed by: operator, written by Buffy (Freebuff)
- touches: `docs/agents/context/` (new), `docs/agents/roster.md`, `docs/agents/reviews.md`, `AGENTS.md`,
  `scripts/lib/docs-check.mjs`
- why: agents coordinate through the repository but had no working memory of their own, so each session
  rebuilt its context from the whole brief and lost what it had learnt when it ended. The logs hold
  canonical facts but not "what I tried that failed", which is the most expensive thing to rediscover.
- change: each active agent gets `docs/agents/context/<slug>.md`, linked from its roster row, holding only
  what that agent needs to resume: owned paths, current task, lessons, failures, next steps. The rule that
  keeps it from becoming a second source of truth is that canonical facts stay in the logs and the context
  file links to them. Compartmentalisation follows: an agent reads `AGENTS.md`, the three logs and its own
  file, never another agent's. `docs/agents/context/README.md` sets the loop and which fact belongs where;
  `pnpm continuity` fails when an active row links no context file, and the review asks whether each file is
  current.
- risk: context files accumulate stale scratchpads and quietly contradict the logs. Mitigation: an 80-line
  bound, "link, never copy", and a review question that checks exactly that.
- cost: none — Markdown plus one rule in the check that already existed.
- acks: operator (2026-11-23)
- outcome: accepted

### 2026-11-23 — A one-off KV provisioning workflow

- state: accepted
- proposed by: operator, written by Buffy (Freebuff)
- touches: `.github/workflows/provision-kv.yml` (new)
- why: the connected Cloudflare integration can deploy a Worker version with a KV binding but exposes no
  way to create a namespace, and a token pasted into chat is not an option. `CF_API_TOKEN` already carries
  Workers KV Storage: Edit — `deploy.yml` puts remote KV keys with it — so the repository can create the
  namespace without a new scope, a second secret or a local credential.
- change: a `workflow_dispatch`-only workflow that lists namespaces first, creates the named one only when
  it is absent, and prints the id in the job summary. It exists for `mcp-onboard-ONBOARD_KV`, which is not
  an ATV namespace; the file is deletable once that namespace exists.
- risk: an unused write path on the deploy token. Mitigation: dispatch-only, never on push, idempotent, and
  removable in one commit.
- cost: none — one job, no new secret.
- acks: operator (2026-11-23)
- outcome: accepted
