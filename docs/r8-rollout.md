# R8 rollout runbook: serve the client, enforce the household token

This is the operator's runbook for R8 in [`agents/backlog.md`](agents/backlog.md): put the identity-checked
client in front of the household, then turn on `ATV_DEVICE_TOKEN` on the sandbox Worker. It names secrets and
never holds one — no value, no token, no stream link. Every command here is one the operator runs. The ones
that need no credentials were exercised on 2026-11-24 against a local `wrangler dev` started with a plain
`--var ATV_DEVICE_TOKEN:` test value (no deploy, no secret): the health snapshot and its parse, the status
checks, the guide-id derivation, the headerless `401` carrying `WWW-Authenticate: Bearer realm="atv"`, the
with-token `200`, all three Step 5 curls, and `pnpm smoke` with and without the token (18/18 and 17/18).
`wrangler secret put`/`delete` and `wrangler tail` were not run — they need the operator's credentials — and
no step has been run against the sandbox or a TV.

Target: the sandbox `atv-core-v2` (`wrangler.toml`). Production is not touched by any step here; moving
`atv.acidwurx.org` is [`production-cutover.md`](production-cutover.md) and nothing else.

## The one ordering rule

**The client goes on every TV before the secret is set.** The TV takes its token from a prompt that only
opens when `/api/resolve` answers `401` (`apps/tv-client/src/main.ts`, `tokenPrompt.ts`), so a TV running a
build from before R5 has no way to take a token: setting the secret first strands it on a screen that says
the channel is unavailable, recoverable only by re-sideloading the APK or deleting the secret.

This is the correction to the older rule "enforcement must never land before every TV has taken the token".
Read literally it asks for the token before the secret that makes the prompt appear, which no TV can do: the
prompt is the taking, so it is the client that carries the prompt that has to be everywhere first, and the
token is typed after the secret, one TV at a time. This runbook is the authority on that order; `AGENTS.md`
and the R1 record in `decisions.md` both summarise it as _client first, secret second_ and point here.

## Before you start

- [ ] `main` is green: the `verify` run for the commit you will deploy reported success.
- [ ] The APK you intend to install is on the `atv-launcher-latest` release (`GET /a` 302s to it).
- [ ] You can reach the Cloudflare dashboard for account `d9491f1ab703e0a99b69919230410f2a`, Workers →
      `atv-core-v2`, and GitHub Actions on this repository.
- [ ] You have a list of the TVs to set up, and physical access to each one this session.
- [ ] The token exists and is in your password manager: any long random string, one shared by every TV.
      Generate one now if it does not exist, and never paste it into chat, a commit, or a command line that
      lands in shell history:

  ```bash
  openssl rand -hex 32          # paste the output into the password manager
  ```

- [ ] You know how to reach each TV: Apps2Fire/Bugjaeger from a phone, Downloader on the TV, or `adb`.

Record the starting state so a rollback has something to compare against:

```bash
BASE=https://atv-core-v2.acidwurx.workers.dev
curl -sS "$BASE/api/health" > /tmp/atv-health-before.json
node -e 'const h=require("/tmp/atv-health-before.json"); console.log({status:h.status, channels:h.config.channels, deviceTokenSet:h.deviceTokenSet, streamSigningKeySet:h.streamSigningKeySet})'
git rev-parse HEAD                                      # the commit you are deploying
```

Keep that file. It holds counts and flags only, no links and no secrets.

## Step 1 — Deploy the client (L1)

The Worker serves the TV client and the admin panel as assets, so deploying it is what makes `/install` and
the R5 client reachable. Choose one route:

**GitHub Actions (preferred — it runs the same gates as CI):** Actions → **Deploy** → _Run workflow_ →
target **v2**. The job provisions the staging KV namespaces, deploys `atv-core-v2`, seeds only if the
repository secret `ATV_SEED_CONFIG` is present, and smokes the deployment URL with `--allow-empty`.

**Local, with an authenticated wrangler:** `pnpm deploy` (runs `kv:staging`, the deploy-target guard and
`build:deploy`, then deploys `wrangler.toml`).

### Check

```bash
BASE=https://atv-core-v2.acidwurx.workers.dev

curl -sS -o /dev/null -w 'install:%{http_code}\n' "$BASE/install"     # expect 200
curl -sS -o /dev/null -w 'admin:%{http_code}\n'   "$BASE/admin/"     # expect 200
curl -sS -o /dev/null -w 'client:%{http_code}\n'  "$BASE/"           # expect 200

pnpm smoke "$BASE" --allow-empty
```

`smoke` must pass every route. If the lineup is still empty the guide check reports zero channels, which
`--allow-empty` allows by design; a broken route still fails. Confirm the client build is the one that
expects a token: the shell is a WebView, so the bundle is live, and a TV that loads the app now runs the
current client.

### Back out

Dashboard → Workers & Pages → `atv-core-v2` → **Deployments** → the previous version → **Rollback**. The KV
namespaces and secrets are untouched, so a rollback is seconds and loses nothing. Re-check `/api/health` and
`pnpm smoke "$BASE" --allow-empty` after it.

