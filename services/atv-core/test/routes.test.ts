import { afterEach, describe, expect, it, vi } from "vitest";
import { checksum } from "../src/config-meta";
import type { Env } from "../src/env";
import { apkUrl } from "../src/install";
import { signStreamUrl } from "../src/stream-sign";

type Seed = Record<string, unknown>;

// Minimal KV stand-in: the Worker only reads JSON and writes the guide string.
function fakeKv(seed: Seed = {}) {
  const store = new Map<string, string>(
    Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  const kv = {
    async get(key: string, type?: string) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
  return { kv, store };
}

function makeEnv(seed: Seed = {}) {
  const config = fakeKv(seed);
  const cache = fakeKv();
  const env = {
    ATV_CONFIG: config.kv,
    ATV_CACHE: cache.kv,
    GITHUB_USERNAME: "test",
    SYSTEM_ENV: "test",
    ASSETS: {
      fetch: async () =>
        new Response("asset", { status: 200, headers: { "content-type": "text/plain" } }),
    },
  } as unknown as Env;
  return { env, config, cache };
}

// The guide memo is module state, so each test loads a fresh copy of the Worker.
async function freshWorker() {
  vi.resetModules();
  const mod = await import("../src/index");
  return mod.default;
}

async function call(worker: any, env: Env, path: string, init?: RequestInit) {
  const request = new Request(`https://atv.test${path}`, init);
  const res = await worker.fetch(request, env);
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { res, body };
}

const channels = [
  { id: "news-us", name: "US News", country: "US", category: "news", genre: ["news"] },
  { id: "sport-uk", name: "UK Sport", country: "UK", category: "sport", genres: ["sport"] },
];

const meta = (seedChannels: unknown[], overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  checksum: checksum(seedChannels),
  channels: Array.isArray(seedChannels) ? seedChannels.length : 0,
  updatedAt: "2026-11-21T00:00:00.000Z",
  ...overrides,
});

describe("GET /api/status", () => {
  it("reports the build environment from SYSTEM_ENV", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res, body } = await call(worker, env, "/api/status");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ name: "ATV Core", status: "live", env: "test" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("GET /api/health", () => {
  it("reports a seeded lineup", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels, config_meta: meta(channels) });
    const { res, body } = await call(worker, env, "/api/health");
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.config).toMatchObject({ seeded: true, channels: 2 });
    expect(body.schemaVersion).toBe(1);
  });

  it("degrades when the config schema is one the guide would refuse", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels, config_meta: meta(channels, { schemaVersion: 2 }) });
    const { body } = await call(worker, env, "/api/health");
    expect(body.status).toBe("degraded");
    expect(body.config).toMatchObject({ seeded: true, schemaMatches: false });
  });

  it("reports a checksum mismatch without changing the status", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels, config_meta: meta(channels, { checksum: "deadbeef" }) });
    const { body } = await call(worker, env, "/api/health");
    expect(body.status).toBe("ok");
    expect(body.config.checksumMatches).toBe(false);
  });

  it("counts the links resolve can answer for without echoing any", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({
      channels,
      gdrive_map: { "news-us": "https://cdn.example/news.m3u8" },
    });
    const { body } = await call(worker, env, "/api/health");
    expect(body.resolve).toEqual({ configured: 1, invalid: 0, missing: 1 });
    // Counts only: a health endpoint is the first thing exposed to a monitor.
    expect(JSON.stringify(body)).not.toContain("cdn.example");
  });

  it("counts a non-HTTPS link as invalid rather than configured", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({
      channels,
      gdrive_map: { "news-us": "http://cdn.example/news.m3u8" },
    });
    const { body } = await call(worker, env, "/api/health");
    expect(body.resolve).toEqual({ configured: 0, invalid: 1, missing: 1 });
  });

  it("counts the secret link it would actually serve over the KV one", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({
      channels,
      gdrive_map: { "sport-uk": "https://cdn.example/sport.m3u8" },
    });
    (env as any).ATV_GDRIVE_MAP = JSON.stringify({
      "news-us": "https://secret.example/news.m3u8",
    });
    const { body } = await call(worker, env, "/api/health");
    expect(body.resolve).toEqual({ configured: 2, invalid: 0, missing: 0 });
  });

  it("reports a degraded worker when nothing is seeded", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { body } = await call(worker, env, "/api/health");
    expect(body.status).toBe("degraded");
    expect(body.config.seeded).toBe(false);
    expect(body.guideSnapshot).toBeNull();
  });

  // R8 needs to see the rollout from outside: half-done is "secret set, TVs not
  // yet", and that is invisible unless health says so. Presence, never the value.
  it("says whether the household token is set, without revealing it", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels });

    expect((await call(worker, env, "/api/health")).body.deviceTokenSet).toBe(false);

    (env as any).ATV_DEVICE_TOKEN = "household-secret-7f3a";
    const { body } = await call(worker, env, "/api/health");

    expect(body.deviceTokenSet).toBe(true);
    expect(JSON.stringify(body)).not.toContain("household-secret");
  });
});

