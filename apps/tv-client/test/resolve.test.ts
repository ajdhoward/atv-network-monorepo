import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETRY_MS,
  MAX_RETRY_MS,
  resolveChannel,
  resolveWithRetry,
  retryAfterMs,
} from "../src/resolve.js";

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

// A fresh response per call: a Response body can only be read once.
function stubFetch(...responses: Response[]) {
  return vi.fn(async () => responses.shift() ?? response(500, { error: "exhausted" }));
}

const asFetch = (stub: ReturnType<typeof stubFetch>) => stub as unknown as typeof fetch;

describe("retryAfterMs", () => {
  it("reads delta-seconds", () => {
    expect(retryAfterMs(response(429, {}, { "Retry-After": "7" }))).toBe(7_000);
  });

  it("falls back to a sane pause when the header is absent or junk", () => {
    expect(retryAfterMs(response(429, {}))).toBe(DEFAULT_RETRY_MS);
    expect(retryAfterMs(response(429, {}, { "Retry-After": "soon" }))).toBe(DEFAULT_RETRY_MS);
  });

  it("caps a long delay and clamps a past HTTP date to zero", () => {
    expect(retryAfterMs(response(429, {}, { "Retry-After": "3600" }))).toBe(MAX_RETRY_MS);
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(retryAfterMs(response(429, {}, { "Retry-After": past }))).toBe(0);
  });
});

describe("resolveChannel", () => {
  it("returns the stream url and encodes the channel id", async () => {
    const fetchImpl = stubFetch(response(200, { url: "https://cdn.example/x.m3u8" }));
    const result = await resolveChannel("news/us", asFetch(fetchImpl));

    expect(result).toEqual({ kind: "ok", url: "https://cdn.example/x.m3u8" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/resolve?id=news%2Fus", {
      headers: { accept: "application/json" },
    });
  });

  // Option C: the client carries the household token. A 401 is about the token, not
  // the channel, so it must not read as "unavailable".
  it("sends the household token when there is one", async () => {
    const fetchImpl = stubFetch(response(200, { url: "https://cdn.example/x.m3u8" }));

    await resolveChannel("news-us", asFetch(fetchImpl), "household-secret");

    expect(fetchImpl).toHaveBeenCalledWith("/api/resolve?id=news-us", {
      headers: { accept: "application/json", Authorization: "Bearer household-secret" },
    });
  });

  it("sends no Authorization header without a token", async () => {
    const fetchImpl = stubFetch(response(200, { url: "https://cdn.example/x.m3u8" }));

    await resolveChannel("news-us", asFetch(fetchImpl), null);

    expect(fetchImpl).toHaveBeenCalledWith("/api/resolve?id=news-us", {
      headers: { accept: "application/json" },
    });
  });

  it("reports a 401 as unauthorized", async () => {
    const fetchImpl = stubFetch(response(401, { code: "unauthorized" }));

    expect(await resolveChannel("news-us", asFetch(fetchImpl), null)).toEqual({
      kind: "unauthorized",
    });
  });

  it("reports a 429 as retry rather than unavailable", async () => {
    const fetchImpl = stubFetch(response(429, { code: "rate_limited" }, { "Retry-After": "7" }));

    expect(await resolveChannel("news-us", asFetch(fetchImpl))).toEqual({
      kind: "retry",
      afterMs: 7_000,
    });
  });

  it("reports other failures as unavailable", async () => {
    const fetchImpl = stubFetch(response(404, { code: "not_found" }));

    expect(await resolveChannel("news-us", asFetch(fetchImpl))).toEqual({ kind: "unavailable" });
  });

  it("reports a resolve without a url as missing", async () => {
    const fetchImpl = stubFetch(response(200, { id: "news-us" }));

    expect(await resolveChannel("news-us", asFetch(fetchImpl))).toEqual({ kind: "missing" });
  });
});

describe("resolveWithRetry", () => {
  it("waits out a 429 and returns the retried stream", async () => {
    const fetchImpl = stubFetch(
      response(429, {}, { "Retry-After": "30" }),
      response(200, { url: "https://cdn.example/x.m3u8" }),
    );
    const wait = vi.fn(async () => {});
    const onRetry = vi.fn();

    const result = await resolveWithRetry("news-us", {
      fetchImpl: asFetch(fetchImpl),
      wait,
      onRetry,
    });

    expect(result).toEqual({ kind: "ok", url: "https://cdn.example/x.m3u8" });
    // The advertised 30 s is capped at the default 5 s so the grid is not stuck.
    expect(wait.mock.calls).toEqual([[DEFAULT_RETRY_MS]]);
    expect(onRetry.mock.calls).toEqual([[30_000, DEFAULT_RETRY_MS]]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses a shorter Retry-After as-is", async () => {
    const fetchImpl = stubFetch(
      response(429, {}, { "Retry-After": "2" }),
      response(200, { url: "https://cdn.example/x.m3u8" }),
    );
    const wait = vi.fn(async () => {});

    await resolveWithRetry("news-us", { fetchImpl: asFetch(fetchImpl), wait });

    expect(wait.mock.calls).toEqual([[2_000]]);
  });

  it("gives up after the configured attempts and says the channel is busy", async () => {
    const fetchImpl = stubFetch(response(429, {}), response(429, {}), response(429, {}));
    const wait = vi.fn(async () => {});

    const result = await resolveWithRetry("news-us", {
      fetchImpl: asFetch(fetchImpl),
      wait,
      attempts: 1,
    });

    expect(result).toEqual({ kind: "retry", afterMs: DEFAULT_RETRY_MS });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 401: only a new token fixes it", async () => {
    const fetchImpl = stubFetch(response(401, {}));
    const wait = vi.fn(async () => {});

    const result = await resolveWithRetry("news-us", { fetchImpl: asFetch(fetchImpl), wait });

    expect(result).toEqual({ kind: "unauthorized" });
    expect(wait).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not wait on a failure that a retry cannot fix", async () => {
    const fetchImpl = stubFetch(response(404, {}));
    const wait = vi.fn(async () => {});

    const result = await resolveWithRetry("news-us", { fetchImpl: asFetch(fetchImpl), wait });

    expect(result).toEqual({ kind: "unavailable" });
    expect(wait).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