## Step 2 — Prove every TV is running this Worker's client

Do this on **every** TV before Step 3. A TV missed here is the one that gets stranded.

An installed app needs **no reinstall**: it bundles nothing and loads `BuildConfig.ATV_BASE_URL` on every
launch, and the Worker serves its assets with `max-age=0, must-revalidate`, so a TV that already has the app
pointed at this Worker is running the client Step 1 just deployed. What can go wrong is not a stale client,
it is an app pointed at the **wrong** Worker: the origin is compiled into the APK
(`android/app/build.gradle`, `-PatvBaseUrl` locally or the `ATV_BASE_URL` repository variable in CI), so an
app built against `atv.acidwurx.org` renders a guide that looks perfect from this deploy and never carries the
R5 prompt. That is the TV that gets stranded at Step 3, and "the guide renders" does not distinguish it.

1. Only for a TV that has never had the app: open `GET /install` on a phone or the TV browser, or type the
   short address `…workers.dev/a` in Downloader. The page carries the APK link, a QR, and the sideload steps.
2. If you do need to install over the previous build: when the APK is debug-signed with a fresh key (L3 not
   done), Android refuses to install over the old one and you must uninstall first, which clears the app's
   storage. Nothing is lost yet — there is no token to lose — but it is why an unnecessary reinstall is worth
   avoiding.
3. Launch the app. No token exists yet and none is asked for: the guide is public and the Worker is not
   enforcing.

### Check — evidence that this TV is talking to `$BASE`

- **The unseeded guide is itself the proof, while it lasts.** L4 (the real line-up) comes after this runbook,
  so a sandbox with no channels answers `"channels": 0` and the TV shows _No channels available right now._
  A TV showing channels at this step is on another Worker — production — and has to be rebuilt against
  `$BASE` before Step 3 rather than after.
- **`pnpm exec wrangler tail atv-core-v2` while you launch the app on that TV** (this needs the operator's
  credentials). The TV's `/api/guide` request appears in the tail; a TV that shows a guide and produces no
  request there is not talking to this Worker. Use this once the sandbox is seeded, when the empty-guide
  signal is gone.
- A channel that is expected to be configured plays — a Drive-backed channel still needs
  `ATV_STREAM_SIGNING_KEY`, which this runbook does not set.
- `curl -sS "$BASE/api/health"` still reports `"deviceTokenSet": false` — enforcement is not on yet, so a TV
  you have not reached yet is still failing safe.

### Back out

Reinstall the previous APK from the release if the new build misbehaves. The APK is only a WebView shell:
what actually changed is served by the Worker, so the real rollback for client behaviour is Step 1's
rollback, not the APK.

## Step 3 — Set `ATV_DEVICE_TOKEN` on the Worker

This is the switch. `checkDeviceToken` answers `unenforced` with no secret and only `allow`/`reject` with
one, so from this moment every `/api/resolve` without a bearer token is a `401`, for every TV at once.
Do it only after Step 2 is complete on every TV.

```bash
read -rs ATV_DEVICE_TOKEN && export ATV_DEVICE_TOKEN   # paste at the silent prompt; not in history
printf '%s' "$ATV_DEVICE_TOKEN" | pnpm exec wrangler secret put ATV_DEVICE_TOKEN --config wrangler.toml
```

The dashboard equivalent is Workers → `atv-core-v2` → Settings → Variables and Secrets → add
`ATV_DEVICE_TOKEN` as a secret. Either way the value is written once and survives deploys; this repository
holds only the name.

### Check

```bash
BASE=https://atv-core-v2.acidwurx.workers.dev
curl -sS -o /dev/null -w 'health:%{http_code}\n' "$BASE/api/health"
curl -sS "$BASE/api/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);console.log({deviceTokenSet:h.deviceTokenSet,streamSigningKeySet:h.streamSigningKeySet})})'
```

`deviceTokenSet` must now be `true`. Then prove both halves on one real channel id:

```bash
ID=$(curl -sS "$BASE/api/guide?limit=1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).channels[0].id))')
echo "id: $ID"     # an id is public; the resolved URL is not

curl -sS -o /dev/null -D - "$BASE/api/resolve?id=$ID" | grep -Ei '^(HTTP/|www-authenticate:)'   # expect 401 + Bearer realm="atv"
curl -sS -o /dev/null -w 'with token:%{http_code}\n' -H "Authorization: Bearer $ATV_DEVICE_TOKEN" "$BASE/api/resolve?id=$ID"
```

Expected: headerless `401` with `WWW-Authenticate: Bearer realm="atv"`, and `200` with the header. Never
print the resolve body — it contains a stream URL. `pnpm smoke "$BASE"` with `ATV_DEVICE_TOKEN` exported
must pass; without it, its resolve check now fails and says the worker is enforcing the household token,
which is the correct answer.

### Back out

Delete the secret; enforcement disappears immediately because there is no second switch:

```bash
pnpm exec wrangler secret delete ATV_DEVICE_TOKEN --config wrangler.toml
# or: dashboard → Settings → Variables and Secrets → delete ATV_DEVICE_TOKEN
```

