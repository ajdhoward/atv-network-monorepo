# Uptime: knowing the Worker is down before a TV does

Health is only checked when a person runs `pnpm smoke`, so a dead guide is currently found by someone standing
in front of the TV. One free external monitor closes that gap (Q3). Nothing here is in the repository except
this page: the monitor lives in the operator's account, and it needs no credential from this Worker.

## The monitor

| Setting      | Value                                                                 |
| ------------ | --------------------------------------------------------------------- |
| Provider     | UptimeRobot, Free plan ($0, no card, 5-minute checks)                 |
| Monitor type | **Keyword** (not "HTTP(s)" — a status code is not evidence of health) |
| URL          | `https://atv-core-v2.acidwurx.workers.dev/api/health`                 |
| Interval     | 5 minutes                                                             |
| Keyword      | `"ok"` — **including the double quotes**                              |
| Alert when   | keyword is **not** found                                              |
| Alerts to    | your email, plus the UptimeRobot app if you install it                |

Health stays public after R8 — the household token guards `/api/resolve`, not `/api/health` — so no credential
of any kind goes to the monitor. If that ever changes, use an Access **bypass** policy for the health path
rather than putting a service token in the monitor.

## Why the keyword is `"ok"` and not `"status": "ok"`

A status code alone would call a broken deployment healthy: health answers `200` while reporting `degraded`,
which is what an unseeded namespace or a schema mismatch looks like, and a schema mismatch makes every guide
request a `503`.

The keyword must survive the body's formatting. `json()` in `services/atv-core/src/index.ts` currently
pretty-prints with `JSON.stringify(data, null, 2)`, so `"status": "ok"` matches today — but that spacing is an
implementation detail, and the day someone switches to compact output the monitor alerts forever. `"ok"` (with
its quotes) appears in both `"status": "ok"` and `"status":"ok"`, matches no key in the payload, and cannot
appear in the degraded body, whose only status value is `degraded`.

## What an alert means, in order

1. Open the URL. **No response or a 5xx** — the Worker or its route is down: check the Cloudflare dashboard for
   the deployment, then `pnpm exec wrangler tail --config wrangler.toml` for the failure.
2. **`"status": "degraded"`** — the Worker is up and the content is not. `config.seeded: false` means the KV
   namespace is empty (re-seed); `config.schemaMatches: false` means the seed and the Worker disagree on the
   schema version and every guide request is a 503.
3. **`"status": "ok"` but the monitor still alerts** — the monitor is misconfigured, not the Worker. It should
   be a keyword monitor looking for `"ok"`; a status-code monitor on this URL alerts on nothing.

`pnpm smoke <origin>` is still the fuller check: it exercises routes, the asset layer and the stream refusal,
which a keyword monitor cannot.

## At cutover

Repoint the monitor at the production host (`https://atv.acidwurx.org/api/health`) in the same sitting that
moves traffic, and keep the sandbox monitor for a day: two red monitors with one cause is cheaper than a silent
gap. If Access ends up in front of production, add the bypass policy above, or keep monitoring the sandbox and
write down that production's own health is unmonitored.
