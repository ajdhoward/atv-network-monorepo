# Rotating the household token and the stream signing key

The two Worker secrets that gate something are `ATV_DEVICE_TOKEN` (`/api/resolve`) and
`ATV_STREAM_SIGNING_KEY` (`/api/stream`'s tickets). This is how to replace either one without stranding the
household, and how to put it back if the replacement goes wrong. It names secrets and never holds one.

It is the second half of [`r8-rollout.md`](r8-rollout.md): that runbook sets `ATV_DEVICE_TOKEN` for the first
time, this one replaces it. Production's secrets move only inside
[`production-cutover.md`](production-cutover.md).

## What each secret does, and why the two rotations differ

| Secret                   | Guards                | Stored where                     | Rotation cost                                    |
| ------------------------ | --------------------- | -------------------------------- | ------------------------------------------------ |
| `ATV_DEVICE_TOKEN`       | `/api/resolve`        | each TV's local storage + Worker | every TV must be retyped by hand, once           |
| `ATV_STREAM_SIGNING_KEY` | `/api/stream` tickets | Worker only                      | nothing on any device; at most one film restarts |

Both are checked per request, so a rotated value takes effect on the next request — there is no cache, no
session and nothing else to clear.

- **`ATV_DEVICE_TOKEN` is one shared token, not one per TV.** `checkDeviceToken` compares a digest of the
  bearer header with the secret. There is no device identity, no session table and no way to revoke one TV
  except by replacing the value every TV holds. That is the decision (option C in `decisions.md`), and it is
  why this rotation is a walk around the house rather than a click.
- **`ATV_STREAM_SIGNING_KEY` signs one-hour tickets, over `id` + `exp`.** Rotating it turns every URL already
  handed out into a `403` (its signature no longer verifies). A TV that is playing when the key changes will
  fail its next `Range` and re-resolve; a paused film loses its position, the same way an expired ticket did
  before P4 lengthened the life. Rotate it when nothing is playing.

## When to rotate

Rotate the **household token** when:

- a TV is sold, given away, or leaves the house with the app installed and the token stored;
- the value has been typed on a device someone else can see (a screen share, a stream, a photo), or pasted
  into a shell whose history you do not control, a chat, or an issue;
- someone who knew it should no longer be able to resolve links.

Rotate the **signing key** when a `/api/stream/...` URL may have leaked (a screenshot of a player, a proxy
log, a referrer) — or on a schedule, because it costs nothing on any device. Rotating it also ends a ticket
that is still valid but should not be.

If both must go — a lost TV, or an unknown compromise — do the signing key first, then the household token.

## Household token: rotate

The order is **secret first, then TVs**, which is the reverse of R8's first-time order. R8 sets the secret
last because the prompt only exists in a client that has to be deployed and installed first; on a rotation
that client is already on every TV, and the prompt opens on the `401` the new secret creates. Typing the new
value before the secret exists cannot work: the old token still resolves, so nothing asks, and the new one
would be refused.

### 1. Have the new value ready

```bash
openssl rand -hex 8     # 16 characters — typable on a remote, 64 bits of entropy over HTTPS
```

No whitespace anywhere: `Bearer` carries one token (`\S+`), so a value with a space can never be accepted
and the Worker answers `503 device_token_invalid` rather than blaming the typist. Put the new value in the
password manager entry now, and keep the old one there until the walk is finished — it is the back-out.

Write down the TVs you are about to visit, with how you will reach Apps2Fire, Downloader or `adb`. A TV you
forget keeps the old token and will prompt the next time it plays; it is not stranded, because the prompt
attempts to repair it, but somebody has to be in front of it.

### 2. Replace the secret on the Worker

```bash
read -rs ATV_DEVICE_TOKEN && export ATV_DEVICE_TOKEN    # paste at the silent prompt, not into history
printf '%s' "$ATV_DEVICE_TOKEN" | pnpm exec wrangler secret put ATV_DEVICE_TOKEN --config wrangler.toml
```

Dashboard equivalent: Workers → `atv-core-v2` → Settings → Variables and Secrets → edit `ATV_DEVICE_TOKEN`.
Secrets survive deploys; this repository holds only the name.

From this moment every TV's stored value is wrong, and the next channel press on any of them answers `401`.

### 3. Update the repository secret in the same sitting

GitHub → Settings → Secrets and variables → Actions → `ATV_DEVICE_TOKEN`, same value. The deploy workflow
passes it to its sandbox smoke step (Q9); if the repository keeps the old value, the next deploy succeeds and
then fails that check with a `401` it cannot explain.

### 4. Walk the TVs

On each TV, press a channel. The client gets `401` and opens the **Household token** dialog saying _That
token was not accepted._ Type the new value and press Enter; the client saves it and retries the channel it
was trying. Back cancels and leaves the error screen — pressing the channel again reopens the dialog.

### 5. Check

```bash
BASE=https://atv-core-v2.acidwurx.workers.dev
ID=$(curl -sS "$BASE/api/guide?limit=1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).channels[0].id))')

curl -sS -o /dev/null -w 'headerless:%{http_code}\n' "$BASE/api/resolve?id=$ID"                       # 401
curl -sS -o /dev/null -w 'new token:%{http_code}\n' -H "Authorization: Bearer $ATV_DEVICE_TOKEN" "$BASE/api/resolve?id=$ID"
```

Never print a resolve body: it carries the stream link. Then:

- `pnpm smoke "$BASE"` with `ATV_DEVICE_TOKEN` exported — every check, including resolve, passes.
- `pnpm exec wrangler tail atv-core-v2 --format json` while each TV plays: `200`s, not `401`s.
- Dashboard → Analytics Engine → dataset `atv_metrics`: `resolve_unauthorized` should stop climbing once the
  walk is done. A step still climbing is the TV you have not reached.
- On one TV, relaunch and press the same channel: it plays without asking, which proves that device stored
  the new value.

### 6. Back out

Put the old value back — the one from step 1:

```bash
read -rs ATV_DEVICE_TOKEN && export ATV_DEVICE_TOKEN    # the OLD value this time
printf '%s' "$ATV_DEVICE_TOKEN" | pnpm exec wrangler secret put ATV_DEVICE_TOKEN --config wrangler.toml
```

TVs that have not been retyped go back to working with no action. TVs that were retyped hold the new value,
so they now prompt once more and need the old value typed. Update the repository secret back too.

If the old value is gone, the back-out is not a restore — it is enforcement off:
`pnpm exec wrangler secret delete ATV_DEVICE_TOKEN --config wrangler.toml` (R8 Step 3's back-out). That
answers every resolve while it is unset, which is safe for availability and wrong for privacy; prefer holding
the old value until the walk is finished.

## Stream signing key: rotate

Nothing on any device changes, so this is the cheap rotation.

### 1. Have the new value ready

```bash
openssl rand -hex 32
```

No whitespace requirement here (it never travels in a header), but the same rule applies: password manager
or secret store only. Keep the old value until the check passes.

### 2. Replace the secret

```bash
read -rs ATV_STREAM_SIGNING_KEY && export ATV_STREAM_SIGNING_KEY
printf '%s' "$ATV_STREAM_SIGNING_KEY" | pnpm exec wrangler secret put ATV_STREAM_SIGNING_KEY --config wrangler.toml
```

Dashboard equivalent: same place as the other secret.

Every ticket minted under the old key stops verifying immediately: `/api/stream` answers `403 bad-signature`
(the signature does not match; the route counts it as `stream_forbidden`), a player fails that source and the
client resolves again, which mints a ticket under the new key. A playing TV recovers on its own; a paused one restarts the film.

### 3. Check

- `curl -sS "$BASE/api/health"` reports `"streamSigningKeySet": true` (presence only, and it was already true).
- `pnpm smoke "$BASE"` now expects `403 missing` for a ticketless `/api/stream` instead of `503
stream_unconfigured`; both are honest answers, but the first is the one a configured deployment gives. A
  ticket signed with the retired key is the one to watch in the log: `403 bad-signature`.
- A Drive-backed channel plays. `pnpm streams --probe` follows the links for every id, which is the check that
  matters when the key is what changed (`--probe` needs the local lineup or `--ids`).
- `pnpm exec wrangler tail atv-core-v2 --format json` shows `/api/stream` answering `200`/`206`, not `403`.

### 4. Back out

Put the old key back the same way. Tickets minted under the new key stop verifying, so a TV that is mid-film
restarts once; no device needs a visit and nothing else changes. Deleting the secret instead leaves a loud
deployment fault, not a silent one: resolve answers `503 stream_unconfigured` for Drive ids (P5) and
`/api/stream` answers `503 stream_unconfigured`, which `pnpm smoke` reports by name.

## Rotating both

1. Signing key first (step 2 above): instant, no device work, ends every outstanding media URL.
2. Household token second (step 2 above), then the repo secret, then the TV walk.
3. `pnpm smoke "$BASE"` with the new token exported once, at the end.

## What this cannot do

- **Revoke one TV.** There is no per-device identity; rotation replaces the value for every TV at once, and a
  TV that is offline during the walk simply prompts the next time it plays.
- **Tell you which TVs still hold the old value.** The only evidence is `resolve_unauthorized` climbing in
  Analytics Engine, or `wrangler tail` showing a `401` while a TV plays.
- **Keep the position of a film paused across a signing-key rotation.** That is P4's remaining behaviour, and
  it is a restart, not a fault.

## Where the values live

Names only, and `pnpm continuity` checks the inventory: see
[`continuity.md`](continuity.md#secret-name-inventory). Both Worker secrets are set per deployment — the
sandbox from `wrangler.toml`, production from `wrangler.production.toml` — so a rotation is done twice if both
are live, and the sandbox and production may deliberately hold different values.
