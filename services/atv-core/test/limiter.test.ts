import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/limiter";

// In-memory stand-in for the object's state. blockConcurrencyWhile chains its
// callbacks like the real input gate: two runs never interleave.
function fakeState() {
  const store = new Map<string, unknown>();
  let alarmAt: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const state = {
    storage: {
      async get(key: string) {
        return store.get(key);
      },
      async put(key: string, value: unknown) {
        store.set(key, value);
      },
      async setAlarm(at: number) {
        alarmAt = at;
      },
      async deleteAll() {
        store.clear();
        alarmAt = null;
      },
    },
    blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
      const run = queue.then(fn, fn);
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };

  return {
    state: state as unknown as DurableObjectState,
    store,
    alarm: () => alarmAt,
  };
}

function request(limit: number, window = 60): Request {
  return new Request(`https://limiter.internal/check?limit=${limit}&window=${window}`);
}

async function check(limiter: RateLimiter, limit: number, window = 60) {
  const res = await limiter.fetch(request(limit, window));
  return (await res.json()) as { success: boolean; retryAfterS: number };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RateLimiter", () => {
  it("allows exactly the limit and reports the rest of the window on the next request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
    const limiter = new RateLimiter(fakeState().state);

    for (let i = 0; i < 3; i++) {
      expect(await check(limiter, 3)).toEqual({ success: true, retryAfterS: 0 });
    }

    vi.advanceTimersByTime(30_000);
    expect(await check(limiter, 3)).toEqual({ success: false, retryAfterS: 30 });
  });

  it("starts a fresh window once the period has elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
    const limiter = new RateLimiter(fakeState().state);

    expect((await check(limiter, 1)).success).toBe(true);
    expect((await check(limiter, 1)).success).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect((await check(limiter, 1)).success).toBe(true);
  });

  it("counts concurrent requests without losing an increment", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
    const limiter = new RateLimiter(fakeState().state);

    const results = await Promise.all(Array.from({ length: 10 }, () => check(limiter, 5)));

    expect(results.filter((r) => r.success)).toHaveLength(5);
    expect(results.filter((r) => !r.success)).toHaveLength(5);
  });

  it("keeps the count across instances via storage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
    const { state, store } = fakeState();

    const first = new RateLimiter(state);
    expect((await check(first, 3)).success).toBe(true);
    expect((await check(first, 3)).success).toBe(true);

    // A cold instance after an eviction reads the same window.
    const second = new RateLimiter(state);
    expect((await check(second, 3)).success).toBe(true);
    expect((await check(second, 3)).success).toBe(false);
    expect((store.get("window") as { count: number }).count).toBe(4);
  });

  it("sets an alarm for the end of the window and clears it when it fires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
    const { state, store, alarm } = fakeState();
    const limiter = new RateLimiter(state);

    await check(limiter, 1);
    expect(alarm()).toBe(Date.parse("2026-11-22T00:01:00.000Z"));

    await limiter.alarm();
    expect(store.size).toBe(0);
    expect(alarm()).toBeNull();
    expect((await check(limiter, 1)).success).toBe(true);
  });
});
