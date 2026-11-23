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