Re-check: `/api/health` reports `deviceTokenSet:false` and a headerless resolve answers `200` again. TVs
keep the tokens stored in local storage; they are simply not asked for them, so nothing needs undoing on
the devices.

## Step 4 — Enter the token on each TV

On each TV, press a channel. `/api/resolve` answers `401` and the client opens the **Household token**
dialog:

- _"This TV has no household token yet."_ — first setup on this TV.
- _"That token was not accepted."_ — a different token is already stored, or it was typed wrong.

Type the token with the remote, then Enter. The client saves it in local storage and retries the channel
that hit the 401. Back cancels the dialog, leaving the TV on the error screen; pressing the channel again
reopens it.

### Check

- The channel plays after Enter.
- Relaunch the app, press the same channel again: it plays without asking. That is the stored token being
  used, and it is the per-TV proof that this device is now sending the header.
- If the dialog says the token was not accepted, it is a mismatch, not a broken channel: re-enter the value
  from the password manager. A TV that cannot save it says so — its storage is off or full, and it will ask
  again on the next launch.

### Back out

Nothing to undo on the worker. If a TV must be cleared, clear the app's storage (uninstall, or Android
Settings → Apps → storage) and it will ask for the token again. Deleting the secret (Step 3's back-out)
also makes every stored token irrelevant.

## Step 5 — Confirm the enforcement holds

Enforcement is the default once the secret exists, so this step is evidence, not a switch:

```bash
# BASE and ID again, so this block runs in a fresh shell; ID is public.
BASE=https://atv-core-v2.acidwurx.workers.dev
ID=$(curl -sS "$BASE/api/guide?limit=1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).channels[0].id))')

# Every headerless resolve is refused, before the limiter and before any provider call.
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/resolve?id=$ID"          # 401
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/resolve?ids=$ID"         # 401 (batch too)
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer wrong-token' "$BASE/api/resolve?id=$ID"   # 401
```

Then watch for rejections that should not be there. Every rejection increments `resolve_unauthorized`
(`services/atv-core/src/index.ts`), written to the `ATV_METRICS` Analytics Engine dataset as event
`resolve_unauthorized`. Two ways to see it:

- `npx wrangler tail atv-core-v2 --format json` while someone tunes on each TV: the resolves should be 200s,
  and a 401 means a TV (or something else on the LAN) is still headerless.
- Dashboard → Workers & Pages → Analytics Engine → dataset `atv_metrics`, filtered to the
  `resolve_unauthorized` event. A handful around setup time is expected; a stream that keeps climbing means
  a TV you have not set up, or a wrong token on one.

Re-run the positive checks at the end:

```bash
pnpm smoke "$BASE"                         # with ATV_DEVICE_TOKEN exported
ATV_DEVICE_TOKEN="$ATV_DEVICE_TOKEN" pnpm streams    # ids and statuses only; needs the local lineup
```

`pnpm streams` reads `atv-config.json`; without that file it exits 1 with `Cannot read atv-config.json` and
offers `--ids a,b`, and it is not a substitute for the per-TV check. Neither command prints a link.

### Back out

Same as Step 3: delete the secret. If you only want to stop one TV, clear that TV's storage instead; it
stops sending the header and is shown the prompt again.

## Close out

1. Mark R8 done in [`agents/backlog.md`](agents/backlog.md) with the date, and note anything you learnt the
   next session would otherwise rediscover.
2. Update the roster row and `docs/agents/context/buffy.md` — what was deployed, when, and what is left.
3. `unset ATV_DEVICE_TOKEN` in that shell, and make sure the value is only in your password manager and the
   Worker secret.
4. L4 (seed the real line-up and links) is now unblocked; it is a separate change with its own checks.

## If something goes wrong

| Symptom                                              | Likely cause                                              | Action                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A TV says the channel is unavailable, never a dialog | That TV is on another Worker, so it never got this client | Rebuild an APK with `ATV_BASE_URL=$BASE` (Step 2's check), or delete the secret |
| The dialog reappears on every launch                 | The WebView refused storage, or the token is not saved    | Check the TV's storage; uninstall/reinstall the app                             |
| Every channel 401s from a script but TVs play        | The script is not sending the header                      | Export `ATV_DEVICE_TOKEN` in that shell                                         |
| Headerless resolve still answers 200                 | The secret is not on this Worker, or a stale deployment   | Re-check `/api/health` `deviceTokenSet`, re-put the secret                      |
| Resolve 401s everywhere right after a deploy         | The secret survived, but the client did not               | Roll the deployment back (Step 1), then re-run Step 2                           |

## What this runbook does not cover

- **L4**, seeding the real line-up and stream links — deliberately last, after this.
- **P2**, the Drive service-account credential; a file not shared link-wide still answers `502`.
- `ATV_STREAM_SIGNING_KEY`, which the Drive proxy needs independently of this rollout.
- **Production.** Do not run these commands against `atv.acidwurx.org`; see `production-cutover.md`.
