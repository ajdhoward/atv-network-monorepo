# AGENTS.md — how work on ATV Network is done

The operating brief for anyone, human or agent, changing this repository. Agent tools load it
automatically, so every line costs context in every session: point at `README.md` or `docs/` instead of
restating them. Where this file and a default habit disagree, this file wins; a nested `AGENTS.md` in a
subdirectory wins for that subtree. Keep the whole file under about 200 lines.

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
| `apps/admin-cms/`            | Health and stream-coverage panel, served at `/admin/`        | `README.md` API table |
| `packages/ui-shared/`        | Shared types and the example seed config                     | `src/index.ts`        |
| `android/`                   | Fire OS WebView shell; the APK is a release asset            | `android/README.md`   |
| `scripts/`                   | Seed, dev, smoke, ci-worker, budget, deploy guards           | `README.md` layout    |
| `docs/production-cutover.md` | The only authority for replacing production                  | itself                |
| `wrangler.toml`              | Sandbox `atv-core-v2` — the default deploy target            | `README.md` Deploy    |
| `wrangler.production.toml`   | Production reference; not deployable from here by default    | `README.md` Deploy    |

## Commands

Run from the repository root with pnpm 9. `node_modules` is not in git.

```bash
pnpm install --frozen-lockfile      # restore dependencies; never edit the lockfile by hand
pnpm dev                           # seed local KV, then wrangler dev on :8788
pnpm typecheck                     # worker + tv-client + admin-cms
pnpm lint                          # ESLint
pnpm format                        # Prettier write (CI runs format:check)
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
`pnpm seed:local -- --file atv-config.json`. Formatting is Prettier's job and lint rules are ESLint's:
run them, do not hand-match style or argue with a rule in this file.

## Decisions already made

Do not re-open these without new information; each one cost a real investigation.

- **Fire OS has no Chrome**, so a Trusted Web Activity cannot launch. The client ships as a WebView
  shell. Capacitor or Cordova would add a bridge, plugins and a Node build step for capabilities this
  shell never calls.
- **Cloudflare ships no WARP client for Fire OS.** "Encrypt the TV's traffic with WARP" is not
  available. The substitute is TLS everywhere (resolver refuses non-HTTPS) plus Access/Tunnel in front
  of control planes.
- **Stream links resolve server-side.** TorBox links expire in about three hours, so they are cached
  per isolate for 30 minutes and never written to KV or sent as a token to a device. Precedence is
  `ATV_GDRIVE_MAP` secret, then `torbox_map`, then KV `gdrive_map`.
- **Google Drive has no direct-play URL.** The agreed approach is a Worker proxy with signed URLs and
  Range passthrough. It is not built yet; do not "just use the Drive link" instead.
- **Sandbox first.** `pnpm deploy` targets `atv-core-v2`. The live `atv-core-orchestrator` is not built
  from this repo, deploying over it drops D1, `REMOTE_HUB`, telemetry and the admin token, and
  `docs/production-cutover.md` is the plan for changing that.
- **The APK is a release asset**, not repo content: `.github/workflows/android.yml` publishes
  `atv-launcher.apk` on the `atv-launcher-latest` release, and `/install` links to
  `/releases/latest/download/`.

## Strategy: reuse, then stitch, then build

The default answer to "how do we do X" is an established component that already does X, wired into
this repo. A fresh implementation is the exception and needs its reason written down.

1. **Platform first.** Cloudflare Workers/KV/Durable Objects, Android's own framework APIs, GitHub's
   official actions. Already paid for, already reliable, already documented.
2. **Established library second.** Maintained, permissive, current. Choose on: smallest surface (few
   dependencies, no native code, runs in workerd), most real users, clearest licence.
3. **Stitch third.** Compose those pieces behind a thin adapter of ours. Our adapters connect things;
   they do not reimplement them.
4. **Build last, and say why** in the commit body: no maintained option exists, the licence is
   incompatible, the runtime cannot support it, or it would cost more than it saves.

Prefer editing an existing file to adding one, and one file per concern.

### Licence rules

- **Allowed without asking:** MIT, ISC, BSD-2/3-Clause, Apache-2.0, MPL-2.0, Unlicense/CC0.
- **Ask the operator first:** LGPL, EPL, GPL, AGPL (network copyleft reaches a hosted Worker),
  CC-BY-SA, custom or dual licences, and anything that calls a paid API.
- **Never:** unlicensed or source-available-only code, snippets from a blog or Gist with no licence
  attached, or a vendored blob whose upstream commit is not recorded.

A new dependency is also a supply-chain and cold-start cost, so keep the set small. Record it with the
same caret range the repository uses, let `pnpm-lock.yaml` pin the exact version, keep CI on
`--frozen-lockfile`, and name its licence in the commit when it is outside the allowed list. Do not
upgrade unrelated dependencies in the same change.

## Verify before you believe

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
pnpm run build:deploy && pnpm run ci:worker   # for anything the Worker serves
```

Run the checks that cover what you changed, not every check every time. Report a path you could not
exercise — no TV, no token, no account — as untested rather than as working. When filtering output
through a pipe, keep the tested command's exit status.

## Git workflow

`main` is the integration branch: every finished change lands on it. Nothing else is deployed
automatically, and the Android workflow publishing the APK on an `android/` change is expected
automation, not an exception to the deploy rules below.

- Imperative subject line; the body says **why**, not what the diff already shows.
- One logical change per commit; no AI attribution or co-author trailers.
- Pull before you start and again before you push. Pushes are non-force by design.
- After pushing, watch the `verify` run (and `Android APK` when `android/` changed). A green result
  means the run reported success, not that it was queued.

Working alongside another agent:

- Own only the paths your task names. If the change needs another area, say so before touching it.
- A second instance works on a branch and opens a pull request instead of pushing `main`.
- Treat another agent's commits and branches as read-only. Never force-push or rewrite published
  history, including your own.

## Boundaries

**Always**

- Run the checks for the area you touched, then commit and push the finished change.
- Keep `main` green; fix a red `verify` before starting anything new.
- Log and print counts and ids, never links or tokens.
- Update `README.md` or `docs/` when a command, route or behaviour changes.

**Ask first**

- Any new dependency outside the licence list, and any new service or API — even a free tier.
- Anything that changes a public shape: `/api/*` fields, KV key shapes, `torbox_map`/`gdrive_map`
  entries, the release asset name.
- Deploying the sandbox, publishing a release by hand, changing workflows or deploy config, adding a
  nested `AGENTS.md`.
- Anything that spends money or changes a Cloudflare plan or limit.

**Never**

- Deploy production: no `ATV_ALLOW_PROD_DEPLOY=1 pnpm deploy:prod`, no `ATV_ALLOW_SHARED_KV=1`, no
  deploy at `atv.acidwurx.org`.
- Commit `atv-config.json`, stream URLs, tokens, keystores or `.env`.
- Force-push, rewrite history, or edit another agent's branch.
- Add D1, R2, Queues or a paid API to this Worker. Production's D1 belongs to the incumbent Worker, not
  to this repository.
- Delete KV keys or run `seed --prune` against production namespaces.
- Invent a provider, a stream source, or a credential that does not exist.