describe("GET /api/guide", () => {
  it("indexes channels in a stable order and normalises genre/genres", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels });
    const { res, body } = await call(worker, env, "/api/guide");
    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.channels.map((c: any) => c.id)).toEqual(["news-us", "sport-uk"]);
    expect(body.channels[0].genres).toEqual(["news"]);
    expect(body.channels[1].genres).toEqual(["sport"]);
    expect(body.counts.country).toEqual({ US: 1, UK: 1 });
    expect(body.counts.category).toEqual({ news: 1, sport: 1 });
    expect(body.truncated).toBeUndefined();
    expect(body.nextCursor).toBeNull();
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");
    // A lineup that changes only on a re-seed can be served stale briefly while
    // the edge revalidates, which keeps CDN hits off the origin.
    expect(res.headers.get("cache-control")).toContain("stale-while-revalidate=300");
    expect(res.headers.get("access-control-expose-headers")).toContain("ETag");
    expect(res.headers.get("access-control-allow-headers")).toContain("If-None-Match");
  });

  // The lineup is external input: a hand-edited seed, an older generator or a typo
  // reaches loadLineup unchanged. Served as-is it produced a blank tile, a channel
  // counted twice and `[object Object]` among the genres.
  it("drops an unusable id, keeps one entry per id and coerces genres to strings", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({
      channels: [
        { id: "news-us", name: "News 24", genre: ["news", 42, null] },
        { id: "news-us", name: "Duplicate" },
        { id: "   ", name: "Blank id" },
        { name: "No id at all" },
      ],
    });
    const { res, body } = await call(worker, env, "/api/guide");
    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.channels).toHaveLength(1);
    expect(body.channels[0]).toMatchObject({ id: "news-us", name: "News 24", genres: ["news"] });
  });

  it("pages deterministically with limit and cursor", async () => {
    const worker = await freshWorker();
    const lineup = ["alpha", "bravo", "charlie"].map((id) => ({
      id,
      name: id,
      country: "US",
      category: "news",
      genres: [],
    }));
    const { env } = makeEnv({ channels: lineup });

    const first = await call(worker, env, "/api/guide?limit=1");
    expect(first.body.channels.map((c: any) => c.id)).toEqual(["alpha"]);
    expect(first.body.total).toBe(3);
    expect(first.body.nextCursor).toBe("1");

    const second = await call(worker, env, "/api/guide?limit=1&cursor=1");
    expect(second.body.channels.map((c: any) => c.id)).toEqual(["bravo"]);
    expect(second.body.nextCursor).toBe("2");

    const third = await call(worker, env, "/api/guide?limit=1&cursor=2");
    expect(third.body.channels.map((c: any) => c.id)).toEqual(["charlie"]);
    expect(third.body.nextCursor).toBeNull();
  });

  it("answers 304 for a matching If-None-Match", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels });
    const first = await call(worker, env, "/api/guide");
    const etag = first.res.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await call(worker, env, "/api/guide", {
      headers: { "If-None-Match": etag as string },
    });
    expect(second.res.status).toBe(304);
    expect(second.res.headers.get("x-request-id")).toBeTruthy();
  });

  it("answers 304 for the weak ETag Cloudflare's edge returns", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels });
    const first = await call(worker, env, "/api/guide");
    const etag = first.res.headers.get("etag") as string;

    // The edge weakens a strong ETag when it compresses the body; the browser
    // then sends W/"…" back and must still get a 304.
    const second = await call(worker, env, "/api/guide", {
      headers: { "If-None-Match": `W/${etag}` },
    });
    expect(second.res.status).toBe(304);
  });

  it("accepts a comma-separated If-None-Match list and a wildcard", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels });
    const first = await call(worker, env, "/api/guide");
    const etag = first.res.headers.get("etag") as string;

    const list = await call(worker, env, "/api/guide", {
      headers: { "If-None-Match": `"other", W/${etag}` },
    });
    expect(list.res.status).toBe(304);

    const wildcard = await call(worker, env, "/api/guide", {
      headers: { "If-None-Match": "*" },
    });
    expect(wildcard.res.status).toBe(304);
  });

  it("serves the body when If-None-Match names a different representation", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels });
    const { res } = await call(worker, env, "/api/guide", {
      headers: { "If-None-Match": 'W/"guide-9-deadbeef"' },
    });
    expect(res.status).toBe(200);
  });

  it("falls back to system_config.channels", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ system_config: { version: 1, channels } });
    const { body } = await call(worker, env, "/api/guide");
    expect(body.channels.map((c: any) => c.id)).toEqual(["news-us", "sport-uk"]);
  });

  it("serves an empty lineup when nothing is seeded", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res, body } = await call(worker, env, "/api/guide");
    expect(res.status).toBe(200);
    expect(body.channels).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("refuses a config written by a newer schema", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels, config_meta: meta(channels, { schemaVersion: 2 }) });
    const { res, body } = await call(worker, env, "/api/guide");
    expect(res.status).toBe(503);
    expect(body.code).toBe("config_schema_mismatch");
  });

  it("flags channels that changed since the seed", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels, config_meta: meta(channels, { checksum: "deadbeef" }) });
    const { body } = await call(worker, env, "/api/guide");
    expect(body.warning).toBe("config_checksum_mismatch");
  });
});

