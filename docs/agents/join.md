# Joining without a GitHub integration

For a coding agent that has no GitHub app, MCP server or repository connector: it gets a shell with `gh`
and `git`, the operator authorises it once, and it works by pull request.

The same instructions are served publicly at `/join` on the Worker, so an agent can be pointed at a URL
instead of a checkout. This file is the fuller version: it explains what the authorisation actually
grants.

Access is a decision the operator makes per agent. The repository being public is not an invitation.

## What the agent gets

- Roles **Author** and **Reviewer** only. Integrator, Cartographer, Scribe and Sentinel stay with the
  resident agents (`roles.md`).
- Branches and pull requests. Not `main`, not workflows, not secrets.
- Nothing that resolves a stream: the line-up, the stream URLs and the provider tokens are not in this
  repository.

## Option A: fine-grained token (recommended)

A fine-grained personal access token is limited to one repository and to the permissions you tick, which
is what a hosted third-party agent should get.

1. Create it at `github.com/settings/personal-access-tokens/new`.
2. **Repository access:** only `atv-network-monorepo`.
3. **Permissions:** `Contents` read and write, `Pull requests` read and write, `Metadata` read
   (automatic). Everything else — `Actions`, `Workflows`, `Secrets`, `Administration`, `Environments` —
   **no access**.
4. **Expiry:** set one. Thirty to ninety days is plenty for a task; a forgotten token should die.
5. Give the value to the agent out of band and have it exported as `GH_TOKEN`. GitHub CLI recommends
   `GH_TOKEN` over `gh auth login --with-token` for fine-grained tokens, because the token's own scoping
   can confuse `gh` when it probes other endpoints.

```bash
export GH_TOKEN=...            # set by the operator, never written to the repo
gh auth status                 # shows the account, not the token
gh auth setup-git              # git uses gh as its credential helper
gh repo clone OWNER/atv-network-monorepo
```

## Option B: device code (what the operator authorises in a browser)

This is the flow for an agent that cannot receive a token: the agent starts the login, prints a one-time
code, and the operator approves it in a browser.

```bash
gh auth login --hostname github.com --git-protocol https --web
# prints: "First copy your one-time code: ABCD-1234"
# then waits while the operator enters it at https://github.com/login/device
gh auth setup-git
gh repo clone OWNER/atv-network-monorepo
```

The agent gives the code to the operator. Nobody needs a password, and the operator never handles the
resulting token.

**What that authorisation grants.** The web flow issues an OAuth token for the whole GitHub account, with
the `repo`, `read:org`, `gist` and `workflow` scopes. `repo` is not repository-scoped: it reaches every
repository the account administers, including settings and rulesets, and `gh api` can pass any request
through with the same token. So a device-code login is convenient but broad — it is an account-level
grant, not a project-level one.

Choose it when the agent runs on a machine you control. For a hosted service, use Option A. Either way:

- Revoke when the task ends: `gh auth logout --hostname github.com`, and confirm under **Settings →
  Applications** that the authorisation is gone.
- Agent work still lands by pull request, so a mistake is reviewable rather than already merged.
- `gh` stores the token in the system credential store when one exists, and falls back to a plain-text
  file (`~/.config/gh/hosts.yml`) when it does not. On a server, check `gh auth status` and prefer
  `GH_TOKEN` in the environment so no file holds it.

## After cloning

1. Read `AGENTS.md`, then `roster.md` and `decisions.md`.
2. Announce yourself: one roster row with name, tool or model, roles `Author, Reviewer`, date, the paths
   you will own, and your task. Commit it before any other edit.
3. Claim only those paths, and propose in `decisions.md` before changing a shared shape.
4. Work on a branch, open a pull request, and quote the checks you ran and the ones you could not run.

## Public and private

| Public                                                                             | Private                                                                     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Source, docs, `AGENTS.md`, this directory, `/install`, `/join`                     | `atv-config.json`, resolved stream URLs, `ATV_GDRIVE_MAP`, `torbox_map`     |
| The release APK and the read-only API (`/api/status`, `/api/health`, `/api/guide`) | The Android signing keystore, Worker secrets, KV writes, production deploys |

If you think a secret has leaked, stop and tell the operator. Do not try to fix it with a push.
