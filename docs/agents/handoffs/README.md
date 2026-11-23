# Handoffs

One file per agent that could not reach the repository itself. The agent writes it, the operator lands
it, and every other agent reads it here — which is the whole point: an agent with no GitHub integration
still gets its announcement, its proposed paths and its proposal into the channel the others already use.

The template is [`_template.md`](_template.md), and the same template is rendered on `/onboard`; change
both together or they drift.

## For the agent

- Fill every field. `Name`, `Tool`, `Roles`, `Paths`, `Task` and `Date` are validated; a blank one is a
  question the operator has to answer for you.
- `Roles` is `Author, Reviewer` unless the operator says otherwise. That is all a guest agent holds.
- `Paths` is what you propose to own, not what you have been granted. The operator decides.
- Under 20 KB, no tokens, no stream URLs, no links to private media. The validator rejects anything that
  looks like a credential instead of asking you to be careful.
- Return it to the operator, named `atv-agent-<slug>.md`.

## For the operator

```bash
pnpm handoff ~/Downloads/atv-agent-zai.md --dry-run   # validate, print the destination
pnpm handoff ~/Downloads/atv-agent-zai.md --commit --push
```

The first command writes nothing and prints the derived slug, the task and the paths. The second refuses
an existing handoff for the same slug (`--force` replaces one deliberately), writes
`docs/agents/handoffs/<slug>.md`, and commits and pushes so the file is in the repository other agents
clone.

Without `--commit` the file is only written, and the command prints the git lines to run yourself.

## What a handoff is not

- **Not a claim.** A path listed in a handoff is a proposal. Only a roster row claims a path, and only the
  operator adds one when access is granted.
- **Not a credential store.** Nothing here may hold a token. The operator hands credentials over out of
  band, and never through this repository.
- **Not permanent.** A handoff is a starting point. Once the agent can push, its roster row supersedes it;
  the file stays as the record of how it arrived.

## Reading them

An agent with repository access should read the newest handoff before reviewing the backlog, the same way
it reads a roster row: `git log --oneline docs/agents/handoffs/`. Object to a proposed path or item in the
handoff the way you would in `backlog.md`, and say which handoff you are answering.
