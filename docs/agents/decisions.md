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

### 2026-11-24 — Does the Drive proxy break Cloudflare's video terms or plan limits?

- state: accepted
- proposed by: Buffy (Freebuff)
- touches: `docs/agents/decisions.md` only — no route, no code, no secret, no spend
- why: P1 makes `atv-core-v2` the origin of every video byte a TV watches. Cloudflare prohibited streaming
  video over its network for years (the retired §2.8 of the Self-Serve Subscription Agreement), so the risk
  is not a bug but a term: delivery limited or redirected after notice. The answer decides whether the proxy
  is a design we can keep or a stopgap to remove before L4 seeds real links.
- finding: §2.8 is gone — Cloudflare retired it in May 2023 and moved the substance into the CDN entry of its
  [Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-application-services/)
  ([the blog post](https://blog.cloudflare.com/updated-tos) says so in as many words). That entry reads: the
  CDN "can be used to cache and serve web pages and websites", and "unless you are an Enterprise customer,
  Cloudflare offers specific Paid Services (e.g., the Developer Platform, Images, and Stream) that you must
  use in order to serve video and other large files via the CDN", reserving the right to disable or limit
  CDN use for video or "a disproportionate percentage of pictures, audio files, or other large files" served
  without those services, with reasonable efforts at notice.
- reading: the terms name the Developer Platform, and Workers is the Developer Platform's compute product
  whose paid subscription is this account's Workers Paid plan — so the paid path the sentence requires is
  the one we are on. The bytes also leave through the Worker rather than the CDN cache: `run_worker_first`
  matches `/api/*`, and a Worker response is not cached by default (the only caching in this Worker is
  `s-maxage` on `/api/guide`, which is HTML-sized JSON). Plan limits are not close either: Workers Paid has
  no egress or bandwidth charge, no enforced response-body limit, 10M requests and 30M CPU ms a month for
  $5, and the proxy makes one subrequest per media request while handing back `upstream.body` instead of
  buffering it, so the CPU cost is header shaping. One player seeking through a film is tens of requests.
- caveat: this is a reading of public documents, not legal advice and not a statement by Cloudflare. It rests
  on two things that can change: staying on Workers Paid (the "must use a paid service" sentence has no
  answer for the Free plan), and household scale, since the enforcement language is about video and
  _disproportionate_ large files rather than any large file. Cloudflare has not published a sentence that
  squarely exempts uncached Worker responses, and a 2021 community reply read the old rule as covering
  bandwidth regardless of caching; the 2026 community thread asking this exact Google Drive proxy question
  answers with a 403 to an unauthenticated fetch, so nothing from it is recorded here. The
  [Delivering Videos](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/)
  page still lists only Stream and Enterprise Stream Delivery as ways to deliver video, but it is written
  about content on a zone's CDN, which is the entry the terms actually restrict.
- change: keep the proxy as built, and do not add caching to it — a cached media response would push the
  bytes through the CDN cache, which is the thing the terms do constrain, and the ticket is a 15-minute URL
  that must not be reused across viewers. If the deployment ever leaves the household or the account drops to
  Workers Free, re-read the CDN entry before scaling rather than assuming this reading still holds.
- risk: the harm to doing nothing is knowing too late; the harm to this reading being wrong is limited
  delivery with notice, recoverable by moving the media origin (Stream, R2, or P2's service account) rather
  than by rewriting the route. The gap a monitor cannot see — a deployment with no signing key, where P1 is
  silent — is now reported by `/api/health` as `streamSigningKeySet`.
- cost: none
- acks: no other agent active (`roster.md`), recorded as absence rather than consent.
- outcome: recorded at the operator's request (2026-11-24). No action follows; revisit on a plan change or if
  this deployment grows past one household.

### 2026-11-24 — Drive proxy: a signed stream URL per resolve

- state: accepted
- proposed by: Buffy (Freebuff)
- touches: `services/atv-core/src/` (`stream-sign.ts`, `stream.ts`, `resolver.ts`), `services/atv-core/src/index.ts`
  (a new `/api/stream/<id>` route), `wrangler.toml` (`run_worker_first`), Worker secret
  `ATV_STREAM_SIGNING_KEY`, `services/atv-core/test/`
- why: Drive has no direct-play URL, so a Drive-backed channel cannot play at all today — it resolves to 404
  and the household sees "no stream configured" for a channel that is configured. The alternatives are a
  link that expires in the player's hands or exposing the drive to the internet; both are worse than a
  proxy this Worker already has the runtime for.
- change: `/api/resolve` stops handing out a Drive link and returns a same-origin
  `/api/stream/<id>?exp=<unix>&sig=<hex>` instead, where `sig` is HMAC-SHA256 over `<id>\n<exp>` under
  `ATV_STREAM_SIGNING_KEY` and `exp` is 15 minutes out. `/api/stream` verifies the ticket (secret present,
  signature valid, id bound, not expired), then proxies `GET` to the Drive media endpoint with `Range`
  forwarded and answers 206 (or 200 for a whole-file request) with `Content-Range`, `Accept-Ranges`,
  `Content-Length` and `Content-Type`, `no-store` throughout, and `Access-Control-Allow-Origin: *`.
- why signed rather than the household token: a `<video src>` cannot send `Authorization` — that is the whole
  reason option C puts the token on resolve and not on media. The resolve call is already token-protected
  (R6), so only a TV holding the token can mint a ticket, and the ticket is useless for another id and dead
  after its expiry. Status codes stay distinct so the TV can tell them apart: 503 `unconfigured` (no secret),
  403 `bad-signature`/`expired`, 404 unknown id.
- risk: a proxy that skips the signature is an open door to the drive, and one that mishandles `Range` makes
  seeking fail in a player that otherwise plays — the second is the likelier bug, so the tests assert a
  mid-file 206 with the right `Content-Range` start, not just a 200. A leaked ticket is a leaked 15 minutes
  of one channel; the TTL is the lever if that is judged too long.
- cost: none — WebCrypto only, no dependency, no service. Size L, so the first file (`stream-sign.ts`) lands
  on its own, nothing calls it, and the route waits for this entry to be accepted.
- acks: no other agent active (`roster.md`), recorded as absence rather than consent.
- outcome: accepted — operator, 2026-11-24, unchanged. Built as written: `/api/stream/<id>` checks the
  ticket, re-reads the link, forwards `Range` and passes 206 headers through, and `/api/resolve` mints the
  ticket for a Drive link while leaving every other link alone. The design did not settle what resolve should
  do before the secret exists; it keeps answering the stored link (P1 changes nothing until
  `ATV_STREAM_SIGNING_KEY` is set), which P2 and R8's rollout order both depend on.

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
- removed: 2026-11-23 — the namespace exists, so this dispatch-only write path was deleted rather than left
  as an unused way to spend the deploy token. The id now lives only in `ajdhoward/mcp-onboard`'s
  `wrangler.toml`.

### 2026-11-23 — `/api/resolve` stays private with one household token, not with Access on the player

- state: accepted
- proposed by: Buffy (Freebuff)
- touches: `services/atv-core/src/index.ts` (`/api/resolve` auth check, `Access-Control-Allow-Headers`,
  `/api/health`), `services/atv-core/src/env.ts` (`ATV_DEVICE_TOKEN`), `apps/tv-client/src/` (token prompt,
  storage, header), `apps/admin-cms/src/links.ts`, `scripts/smoke.mjs`, `scripts/check-streams.mjs`,
  `docs/continuity.md` (secret name), backlog R1/L4 — `android/` only if the `adb` shortcut is kept
- why: `/api/resolve` answers any caller with a playable URL, and `/api/guide` publishes every id, so one
  `?ids=` sweep — a single limiter token, twenty channels — returns links for the whole network. Today that
  discloses nothing, because the sandbox holds no links. L4 seeds real ones, and L5 needs them on this host
  specifically: `atv-core-orchestrator` serves no assets, so the public workers.dev sandbox is the only host
  a Fire TV can play from. The question is therefore not whether real links sit behind a public host, but how
  much of them a stranger can pull. TorBox links expire in about three hours and cost an API call to mint; a
  Drive link can be durable and may be the access path to the file itself, so "it expires anyway" covers only
  half the lineup. Leaving it open also spends the per-IP limiter and the TorBox quota on other people's
  traffic.

| Option                                                      | Cost                                                                                                                              | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A · Keep the sandbox unseeded**                           | none — no code, no config                                                                                                         | It is a state, not a shape: nothing enforces it, and one `wrangler secret put ATV_GDRIVE_MAP` against `wrangler.toml` silently ends it. It also blocks L5, which is the only real playback test: production is not built from this repo, so keeping links off the public host means never verifying objective 1.                                                                                                                                                 |
| **B · Access in front of the host, service token**          | none — Zero Trust free covers 50 seats and includes service tokens; `smoke.mjs` already sends `CF-Access-*` when set; config only | The TV cannot use it: a WebView page load carries no custom header, and a token compiled into the client bundle is published to anyone who opens the JS. An email-OTP login on a D-pad is a re-entry whenever the Access session ends. It gates the app shell rather than just resolve, so it protects objective 3 by risking objective 1. Keep it for `/admin` and the control planes (Q5), not for the player.                                                 |
| **C · One household token on `/api/resolve`** (recommended) | M — one secret, one check, one CORS header, a token prompt in the served client, tests, docs. No dependency, no spend.            | The token is **one secret shared by every TV**, so it identifies the household, not a device: reading it off one TV yields links until the secret is rotated, no single TV can be revoked on its own, and rotation means re-entering the token on every TV. It also moves work — `apps/admin-cms`'s link check and `scripts/smoke.mjs` can no longer call resolve anonymously, so the audit becomes `pnpm streams` with the token in the operator's environment. |
| **D · Nothing beyond the limiter**                          | none                                                                                                                              | Every link is public for its lifetime, `?ids=` hands over the whole lineup in one request, and the limiter protects Cloudflare's request budget, not the links. The 2026-11-23 evaluation already recorded this as its one high finding.                                                                                                                                                                                                                         |

**Recommendation: C, with B kept for the control planes.** It is the only option that keeps the links
private without putting a login in front of the player, it costs nothing, and it revokes by rotating one
secret — every TV at once, which is the right granularity for one household. The price is honest and
small: a token typed once per TV, and an audit path that moves from the admin page to `pnpm streams`. A
and D are rejected because neither survives contact with L5: one forbids the only real playback test, the
other publishes what L4 is for. B is right for `/admin` and wrong for the guide.

- change: `/api/resolve` (single and `?ids=`) requires `Authorization: Bearer <ATV_DEVICE_TOKEN>` and answers
  `401 {error:"unauthorized",code:"unauthorized",requestId}` before it spends a limiter token or calls
  TorBox; `Authorization` joins `Access-Control-Allow-Headers`. The token is compared as a digest, never
  logged, and never accepted from a query string, where it would land in logs, analytics and referrers. The
  token is entered once in the **served client** and kept in its `localStorage`, not in the APK, because the
  shell loads the live client: client-side entry reaches installed TVs on their next load. One secret covers
  every TV; a per-TV secret is only worth adding if one TV ever has to be revoked alone, and then the secret
  becomes a `token → label` map. `/api/health` gains a boolean saying the token is configured, so an
  unset secret is a loud
  401 rather than a silent unauthenticated Worker. `/api/guide`, `/api/health`, `/install`, `/a`, `/join` and
  `/onboard` stay public. Revocation is `wrangler secret put ATV_DEVICE_TOKEN`.
- risk: every existing caller has to learn the header in the same change, or it breaks in a way that looks
  like a broken channel: `apps/tv-client/src/resolve.ts`, `playerManager.js`, `apps/admin-cms/src/links.ts`,
  `scripts/smoke.mjs`, `scripts/check-streams.mjs`, `scripts/ci-worker.mjs`. A 401 the TV paints as "retry"
  instead of "this TV needs its token" is the failure to design out, and unauthorised attempts must not spend
  the household's limiter allowance — they get their own counter, so a wrong token is visible instead of
  quietly eating the budget.
- rollout: enforcement has to land **after** the client that sends the header is live, or the change breaks the
  thing it protects. Delivery was checked rather than assumed (2026-11-23), and that half holds: `MainActivity`
  bundles nothing and loads `BuildConfig.ATV_BASE_URL` into a `WebView` with DOM storage on, the client
  registers no service worker anywhere, and Workers' asset default (`public, max-age=0, must-revalidate` plus
  an ETag; `public/_headers` overrides no cache header) makes `/` revalidate on every launch, where the bundle
  it names is a new hashed `/assets/*.js`. An installed APK therefore runs the new client on its next launch
  with no re-sideload — an APK-side entry would have stranded every installed TV until someone sideloaded
  again. Entry is the half that does not hold yet: the shell has no keyboard and no script bridge, so the
  token is typed through the Fire TV on-screen keyboard on a D-pad, and the client's single document-level
  `keydown` handler prevents default on Backspace, Enter, Escape and the arrows, so an `<input>` added without
  suspending it can neither be corrected nor submitted. The prompt therefore has to ship in the same client
  change (short grouped code, grid keys suspended while it is open, reachable again after a rotation),
  because if it is unusable the only fallback is re-sideloading every TV — the outcome this ordering exists to
  avoid. Sequence: deploy the client and the prompt, take the token on each TV, watch the metric for resolves
  that arrive without the header until it stops, then enforce. Enforcing first leaves every installed TV on a
  401 it cannot clear.
- cost: none — no dependency, no service, no spend. M of work; after it L4 can seed real links on the sandbox
  and L5 can test playback with a token.
- acks: operator (2026-11-23) — accepted option C. No other agent active (see `roster.md`), recorded as
  absence rather than consent.
- outcome: accepted — option C, operator, 2026-11-23. Split into backlog R5–R8; not enforced yet, so L4 still
  waits for R8.
