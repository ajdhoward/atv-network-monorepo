# AGENTS.md — how work on ATV Network is done

This file is the standing brief for anyone, human or agent, changing this repository. Agent tools
read it automatically; keep it short, because it is context rather than documentation. When it and a
default habit disagree, this file wins.

## What the project is for

A private streaming network for one household. A Cloudflare Worker serves the channel guide and
resolves stream links, a TV client runs on Fire OS devices (Fire TV Stick and similar), and an admin
panel shows health. It has to keep working inside the Workers Paid minimum — **$5/month and zero
additional spend** — and a link must reach the device over TLS from a server-side resolve, never from
data the TV itself holds.

Objectives, in priority order:

1. **It plays.** A channel that resolves and plays on the TV beats any amount of polish.
2. **It stays free.** No new billed service, no unbounded per-request cost. `pnpm budget` gates this.
3. **It stays private.** Stream URLs and provider tokens never enter git, logs, chat or the client.
4. **It stays up.** Health and stream coverage are observable; a failure is loud, not silent.
5. **It stays maintainable.** Small, typed, tested, conventional code that the next session can pick up.

Non-goals: multi-tenant SaaS, accounts for strangers, features nobody in the household asked for.

## Strategy: reuse, then stitch, then build

The default answer to "how do we do X" is **an established component that already does X**, wired
into this repo. A fresh implementation is the exception and needs its reason written down.

Work in this order:

1. **Platform first.** Cloudflare Workers/KV/Durable Objects, Android's own framework APIs, GitHub's
   official actions. Already paid for, already reliable, already documented.
2. **Established library second.** A maintained package with a permissive licence and current
   releases. Choose on: smallest surface (few dependencies, no native code, runs in workerd), most
   real users, clearest licence, active maintenance.
3. **Stitch third.** Compose those pieces behind a thin adapter of our own. Our adapters stay small;
   they connect things, they do not reimplement them.
4. **Build last, and say why** in the commit body: no maintained option exists, the licence is
   incompatible, the runtime cannot support it, or it would cost more than it saves.

A new dependency is also a supply-chain and cold-start cost, so keep the set small and pinned.

### Licence rules

- **Allowed without asking:** MIT, ISC, BSD-2/3-Clause, Apache-2.0, MPL-2.0, Unlicense/CC0, and the
  free tier of a service already in use.
- **Ask the operator first:** LGPL, EPL, GPL, AGPL (network copyleft reaches a hosted Worker),
  CC-BY-SA, custom or dual licences, and anything that calls a paid API.
- **Never:** unlicensed or source-available-only code, snippets from a blog or Gist with no licence
  attached, or a vendored blob whose upstream commit is not recorded.

When adding a dependency: record it with the same caret range the repository already uses, let
`pnpm-lock.yaml` pin the exact version, keep CI on `--frozen-lockfile`, and name its licence in the
commit if it is outside the allowed list. Do not upgrade unrelated dependencies in the same change.

### Verify before believing

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and `pnpm run ci:worker`, which boots
the built Worker in workerd. Report a path you could not exercise (no device, no credential) as
untested rather than as working.

## Hard rules

- **Never deploy production.** `wrangler.toml` (sandbox `atv-core-v2`) is the only deploy target;
  `ATV_ALLOW_PROD_DEPLOY=1 pnpm deploy:prod` replaces the live Worker and drops its bindings.
  Publishing, deploying and pushing to production branches are the operator's call, per change.
- **No secrets in the repo.** `atv-config.json`, stream URLs, provider tokens and signing keys are
  gitignored or held as Worker secrets. Log and print counts and ids, never links.
- **Commit and push finished work.** The repository matches what was verified: imperative subject,
  short why-body, no AI attribution, one logical change per commit.
- **Small diffs.** Fix the cause, do only what was asked, do not refactor around it.
- **House style.** TypeScript strict, two spaces, double quotes, 100 columns, Prettier/ESLint clean,
  tests beside the thing they cover (`test/*.test.ts`), comments that explain _why_.
