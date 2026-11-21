import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";

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
  } as unknown as Env;
  return { env, config, cache };
}

// The guide memo is module state, so each test loads a fresh copy of the Worker.
async function freshWorker() {
  vi.resetModules();
  const mod = await import("../src/index");
  return mod.default;
}

async function get(worker: any, env: Env, path: string, init?: RequestInit) {
  const res = await worker.fetch(new Request(`https://atv.test${path}`, init), env);
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

describe("GET /api/status", () => {
  it("reports the build environment from SYSTEM_ENV", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res, body } = await get(worker, env, "/api/status");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ name: "ATV Core", status: "live", env: "test" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/guide", () => {
  it("indexes channels and normalises genre/genres", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ channels });
    const { res, body } = await get(worker, env, "/api/guide");
    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.truncated).toBe(false);
    expect(body.channels.map((c: any) => c.id)).toEqual(["news-us", "sport-uk"]);
    expect(body.channels[0].genres).toEqual(["news"]);
    expect(body.channels[1].genres).toEqual(["sport"]);
    expect(body.counts.country).toEqual({ US: 1, UK: 1 });
    expect(body.counts.category).toEqual({ news: 1, sport: 1 });
  });

  it("falls back to system_config.channels", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ system_config: { version: 1, channels } });
    const { body } = await get(worker, env, "/api/guide");
    expect(body.channels.map((c: any) => c.id)).toEqual(["news-us", "sport-uk"]);
  });

  it("serves an empty lineup when nothing is seeded", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res, body } = await get(worker, env, "/api/guide");
    expect(res.status).toBe(200);
    expect(body.channels).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe("GET /api/resolve", () => {
  const map = { "news-us": "https://cdn.example/news.m3u8", "bad-id": "http://plain.example/x" };

  it("requires an id", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const { res, body } = await get(worker, env, "/api/resolve");
    expect(res.status).toBe(400);
    expect(body.error).toBe("missing id");
  });

  it("404s an unknown id", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const { res, body } = await get(worker, env, "/api/resolve?id=__smoke__");
    expect(res.status).toBe(404);
    expect(body.error).toBe("not found");
  });

  it("refuses a non-HTTPS target", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const { res, body } = await get(worker, env, "/api/resolve?id=bad-id");
    expect(res.status).toBe(502);
    expect(body.error).toMatch(/insecure url/);
  });

  it("resolves a mapped id", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ gdrive_map: map });
    const { res, body } = await get(worker, env, "/api/resolve?id=news-us");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: "news-us", url: "https://cdn.example/news.m3u8" });
    expect(typeof body.profile).toBe("string");
  });
});

describe("GET /api/idents/random", () => {
  it("redirects to one of the seeded HTTPS idents", async () => {
    const worker = await freshWorker();
    const idents = ["https://a.example/one.svg", { url: "https://b.example/two.svg" }];
    const { env } = makeEnv({ idents });
    const { res } = await get(worker, env, "/api/idents/random");
    expect(res.status).toBe(302);
    expect(idents.map((i: any) => (typeof i === "string" ? i : i.url))).toContain(
      res.headers.get("location"),
    );
  });

  it("503s when no ident is configured", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv({ idents: [] });
    const { res, body } = await get(worker, env, "/api/idents/random");
    expect(res.status).toBe(503);
    expect(body.error).toBe("no idents configured");
  });
});

describe("routing", () => {
  it("404s an unknown path", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res } = await get(worker, env, "/api/nope");
    expect(res.status).toBe(404);
  });

  it("405s a mutating method", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res } = await get(worker, env, "/api/status", { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("answers CORS preflight", async () => {
    const worker = await freshWorker();
    const { env } = makeEnv();
    const { res } = await get(worker, env, "/api/guide", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("scheduled guide snapshot", () => {
  it("writes guide:latest to ATV_CACHE", async () => {
    const worker = await freshWorker();
    const { env, cache } = makeEnv({ channels });
    const pending: Promise<unknown>[] = [];
    await worker.scheduled(
      { cron: "*/10 * * * *", scheduledTime: Date.now() } as any,
      env,
      { waitUntil: (p: Promise<unknown>) => pending.push(p) } as any,
    );
    await Promise.all(pending);

    const stored = cache.store.get("guide:latest");
    expect(stored).toBeTruthy();
    const snapshot = JSON.parse(stored as string);
    expect(snapshot.total).toBe(2);
    expect(snapshot.truncated).toBe(false);
  });
});
