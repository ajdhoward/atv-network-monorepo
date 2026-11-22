// Strict fixed-window limiter: one Durable Object instance per bucket key.
//
// The Workers Rate Limiting binding (`ATV_RATE_LIMITER`) is approximate: its
// counters live with the isolate in each Cloudflare location, so a burst spread
// over locations never tripped it (419 requests at concurrency 40, zero 429s).
// A Durable Object is created in a single location and its requests are gated,
// so a count kept here is the real per-window total for that key.
//
// The window is written before the decision is returned: an eviction between
// requests must not refund an allowance, and a fresh instance must see the same
// count. That is one read plus one write per request, which is fine at 300/min.
//
// The alarm clears the counter once the window is over, so an idle key neither
// keeps storage around nor keeps this object resident.

export type LimitDecision = {
  success: boolean;
  // Seconds until the window ends. Zero while the caller is still allowed.
  retryAfterS: number;
};

type Window = { start: number; count: number };

function decision(success: boolean, retryAfterS = 0): Response {
  return new Response(JSON.stringify({ success, retryAfterS } satisfies LimitDecision), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export class RateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const limit = Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 1));
    const windowMs = Math.max(1000, (Number(url.searchParams.get("window")) || 60) * 1000);

    // Concurrent requests to one object may interleave at an await, and this is
    // a read-modify-write: without the gate two requests in flight would both
    // read the old count and persist the same increment.
    return this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const stored = await this.state.storage.get<Window>("window");
      const window: Window =
        stored && now - stored.start < windowMs ? stored : { start: now, count: 0 };
      window.count += 1;
      await this.state.storage.put("window", window);

      if (window.count > limit) {
        const retryAfterS = Math.max(1, Math.ceil((window.start + windowMs - now) / 1000));
        return decision(false, retryAfterS);
      }
      if (window.count === 1) {
        await this.state.storage.setAlarm(window.start + windowMs);
      }
      return decision(true);
    });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}
