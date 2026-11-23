# AGENTS.md — how work on ATV Network is done

The operating brief for anyone, human or agent, changing this repository. Agent tools load it
automatically, so every line costs context in every session: point at `README.md` or `docs/` instead of
restating them. Where this file and a default habit disagree, this file wins; a nested `AGENTS.md` in a
subdirectory wins for that subtree. Keep this file near 200 lines; every session loads all of it.

## Joining this repo

You need nothing but this file and three small logs. Read and act in this order:

1. Read this file, then the three logs: [`roster.md`](docs/agents/roster.md) (who is here, what they
   hold), [`decisions.md`](docs/agents/decisions.md) (what is acked, settled) and
   [`backlog.md`](docs/agents/backlog.md) (what is next). With no GitHub integration, start from
   `docs/agents/join.md` or `/join` on the Worker.
2. **Announce yourself.** Append one row to the roster — name, tool or model, roles, date, paths you will
   own, task — and commit it before any other edit. That commit is your announcement; there is no other
   channel, because agents cannot see each other's sessions.
3. **Claim only your paths.** If another agent owns what you need, say so in your row or take a
   different task. Editing a claimed file is the one collision git cannot merge away.
4. **Propose before reshaping anything shared** — an `/api/*` field, a KV key, a workflow, the APK
   asset name — and wait for the acks described in
   [Roles and coverage](#roles-and-coverage).
5. Work, verify, commit, push. When you finish, mark your roster row done and record the outcome in
   `decisions.md` if you changed a shared shape.

Message to paste when bringing a new coder agent in:

```text
You are joining an existing project: github.com/ajdhoward/atv-network-monorepo.
Read AGENTS.md, then docs/agents/roster.md, docs/agents/decisions.md and docs/agents/backlog.md.
Review the backlog: ack or object to the items in it, or add one, before you claim work.
Announce yourself by adding one row to the roster (name, tool, roles, date, paths you will
own, task) and committing it before any other edit. Claim only those paths, propose before
changing a shared shape, and follow the ack rule for consensus. Pull before you push,
never force-push, and never edit another agent's row, branch or commits. Report what you
verified and what you could not.
```

## What this is for

A private streaming network for one household. A Cloudflare Worker serves the channel guide, resolves
stream links, and serves the TV client plus an admin panel; a WebView shell runs on Fire OS devices
(Fire TV Stick and similar). It has to keep working inside the Workers Paid minimum — **$5/month and
zero additional spend** — and a stream URL must reach the device over TLS from a server-side resolve,
never from data the TV itself holds.

Objectives, in priority order:

1. **It plays.** A channel that resolves and plays on the TV beats any amount of polish.
2. **It stays free.** No new billed service, no unbounded per-request cost.
3. **It stays private.** Stream URLs and provider tokens never enter git, logs, chat or the client.
4. **It stays up.** Health and stream coverage are observable; a failure is loud, not silent.
5. **It stays maintainable.** Small, typed, tested, conventional code the next session can pick up.

Non-goals: multi-tenant SaaS, accounts for strangers, features nobody in the household asked for.

## Map

| Path                         | What lives there                                             | Read more             |
| ---------------------------- | ------------------------------------------------------------ | --------------------- |
| `services/atv-core/`         | Worker: router, guide, resolver, TorBox, `/install`, limiter | `README.md` API table |
| `apps/tv-client/`            | Guide grid, player, overlays, D-pad handling                 | `apps/tv-client/src/` |
| `android/`                   | Fire OS WebView shell; the APK is a release asset            | `android/README.md`   |
| `scripts/`                   | Seed, dev, smoke, ci-worker, budget, deploy guards           | `README.md` layout    |
| `docs/agents/`               | Roster (claims, coverage), roles, decisions log              | itself                |
| `docs/production-cutover.md` | The only authority for replacing production                  | itself                |
| `wrangler.toml`              | Sandbox `atv-core-v2` — the default deploy target            | `README.md` Deploy    |

## Commands

Run from the repository root with pnpm 9. `node_modules` is not in git.

```bash
pnpm install --frozen-lockfile      # restore dependencies; never edit the lockfile by hand
pnpm dev                           # seed local KV, then wrangler dev on :8788
pnpm typecheck                     # worker + tv-client + admin-cms
pnpm lint                          # ESLint
pnpm test                          # full Vitest suite
pnpm exec vitest run services/atv-core/test/install.test.ts   # one file
pnpm exec vitest run -t "name of the test"                    # one test
pnpm run build:deploy              # client + admin + pack; required before ci:worker
pnpm run ci:worker                 # boot the built Worker in workerd and exercise it
pnpm budget                        # model usage against the Workers Paid allowance
pnpm smoke <origin> --allow-empty  # post-deploy check of a deployed origin
pnpm deploy                        # kv:staging -> guard -> build -> deploy atv-core-v2
```

`ci:worker` serves the built assets, so run `build:deploy` first. For a local lineup:
`pnpm seed:local -- --file atv-config.json`. Prettier and ESLint own style; run them, do not hand-match.

## Settled decisions

Rationale for each is in `decisions.md`; do not re-open them without new information.

- **Fire OS has no Chrome**, so a Trusted Web Activity cannot launch: the client is a WebView shell, not
  Capacitor or Cordova. Cloudflare ships no WARP client for it either, so encryption is TLS everywhere
  (the resolver refuses non-HTTPS) plus Access or a Tunnel in front of control planes.
- **Stream links resolve server-side.** TorBox links expire in about three hours, so they are cached
  per isolate for 30 minutes and never seeded or sent to a device. Precedence is `ATV_GDRIVE_MAP`, then
  `torbox_map`, then KV `gdrive_map`.
- **Google Drive has no direct-play URL.** The agreed approach is a Worker proxy with signed URLs and
  Range passthrough; it is not built, and "just use the Drive link" is not a shortcut.
- **Sandbox first.** `pnpm deploy` targets `atv-core-v2`; the live `atv-core-orchestrator` is not built
  from this repo, and `docs/production-cutover.md` governs any replacement.
- **The APK is a release asset**, not repo content: the Android workflow publishes `atv-launcher.apk` on
  the `atv-launcher-latest` release, and `/install` links to `/releases/latest/download/`.

## Strategy: reuse, then stitch, then build

The default answer to "how do we do X" is an established component that already does X, wired into
this repo. Prefer editing an existing file to adding one; a fresh build needs its reason written down.

1. **Platform first.** Cloudflare Workers/KV/Durable Objects, Android's own framework APIs, GitHub's
   official actions. Already paid for, already reliable, already documented.
2. **Established library second.** Maintained, permissive, current. Choose on: smallest surface (few
   dependencies, no native code, runs in workerd), most real users, clearest licence.
3. **Stitch third.** Compose those pieces behind a thin adapter of ours; our adapters connect things,
   they do not reimplement them.
4. **Build last, and say why** in the commit body: no maintained option exists, the licence is
   incompatible, the runtime cannot support it, or it would cost more than it saves.

**Licences.** Allowed without asking: MIT, ISC, BSD-2/3-Clause, Apache-2.0, MPL-2.0, Unlicense/CC0. Ask
first: LGPL, EPL, GPL, AGPL (network copyleft reaches a hosted Worker), CC-BY-SA, custom or dual
licences, and anything that calls a paid API. Never: unlicensed or source-available-only code, snippets
from a blog or Gist with no licence attached, or a vendored blob whose upstream commit is not recorded.

Record a dependency with the same caret range the repository uses, let `pnpm-lock.yaml` pin the exact
version, keep CI on `--frozen-lockfile`, and name its licence in the commit when it is outside the list
above. Do not upgrade unrelated dependencies in the same change.

## Roles and coverage

Seven responsibilities must always be covered: **Integrator** (what merges, in what order, who gets which
slice), **Cartographer** (where a change belongs, reuse or build), **Author**, **Reviewer**, **Verifier**,
**Scribe** (roster, decisions, docs) and **Sentinel** (secrets, licences, budget, deploy authority).
`docs/agents/roles.md` defines each one; the roster's coverage table says who holds it now.

Coverage is constant, assignments scale: one agent holds all seven, five agents split them, and no role
ever goes unowned. Put the roles you take in your roster row.

- **Author ≠ Reviewer when a second agent is active.** A team of one declares self-review and
  self-verification in the change; the operator is the fallback gate. Self-approval is never silent.
- **Parallelism is disjoint slices, not more agents per file.** The Cartographer cuts, the Integrator
  assigns, and only shared-shape proposals and merges serialise.
- **Never idle behind a gate.** Waiting on a review? Take Reviewer or Verifier work.
- **Hand over explicitly.** A role that moves is recorded in the roster with its state: open changes, red
  CI, unclaimed paths.

Agents cannot talk to each other; the repository is the channel, and the operator starts each session.

- **Propose, ack, decide.** A shared-shape change is an entry in `decisions.md` with `state: proposed`;
  every other active agent adds `ack — <name>` or `object — <name> — <concrete harm>`; the operator marks
  the outcome. Silence is recorded as absence, never as consent.
- **Claims are exclusive.** A path in an active roster row is that agent's until the row says done.
- **Consensus authorises nothing:** deploy, spend, secret and dependency stay the operator's call. Pull
  before you push, and collisions keep both sides with the operator ordering them.

## The plan

`docs/agents/backlog.md` is the work list _and_ the debate: read it each session, ack, object or add, and let the operator set priority before anyone claims. Nothing is built that is not listed; nothing is claimed unreviewed. `docs/agents/reviews.md` sets when the process itself gets reviewed: every five changes, every two weeks, or after a red `main`.

## Verify before you believe

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
pnpm run build:deploy && pnpm run ci:worker   # for anything the Worker serves
```

Run the checks that cover what you changed, not every check every time. Report a path you could not
exercise — no TV, no token, no account — as untested, and keep a piped command's exit status.

## Git workflow

`main` is the integration branch; every finished change lands on it. The Android workflow publishing
the APK on an `android/` change is expected automation, not an exception to the deploy rules.

- Branch per task and open a pull request when your tool supports it; if it can only push `main`, pull
  first and keep the change small.
- Imperative subject line; the body says **why**, not what the diff already shows.
- One logical change per commit; no AI attribution or co-author trailers.
- After pushing, watch the `verify` run (and `Android APK` when `android/` changed). Green means the run
  reported success, not that it was queued.

## Boundaries

**Always**

- Run the checks for the area you touched, then commit and push the finished change.
- Keep `main` green; fix a red `verify` before starting anything new.
- Log and print counts and ids, never links or tokens.
- Update `README.md` or `docs/` when a command, route or behaviour changes.

**Ask first**

- Any new dependency outside the licence list, and any new service or API — even a free tier.
- Anything that changes a public shape: `/api/*` fields, KV key shapes, `torbox_map`/`gdrive_map`
  entries, the release asset name. Propose it in `decisions.md` first.
- Deploying the sandbox, publishing a release by hand, changing workflows or deploy config, adding a
  nested `AGENTS.md`.
- Anything that spends money or changes a Cloudflare plan or limit.

**Never**

- Deploy production: no `ATV_ALLOW_PROD_DEPLOY=1 pnpm deploy:prod`, no `ATV_ALLOW_SHARED_KV=1`, no
  deploy at `atv.acidwurx.org`.
- Commit `atv-config.json`, stream URLs, tokens, keystores or `.env`.
- Force-push, rewrite history, or edit another agent's branch, row or commits.
- Add D1, R2, Queues or a paid API to this Worker. Production's D1 belongs to the incumbent Worker, not
  to this repository.
- Delete KV keys or run `seed --prune` against production namespaces.
- Invent a provider, a stream source, or a credential that does not exist.