describe("GET /api/resolve", () => {
  const map = { "news-us": "https://cdn.example/news.m3u8", "bad-id": "http://plain.example/x" };

  it("requires an id", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const { res, body } = await call(worker, env, "/api/resolve");
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ error: "missing id", code: "missing_id" });
    expect(body.requestId).toBeTruthy();
  });

  it("answers a batch in one request and groups what it could not resolve", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const { res, body } = await call(worker, env, "/api/resolve?ids=news-us,bad-id,nope");
    expect(res.status).toBe(200);
    expect(body.resolved).toEqual([
      { id: "news-us", url: "https://cdn.example/news.m3u8", profile: "1080p_hevc" },
    ]);
    expect(body.invalid).toEqual(["bad-id"]);
    expect(body.missing).toEqual(["nope"]);
    // Links are still never cacheable, batch or not.
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("dedupes a repeated id in a batch", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const { body } = await call(worker, env, "/api/resolve?ids=news-us,news-us");
    expect(body.resolved).toHaveLength(1);
    expect(body.missing).toEqual([]);
  });

  it("caps a batch at 20 ids", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const ids = Array.from({ length: 21 }, (_, i) => `id-${i}`).join(",");
    const { res, body } = await call(worker, env, `/api/resolve?ids=${ids}`);
    expect(res.status).toBe(400);
    expect(body.code).toBe("too_many_ids");
  });

  it("spends one limiter token for a whole batch", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const calls: string[] = [];
    (env as any).ATV_RATE_LIMITER = {
      limit: async ({ key }: { key: string }) => {
        calls.push(key);
        return { success: true };
      },
    };
    const { res } = await call(worker, env, "/api/resolve?ids=news-us,bad-id,nope", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["resolve:203.0.113.9"]);
  });

  it("counts a batch once in the metrics dataset", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const points: any[] = [];
    (env as any).ATV_METRICS = { writeDataPoint: (point: any) => points.push(point) };
    await call(worker, env, "/api/resolve?ids=news-us,nope");
    expect(points.map((p) => p.blobs[0])).toEqual(["resolve_batch"]);
  });

  it("404s an unknown id", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const { res, body } = await call(worker, env, "/api/resolve?id=__smoke__");
    expect(res.status).toBe(404);
    expect(body.code).toBe("not_found");
  });

  it("refuses a non-HTTPS target", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const { res, body } = await call(worker, env, "/api/resolve?id=bad-id");
    expect(res.status).toBe(502);
    expect(body).toMatchObject({ code: "insecure_url" });
    expect(body.error).toMatch(/insecure url/);
  });

  it("resolves a mapped id", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const points: any[] = [];
    (env as any).ATV_METRICS = { writeDataPoint: (point: any) => points.push(point) };
    const { res, body } = await call(worker, env, "/api/resolve?id=news-us");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: "news-us", url: "https://cdn.example/news.m3u8" });
    expect(typeof body.profile).toBe("string");
    expect(points.map((p) => p.blobs[0])).toEqual(["resolve_hit"]);
  });

  it("resolves a link supplied in the operator secret", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: {} });
    (env as any).ATV_GDRIVE_MAP = JSON.stringify({
      "news-us": "https://secret.example/news.m3u8",
    });

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us");

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: "news-us", url: "https://secret.example/news.m3u8" });
  });

  it("lets the operator secret override a KV link", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    (env as any).ATV_GDRIVE_MAP = JSON.stringify({
      "news-us": "https://rotated.example/news.m3u8",
    });

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us");

    expect(res.status).toBe(200);
    expect(body.url).toBe("https://rotated.example/news.m3u8");
  });

  it("refuses a non-HTTPS link from the operator secret", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: {} });
    (env as any).ATV_GDRIVE_MAP = JSON.stringify({ "news-us": "http://plain.example/x" });

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us");

    expect(res.status).toBe(502);
    expect(body.code).toBe("insecure_url");
  });

  it("ignores a malformed operator secret and keeps serving KV links", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const worker = await freshWorker();
      const { env } = makeEnv({ gdrive_map: map });
      (env as any).ATV_GDRIVE_MAP = "{not json";

      const { res, body } = await call(worker, env, "/api/resolve?id=news-us");

      expect(res.status).toBe(200);
      expect(body.url).toBe("https://cdn.example/news.m3u8");
    } finally {
      spy.mockRestore();
    }
  });

  it("429s with Retry-After when the rate limiter refuses", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const keys: string[] = [];
    (env as any).ATV_RATE_LIMITER = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    };

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    // Retry-After is not a CORS-safelisted header, so a cross-origin caller can
    // only honour it when it is exposed.
    expect(res.headers.get("access-control-expose-headers")).toContain("Retry-After");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(body).toMatchObject({ code: "rate_limited", error: "too many requests" });
    expect(keys).toEqual(["resolve:203.0.113.9"]);
  });

  it("resolves and spends one token when the limiter accepts", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const keys: string[] = [];
    (env as any).ATV_RATE_LIMITER = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: true };
      },
    };

    const { res } = await call(worker, env, "/api/resolve?id=news-us", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });

    expect(res.status).toBe(200);
    expect(keys).toEqual(["resolve:203.0.113.9"]);
  });

  it("leaves a request without a client IP uncounted instead of sharing a bucket", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const keys: string[] = [];
    (env as any).ATV_RATE_LIMITER = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    };

    const { res } = await call(worker, env, "/api/resolve?id=news-us");

    // Not a shared "unknown" key: one anonymous caller must not be able to
    // exhaust the allowance for every other one.
    expect(keys).toEqual([]);
    expect(res.status).toBe(200);
  });

  it("does not spend the resolve allowance on other endpoints", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels });
    const limit = vi.fn(async () => ({ success: false }));
    (env as any).ATV_RATE_LIMITER = { limit };

    const { res } = await call(worker, env, "/api/guide", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });

    expect(res.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
  });

  // A Durable Object namespace stand-in: idFromName records the key and get()
  // returns a stub whose fetch answers with the supplied decision.
  function fakeLimiter(decision: { success?: boolean; retryAfterS?: number } | Error) {
    const names: string[] = [];
    return {
      names,
      namespace: {
        idFromName: (name: string) => {
          names.push(name);
          return name;
        },
        get: () => ({
          fetch: async () => {
            if (decision instanceof Error) throw decision;
            return new Response(JSON.stringify({ retryAfterS: 60, ...decision }), {
              headers: { "content-type": "application/json" },
            });
          },
        }),
      },
    };
  }

  it("429s with the Durable Object's Retry-After and skips the coarse limiter", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const strict = fakeLimiter({ success: false, retryAfterS: 12 });
    (env as any).ATV_LIMITER = strict.namespace;
    const coarse = vi.fn(async () => ({ success: true }));
    (env as any).ATV_RATE_LIMITER = { limit: coarse };

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    expect(body).toMatchObject({ code: "rate_limited" });
    expect(strict.names).toEqual(["resolve:203.0.113.9"]);
    expect(coarse).not.toHaveBeenCalled();
  });

  it("resolves when the Durable Object limiter accepts", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    (env as any).ATV_LIMITER = fakeLimiter({ success: true }).namespace;

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: "news-us", url: "https://cdn.example/news.m3u8" });
  });

  it("falls back to the coarse limiter when the Durable Object throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const worker = await freshWorker();
      const { env } = makeEnv({ gdrive_map: map });
      (env as any).ATV_LIMITER = fakeLimiter(new Error("object unavailable")).namespace;
      const coarse = vi.fn(async () => ({ success: false }));
      (env as any).ATV_RATE_LIMITER = { limit: coarse };

      const { res } = await call(worker, env, "/api/resolve?id=news-us", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      });

      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("60");
      expect(coarse).toHaveBeenCalledWith({ key: "resolve:203.0.113.9" });
    } finally {
      spy.mockRestore();
    }
  });

  it("resolves when both limiters fail", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const worker = await freshWorker();
      const { env } = makeEnv({ gdrive_map: map });
      (env as any).ATV_LIMITER = fakeLimiter(new Error("object unavailable")).namespace;

      const { res } = await call(worker, env, "/api/resolve?id=news-us", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      });

      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("fails open when the rate limiter itself errors", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    (env as any).ATV_RATE_LIMITER = {
      limit: async () => {
        throw new Error("limiter unavailable");
      },
    };

    const { res } = await call(worker, env, "/api/resolve?id=news-us");
    expect(res.status).toBe(200);
  });

  it("serves without a metrics binding and counts a miss when one is present", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const points: any[] = [];
    (env as any).ATV_METRICS = { writeDataPoint: (point: any) => points.push(point) };
    await call(worker, env, "/api/resolve?id=__smoke__");
    expect(points.map((p) => p.blobs[0])).toEqual(["resolve_miss"]);
  });

  // R6 / option C. The order inside the handler is what these assert: a
  // stranger's request must not spend the household's allowance, reach a
  // provider, or learn anything about the secret.
  const TOKEN = "household-secret-7f3a";

  it("401s a headerless resolve before the limiter or a provider call", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    (env as any).ATV_DEVICE_TOKEN = TOKEN;
    const strict = fakeLimiter({ success: true });
    (env as any).ATV_LIMITER = strict.namespace;
    const coarse = vi.fn(async () => ({ success: true }));
    (env as any).ATV_RATE_LIMITER = { limit: coarse };

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });

    expect(res.status).toBe(401);
    expect(body.code).toBe("unauthorized");
    expect(body.requestId).toBe(res.headers.get("x-request-id"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    // A TV's cross-origin fetch cannot send a header the preflight forbids.
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(strict.names).toEqual([]);
    expect(coarse).not.toHaveBeenCalled();
  });

  it("401s the batch form, a wrong token and a foreign scheme alike", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    (env as any).ATV_DEVICE_TOKEN = TOKEN;

    const attempts: [string, string | undefined][] = [
      ["/api/resolve?ids=news-us", undefined],
      ["/api/resolve?id=news-us", "Bearer not-the-token"],
      ["/api/resolve?id=news-us", `Basic ${TOKEN}`],
    ];
    for (const [path, header] of attempts) {
      const { res, body } = await call(worker, env, path, {
        headers: header ? { Authorization: header } : {},
      });
      expect(res.status).toBe(401);
      expect(body.code).toBe("unauthorized");
    }
  });

  it("serves a resolve and a batch with the household token", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    (env as any).ATV_DEVICE_TOKEN = TOKEN;

    const single = await call(worker, env, "/api/resolve?id=news-us", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const batch = await call(worker, env, "/api/resolve?ids=news-us,missing-id", {
      headers: { Authorization: `bearer ${TOKEN}` },
    });

    expect(single.res.status).toBe(200);
    expect(single.body.url).toBeTruthy();
    expect(batch.res.status).toBe(200);
    expect(batch.body.resolved.map((entry: any) => entry.id)).toEqual(["news-us"]);
    expect(batch.body.missing).toEqual(["missing-id"]);
  });

  it("counts an unauthorised attempt on its own counter", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    (env as any).ATV_DEVICE_TOKEN = TOKEN;
    const points: any[] = [];
    (env as any).ATV_METRICS = { writeDataPoint: (point: any) => points.push(point) };

    await call(worker, env, "/api/resolve?id=news-us");

    expect(points.map((p) => p.blobs[0])).toEqual(["resolve_unauthorized"]);
  });
});

