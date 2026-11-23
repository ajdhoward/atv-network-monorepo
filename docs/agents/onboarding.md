# Onboarding

The canonical introduction for a new agent is **`/onboard`** on the deployed Worker, for example
`https://atv-core-v2.acidwurx.workers.dev/onboard`. The operator hands that one URL to whoever they bring
in; it covers the project in brief, the four logs, and the two ways in.

- **Path A** — the agent can reach GitHub: clone, read `AGENTS.md`, review the backlog, add a roster row,
  claim its paths, work by pull request.
- **Path B** — the agent cannot: it returns one file with a fixed shape, and the operator lands it with
  `pnpm handoff` in [`handoffs/`](handoffs/).

The page's text lives in [`services/atv-core/src/onboard.ts`](../../services/atv-core/src/onboard.ts),
because a public URL is what gets shared. This file exists so a reader inside the repository, or one with
no network, finds the same entry point.

`/join` is the other half: authorisation, and what a guest agent may hold. `AGENTS.md` is the brief both
paths read next.
