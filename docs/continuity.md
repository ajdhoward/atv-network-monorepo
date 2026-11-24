# Continuity: the repository is the project's memory

If something about this project exists only in a session, an agent's context, a chat, or one laptop, it
does not exist. Sessions end, context is dropped, agents are swapped, machines are replaced. The
repository is the only thing every agent reads and the only thing that survives all of them.

## The rule

Before you finish, ask: **would a new agent, given only this repository, know this?** If not, put it in the
repo — code, a doc, `decisions.md`, a backlog state, or this file. If it cannot go in the repo because it
is a secret, record here **its name, where it lives, and how to rebuild it**. Never the value.

`pnpm continuity` enforces the mechanical half of that on every push:

- no broken relative link in `README.md`, `AGENTS.md` or anything under `docs/`;
- every document under `docs/` listed in [`docs/README.md`](README.md), so none is invisible;
- every name in the secret inventory below still exists in the repository's workflows or config, so a
  rename cannot silently orphan the inventory — and, the other way, every secret the Worker reads is in it;
- every `package.json` script is named in a document, and every `pnpm` command a document names is a script,
  so a command cannot exist only in `package.json` and a runbook cannot send someone to a command that is
  gone (code spans and fences only: prose is not a command);
- no gitignored-but-vital file tracked by mistake (`atv-config.json`, `.env`, a keystore, an APK).

## In the repository: the source of truth

| What                                      | Where                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| The code, the build, the deploy workflows | this repository, `main`                                                        |
| The brief and the process                 | `AGENTS.md`, `docs/agents/`                                                    |
| What is next, claimed and done            | `docs/agents/backlog.md`, `docs/agents/roster.md`                              |
| What was decided and why                  | `docs/agents/decisions.md`                                                     |
| Reviews of the process                    | `docs/agents/reviews.md`, `docs/reviews/`                                      |
| How a new agent arrives                   | `/onboard`, `docs/agents/onboarding.md`                                        |
| How an agent with no access contributes   | `docs/agents/handoffs/`, `pnpm handoff`                                        |
| The sandbox target, KV ids, cron, routes  | `wrangler.toml`                                                                |
| Local environment and secret names        | [`.env.example`](../.env.example), [`.dev.vars.example`](../.dev.vars.example) |
| Production's shape, and the cutover rules | `wrangler.production.toml`, `docs/production-cutover.md`                       |
| The APK, versioned and signed per build   | the `atv-launcher-latest` release asset                                        |
| The monthly cost model                    | `scripts/lib/budget.mjs`, `pnpm budget`                                        |

## Deliberately not in the repository

This repository is public. None of these may ever be committed; each is recoverable.

| State                                       | Lives in                                                                                                                                             | How to rebuild it                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The line-up (`atv-config.json`)             | the operator's private store, KV `ATV_CONFIG/channels`, repository secret `ATV_SEED_CONFIG`                                                          | `pnpm seed --file …` or let the deploy job seed from the secret                                                                   |
| Stream links                                | Worker secret `ATV_GDRIVE_MAP`, KV `gdrive_map`                                                                                                      | `node scripts/set-gdrive-map.mjs <file>`                                                                                          |
| TorBox API token                            | Worker secret `ATV_TORBOX_API_KEY`, repository secret of the same name                                                                               | reissue in the TorBox account, `wrangler secret put`                                                                              |
| Household token for `/api/resolve`          | Worker secret `ATV_DEVICE_TOKEN`                                                                                                                     | any random string with no whitespace (it travels as one `Bearer` token); `wrangler secret put`, then type it on each TV once (R8) |
| Drive proxy tickets (`/api/stream`)         | Worker secret `ATV_STREAM_SIGNING_KEY`                                                                                                               | any long random string; `wrangler secret put`. Rotating it invalidates every URL already handed out (P1)                          |
| Cloudflare API token                        | repository secret `CF_API_TOKEN`                                                                                                                     | create a scoped token: Workers Scripts Edit, KV Storage Edit, Account Read                                                        |
| Access service token                        | repository secrets `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`                                                                                 | create in Zero Trust → Service Auth                                                                                               |
| Android signing key                         | repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, plus the operator's own copy | keep the original: a new key forces an uninstall on every TV                                                                      |
| Production source `4fb54df2`                | Cloudflare dashboard only                                                                                                                            | download it before any cutover — Q4 in the backlog                                                                                |
| KV contents (`guide:latest`, `config_meta`) | Cloudflare KV                                                                                                                                        | `pnpm seed`, then one cron run (`*/10`)                                                                                           |
| Zero Trust application and DNS              | Cloudflare dashboard                                                                                                                                 | described in `README.md` and Q5 in the backlog                                                                                    |

### Secret name inventory

Checked against the repository by `pnpm continuity`; add every new name here in the same change that
introduces it.

```text
ATV_SEED_CONFIG
ATV_DEVICE_TOKEN
ATV_STREAM_SIGNING_KEY
ATV_GDRIVE_MAP
ATV_TORBOX_API_KEY
CF_API_TOKEN
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

## Rebuild from nothing

A new agent or operator with a clone and the secrets above, in this order:

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test          # no credentials needed
pnpm run build:deploy && pnpm run ci:worker      # workerd, local KV only
pnpm budget                                       # stays inside the $5 plan
pnpm kv:staging && pnpm deploy                    # sandbox, needs CF_API_TOKEN
pnpm seed --file ./atv-config.json                # the line-up, kept outside git
pnpm smoke https://atv-core-v2.acidwurx.workers.dev
```

Disposable, never worth preserving: `node_modules`, `.wrangler/` local state, `dist/`, the built APK,
any one checkout. If losing a file would not hurt a new agent, it belongs in this list, not in the repo.

## Closing a session

Every agent, before its last message:

1. Decisions made → `docs/agents/decisions.md`, with the reason, not just the outcome.
2. Backlog states true: what you claimed is claimed, what you finished is done, what blocked you says how.
3. Anything you learnt that the next session would otherwise rediscover → `docs/`.
4. A secret's name, owner or rebuild step changed → this file, names only.
5. A handoff file from an agent without access → landed with `pnpm handoff … --commit --push`.
6. Nothing vital left only in the chat. If you would have to say it again next time, write it down.

## Known gaps

Honest, and tracked in the backlog rather than hidden:

- **The line-up has no backup this repository can hold** — R4 decides between a private companion repo, an
  encrypted blob, and the operator's password manager plus KV.
- **The deployed production source is not in git** — Q4.
- **Roster rows are the only record of an agent's session**; an agent that never commits one leaves nothing
  behind, which is why `AGENTS.md` makes the roster commit the first edit.