describe("GET /api/stream (P1 Drive proxy)", () => {
  // A real-shaped Drive id: the parser refuses anything shorter than 10.
  const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWx";
  const DRIVE_LINK = `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`;
  const SECRET = "stream-signing-secret-p1";

  function streamEnv({ secret = SECRET }: { secret?: string } = {}) {
    const { env } = makeEnv({
      gdrive_map: { "drive-news": DRIVE_LINK, "cdn-news": "https://cdn.example/news.m3u8" },
    });
    if (secret) (env as any).ATV_STREAM_SIGNING_KEY = secret;
    return env;
  }

  // The origin, stubbed: a fresh Response per call, so a test that reads the body
  // cannot eat the next test's.
  function upstream(make: () => Response) {
    const calls: { url: string; headers: Headers }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any, init?: RequestInit) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) });
        return make();
      }),
    );
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The seek case, which is the one a Range bug breaks: the player asks for a
  // middle offset and must get 206 plus the origin's Content-Range, not a 200 of
  // the whole file and not a proxy that swallows the header.
  it("proxies a mid-file range as a 206 and passes Content-Range through", async () => {
    const worker = await freshWorker();
    const env = streamEnv();
    const calls = upstream(
      () =>
        new Response("0123456789abcdef", {
          status: 206,
          headers: {
            "content-type": "video/mp4",
            "content-length": "16",
            "content-range": "bytes 1048576-1048591/8388608",
            "accept-ranges": "bytes",
            // The origin's own caching belongs to the origin; a ticket in the URL
            // must not end up in a shared cache.
            "cache-control": "private, max-age=3600",
          },
        }),
    );

    const ticket = await signStreamUrl("drive-news", SECRET);
    const { res } = await call(worker, env, ticket, { headers: { Range: "bytes=1048576-" } });

    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith("https://drive.usercontent.google.com/download?")).toBe(true);
    expect(calls[0].url).toContain(`id=${FILE_ID}`);
    // Forwarded untouched: rewriting a range is how a seek lands on the wrong bytes.
    expect(calls[0].headers.get("range")).toBe("bytes=1048576-");

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 1048576-1048591/8388608");
    expect(res.headers.get("content-length")).toBe("16");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    // The TV's <video crossOrigin="anonymous"> needs a CORS answer, and a header
    // it cannot read is a header it does not have.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")).toContain("Content-Range");
  });

  // These describe the bytes, not the request: a body the origin encoded must not
  // arrive undeclared, and a download's filename must survive the hop or the
  // player is given an attachment it cannot name.
  it("passes Content-Encoding and Content-Disposition through", async () => {
    const worker = await freshWorker();
    const env = streamEnv();
    upstream(
      () =>
        new Response("compressed", {
          status: 200,
          headers: {
            "content-type": "video/mp4",
            "content-length": "10",
            "content-encoding": "gzip",
            "content-disposition": 'attachment; filename="drive-news.mp4"',
          },
        }),
    );

    const { res } = await call(worker, env, await signStreamUrl("drive-news", SECRET));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="drive-news.mp4"');
    expect(res.headers.get("content-type")).toBe("video/mp4");
  });

  it("answers the whole-file request as a 200 without inventing a Range", async () => {
    const worker = await freshWorker();
    const env = streamEnv();
    const calls = upstream(
      () =>
        new Response("whole", {
          status: 200,
          headers: { "content-type": "video/mp4", "content-length": "5" },
        }),
    );

    const { res } = await call(worker, env, await signStreamUrl("drive-news", SECRET));

    expect(calls[0].headers.has("range")).toBe(false);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-range")).toBeNull();
  });

  it("claims Accept-Ranges on a 206 even when the origin omits it", async () => {
    const worker = await freshWorker();
    const env = streamEnv();
    upstream(
      () =>
        new Response("x", {
          status: 206,
          headers: { "content-type": "video/mp4", "content-range": "bytes 0-0/100" },
        }),
    );

    const { res } = await call(worker, env, await signStreamUrl("drive-news", SECRET), {
      headers: { Range: "bytes=0-0" },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  // A player that seeks past the end asks for something unsatisfiable; the 416 and
  // its `bytes */<size>` are how it learns the real length.
  it("passes an unsatisfiable range through as a 416", async () => {
    const worker = await freshWorker();
    const env = streamEnv();
    upstream(
      () =>
        new Response(null, {
          status: 416,
          headers: { "content-range": "bytes */8388608" },
        }),
    );

    const { res } = await call(worker, env, await signStreamUrl("drive-news", SECRET), {
      headers: { Range: "bytes=99999999-" },
    });

    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */8388608");
  });

  it("refuses an expired, forged or ticketless request without touching Drive", async () => {
    const worker = await freshWorker();
    const env = streamEnv();
    const calls = upstream(() => new Response("should not be fetched"));

    const ticket = await signStreamUrl("drive-news", SECRET);
    const stale = await signStreamUrl("drive-news", SECRET, { now: Date.now() - 20 * 60 * 1000 });
    const forged = ticket.replace(
      /sig=(.)/,
      (_all, first: string) => `sig=${first === "0" ? "1" : "0"}`,
    );
    const ticketless = ticket.replace(/&sig=[0-9a-f]+/, "");

    const expired = await call(worker, env, stale);
    const bad = await call(worker, env, forged);
    const missing = await call(worker, env, ticketless);

    expect([expired.res.status, bad.res.status, missing.res.status]).toEqual([403, 403, 403]);
    expect([expired.body.code, bad.body.code, missing.body.code]).toEqual([
      "expired",
      "bad-signature",
      "missing",
    ]);
    expect(calls).toHaveLength(0);
  });

  // A deployment without the key is misconfigured, and saying so is the difference
  // between "set the secret" and "this link is wrong".
  it("answers 503 when the signing key is not set", async () => {
    const worker = await freshWorker();
    const env = streamEnv({ secret: "" });
    const calls = upstream(() => new Response("nope"));

    const { res, body } = await call(worker, env, await signStreamUrl("drive-news", SECRET));

    expect(res.status).toBe(503);
    expect(body.code).toBe("stream_unconfigured");
    expect(calls).toHaveLength(0);
  });

  it("404s a ticket for an id with no Drive file behind it", async () => {
    const worker = await freshWorker();
    const env = streamEnv();
    const calls = upstream(() => new Response("nope"));

    const unknown = await call(worker, env, await signStreamUrl("nope", SECRET));
    // A ticket is not a licence to proxy anything: a CDN playlist behind one is
    // still not a Drive file.
    const cdn = await call(worker, env, await signStreamUrl("cdn-news", SECRET));

    expect(unknown.res.status).toBe(404);
    expect(unknown.body.code).toBe("not_found");
    expect(cdn.res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  // The whole point, end to end: resolve hands the TV a URL on this origin, the
  // TV plays it, and the Drive link never reaches the device.
  it("resolves a Drive channel to a same-origin ticket that the proxy serves", async () => {
    const worker = await freshWorker();
    const env = streamEnv();
    upstream(
      () =>
        new Response("bytes", {
          status: 200,
          headers: { "content-type": "video/mp4", "content-length": "5" },
        }),
    );

    const { res, body } = await call(worker, env, "/api/resolve?id=drive-news");

    expect(res.status).toBe(200);
    expect(body.url).toMatch(/^\/api\/stream\/drive-news\?exp=\d+&sig=[0-9a-f]{64}$/);
    expect(JSON.stringify(body)).not.toContain("drive.google.com");

    const served = await call(worker, env, body.url);
    expect(served.res.status).toBe(200);
    expect(served.res.headers.get("content-type")).toBe("video/mp4");
  });

  it("leaves a non-Drive link exactly as it was", async () => {
    const worker = await freshWorker();
    const env = streamEnv();

    const { body } = await call(worker, env, "/api/resolve?id=cdn-news");

    expect(body.url).toBe("https://cdn.example/news.m3u8");
  });

  it("answers 502 for a refused upstream and keeps the Drive URL out of it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const worker = await freshWorker();
      const env = streamEnv();
      upstream(() => new Response("denied", { status: 403 }));

      const { res, body } = await call(worker, env, await signStreamUrl("drive-news", SECRET));

      expect(res.status).toBe(502);
      expect(body.code).toBe("upstream_error");
      expect(JSON.stringify(body)).not.toContain("drive");
      // The log names the path and Drive's status, never the link or the id.
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain("drive responded 403");
      expect(logged).not.toContain(FILE_ID);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("GET /api/idents/random", () => {
  it("redirects to one of the seeded HTTPS idents", async () => {
    const worker = await freshWorker();
    const idents = ["https://a.example/one.svg", { url: "https://b.example/two.svg" }];
    const { env } = makeEnv({ idents });
    const { res } = await call(worker, env, "/api/idents/random");
    expect(res.status).toBe(302);
    expect(idents.map((i: any) => (typeof i === "string" ? i : i.url))).toContain(
      res.headers.get("location"),
    );
  });

  it("counts a redirect when the metrics dataset is bound", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ idents: ["https://a.example/one.svg"] });
    const points: any[] = [];
    (env as any).ATV_METRICS = { writeDataPoint: (point: any) => points.push(point) };
    await call(worker, env, "/api/idents/random");
    expect(points.map((p) => p.blobs[0])).toEqual(["ident_redirect"]);
  });

  it("503s when no ident is configured", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ idents: [] });
    const { res, body } = await call(worker, env, "/api/idents/random");
    expect(res.status).toBe(503);
    expect(body.code).toBe("no_idents");
  });

  it("only redirects to an absolute https url that parses and has a host", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({
      idents: [
        "https://",
        "http://insecure.example/i.svg",
        { url: 42 },
        42,
        "https://ok.example/i.svg",
      ],
    });
    const { res } = await call(worker, env, "/api/idents/random");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://ok.example/i.svg");
  });

  it("503s when every seeded ident is unusable", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ idents: ["https://", "not a url"] });
    const { res, body } = await call(worker, env, "/api/idents/random");
    expect(res.status).toBe(503);
    expect(body.code).toBe("no_idents");
  });
});

describe("routing", () => {
  it("404s an unknown path", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res } = await call(worker, env, "/api/nope");
    expect(res.status).toBe(404);
  });

  it("405s a mutating method", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res } = await call(worker, env, "/api/status", { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("answers CORS preflight", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res } = await call(worker, env, "/api/guide", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("redirects bare /admin, serves assets and falls back to the admin shell", async () => {
    const worker = await freshWorker();
    const seen: string[] = [];
    const { env } = makeEnv();
    (env as any).ASSETS = {
      fetch: async (target: string | Request) => {
        seen.push(typeof target === "string" ? target : target.url);
        return new Response("asset");
      },
    };

    const bare = await call(worker, env, "/admin");
    expect(bare.res.status).toBe(308);
    expect(bare.res.headers.get("location")).toBe("/admin/");

    const index = await worker.fetch(new Request("https://atv.test/admin/"), env);
    expect(index.status).toBe(200);
    expect(await index.text()).toBe("asset");

    const asset = await worker.fetch(new Request("https://atv.test/admin/assets/app.js"), env);
    expect(asset.status).toBe(200);

    await worker.fetch(new Request("https://atv.test/admin/settings"), env);
    expect(seen.at(-1)).toContain("/admin/");
    expect(seen.at(-2)).toContain("/admin/assets/app.js");
  });

  it("302s /a to the release asset without reading either KV namespace", async () => {
    const worker = await freshWorker();
    const { env, config, cache } = makeEnv();
    const { res } = await call(worker, env, "/a");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(apkUrl("test"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    // An install has to work before a lineup is seeded, so this route must not
    // touch the config or the cache on its way out.
    expect(config.store.size).toBe(0);
    expect(cache.store.size).toBe(0);
  });

  it("answers the trailing-slash form of /a", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res } = await call(worker, env, "/a/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(apkUrl("test"));
  });

  // The page routes sit outside the per-handler guard, so a missing var used to be
  // a bare platform 500 with no request id and no CORS headers to read it from.
  it("answers a request id and a JSON 503 when GITHUB_USERNAME is missing", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    delete (env as unknown as { GITHUB_USERNAME?: string }).GITHUB_USERNAME;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const path of ["/a", "/install", "/install/qr.svg"]) {
        const { res, body } = await call(worker, env, path);
        expect(res.status).toBe(503);
        expect(body.code).toBe("internal_error");
        expect(res.headers.get("x-request-id")).toBeTruthy();
      }
    } finally {
      spy.mockRestore();
    }
  });
});

describe("scheduled guide snapshot", () => {
  it("writes guide:latest to ATV_CACHE", async () => {
    const worker = await freshWorker();
    const { env, cache } = makeEnv({ channels, config_meta: meta(channels) });
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({ cron: "*/10 * * * *", scheduledTime: Date.now() } as any, env, {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    } as any);
    await Promise.all(pending);

    const stored = cache.store.get("guide:latest");
    expect(stored).toBeTruthy();
    const snapshot = JSON.parse(stored as string);
    expect(snapshot.total).toBe(2);
    expect(snapshot.channels).toHaveLength(2);
  });
});
