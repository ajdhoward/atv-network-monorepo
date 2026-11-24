import { afterEach, describe, expect, it, vi } from "vitest";
import { checksum } from "../src/config-meta";
import type { Env } from "../src/env";

type Seed = Record<string, unknown>;

// Same minimal KV stand-in as routes.test.ts; the Worker only reads JSON here.
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
  return kv;
}

function makeEnv(seed: Seed = {}, secrets: Record<string, string> = {}) {
  const env = {
    ATV_CONFIG: fakeKv(seed),
    ATV_CACHE: fakeKv(),
    GITHUB_USERNAME: "test",
    SYSTEM_ENV: "test",
    ASSETS: {
      fetch: async () =>
        new Response("asset", { status: 200, headers: { "content-type": "text/plain" } }),
    },
    ...secrets,
  } as unknown as Env;
  return env;
}

// The TorBox link cache is module state, so each test loads a fresh copy.
async function freshWorker() {
  vi.resetModules();
  const mod = await import("../src/index");
  return mod.default;
}

async function call(worker: any, env: Env, path: string) {
  const request = new Request(`https://atv.test${path}`);
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
  { id: "sport-uk", name: "UK Sport", country: "UK", category: "sport", genre: ["sport"] },
];

const meta = {
  schemaVersion: 1,
  checksum: checksum(channels),
  channels: channels.length,
  updatedAt: "2026-11-21T00:00:00.000Z",
};

const torrent = { kind: "torrent", torrentId: 11, fileId: 22 };
const TOKEN = "tok-123";

// TorBox answers requestdl with `{ success, data: "<cdn url>" }`.
function mockTorbox(link = "https://cdn.torbox.example/file.mp4", status = 200) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify(
          status === 200
            ? { success: true, error: null, detail: "ok", data: link }
            : { success: false, error: "BAD_TOKEN", detail: `token ${TOKEN} is not valid` },
        ),
        { status, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TorBox links", () => {
  it("resolves a mapped channel through the documented requestdl endpoint", async () => {
    const fetchMock = mockTorbox();
    const worker = await freshWorker();
    const env = makeEnv(
      { channels, config_meta: meta, torbox_map: { "news-us": torrent } },
      { ATV_TORBOX_API_KEY: TOKEN },
    );

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us");
    expect(res.status).toBe(200);
    expect(body).toEqual({
      id: "news-us",
      url: "https://cdn.torbox.example/file.mp4",
      profile: "1080p_hevc",
    });
    // The token is server-side only: the device receives the CDN link alone.
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.torbox.app/v1/api/torrents/requestdl");
    expect(url.searchParams.get("token")).toBe(TOKEN);
    expect(url.searchParams.get("torrent_id")).toBe("11");
    expect(url.searchParams.get("file_id")).toBe("22");
    const headers = fetchMock.mock.calls[0][1] as RequestInit;
    expect((headers.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("asks TorBox once per isolate for the same item", async () => {
    const fetchMock = mockTorbox();
    const worker = await freshWorker();
    const env = makeEnv(
      { channels, torbox_map: { "news-us": torrent } },
      { ATV_TORBOX_API_KEY: TOKEN },
    );

    await call(worker, env, "/api/resolve?id=news-us");
    const second = await call(worker, env, "/api/resolve?id=news-us");
    expect(second.body.url).toBe("https://cdn.torbox.example/file.mp4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves usenet and webdl entries with their own id parameter", async () => {
    const fetchMock = mockTorbox();
    const worker = await freshWorker();
    const env = makeEnv(
      {
        channels,
        torbox_map: {
          "news-us": { kind: "usenet", usenetId: 5, fileId: 6 },
          "sport-uk": { kind: "webdl", webdlId: 7, fileId: 8 },
        },
      },
      { ATV_TORBOX_API_KEY: TOKEN },
    );

    await call(worker, env, "/api/resolve?ids=news-us,sport-uk");
    const first = new URL(String(fetchMock.mock.calls[0][0]));
    const second = new URL(String(fetchMock.mock.calls[1][0]));
    expect(first.pathname).toBe("/v1/api/usenet/requestdl");
    expect(first.searchParams.get("usenet_id")).toBe("5");
    expect(second.pathname).toBe("/v1/api/webdl/requestdl");
    expect(second.searchParams.get("webdl_id")).toBe("7");
  });

  it("lets an operator link in the secret win over the TorBox map", async () => {
    const fetchMock = mockTorbox();
    const worker = await freshWorker();
    const env = makeEnv(
      { channels, torbox_map: { "news-us": torrent } },
      {
        ATV_TORBOX_API_KEY: TOKEN,
        ATV_GDRIVE_MAP: JSON.stringify({ "news-us": "https://secret.example/news.m3u8" }),
      },
    );

    const { body } = await call(worker, env, "/api/resolve?id=news-us");
    expect(body.url).toBe("https://secret.example/news.m3u8");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers a TorBox mapping over a link seeded into KV", async () => {
    mockTorbox();
    const worker = await freshWorker();
    const env = makeEnv(
      {
        channels,
        gdrive_map: { "news-us": "https://cdn.example/news.m3u8" },
        torbox_map: { "news-us": torrent },
      },
      { ATV_TORBOX_API_KEY: TOKEN },
    );

    const { body } = await call(worker, env, "/api/resolve?id=news-us");
    expect(body.url).toBe("https://cdn.torbox.example/file.mp4");
  });

  it("refuses a plain-HTTP link TorBox returns", async () => {
    mockTorbox("http://cdn.torbox.example/file.mp4");
    const worker = await freshWorker();
    const env = makeEnv(
      { channels, torbox_map: { "news-us": torrent } },
      { ATV_TORBOX_API_KEY: TOKEN },
    );

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us");
    expect(res.status).toBe(502);
    expect(body.code).toBe("insecure_url");
  });

  it("reports a TorBox failure without leaking the token", async () => {
    mockTorbox(undefined, 403);
    const worker = await freshWorker();
    const env = makeEnv(
      { channels, torbox_map: { "news-us": torrent } },
      { ATV_TORBOX_API_KEY: TOKEN },
    );

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us");
    expect(res.status).toBe(502);
    expect(body.code).toBe("resolve_failed");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("fails a mapped channel loudly when the token secret is missing", async () => {
    const worker = await freshWorker();
    const env = makeEnv({ channels, torbox_map: { "news-us": torrent } });

    const { res, body } = await call(worker, env, "/api/resolve?id=news-us");
    // Not a 404: the channel exists, the deployment is incomplete.
    expect(res.status).toBe(502);
    expect(body.code).toBe("resolve_failed");
  });

  it("counts TorBox coverage as configured only when the token is present", async () => {
    const worker = await freshWorker();
    const withKey = makeEnv(
      { channels, config_meta: meta, torbox_map: { "news-us": torrent } },
      { ATV_TORBOX_API_KEY: TOKEN },
    );
    expect((await call(worker, withKey, "/api/health")).body.resolve).toEqual({
      configured: 1,
      invalid: 0,
      missing: 1,
    });

    const withoutKey = makeEnv({ channels, torbox_map: { "news-us": torrent } });
    expect((await call(worker, withoutKey, "/api/health")).body.resolve).toEqual({
      configured: 0,
      invalid: 0,
      missing: 2,
    });
  });

  it("counts a malformed mapping as invalid rather than ready", async () => {
    const worker = await freshWorker();
    const env = makeEnv(
      { channels, torbox_map: { "news-us": { kind: "torrent", torrentId: "eleven" } } },
      { ATV_TORBOX_API_KEY: TOKEN },
    );
    expect((await call(worker, env, "/api/health")).body.resolve).toEqual({
      configured: 0,
      invalid: 1,
      missing: 1,
    });
  });

  // A hover prefetch and the Enter that follows it resolve the same channel at
  // once, and a second TV can do it at the same time. Without a shared promise
  // each of them mints its own link and spends its own TorBox call.
  it("shares one TorBox request between concurrent resolves of the same item", async () => {
    const fetchMock = mockTorbox();
    const worker = await freshWorker();
    const env = makeEnv(
      { channels, torbox_map: { "news-us": torrent } },
      { ATV_TORBOX_API_KEY: TOKEN },
    );

    const [first, second] = await Promise.all([
      call(worker, env, "/api/resolve?id=news-us"),
      call(worker, env, "/api/resolve?id=news-us"),
    ]);

    expect(first.body.url).toBe("https://cdn.torbox.example/file.mp4");
    expect(second.body.url).toBe("https://cdn.torbox.example/file.mp4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed call instead of caching the failure", async () => {
    mockTorbox(undefined, 403);
    const worker = await freshWorker();
    const env = makeEnv(
      { channels, torbox_map: { "news-us": torrent } },
      { ATV_TORBOX_API_KEY: TOKEN },
    );
    expect((await call(worker, env, "/api/resolve?id=news-us")).res.status).toBe(502);

    const retry = mockTorbox();
    const second = await call(worker, env, "/api/resolve?id=news-us");
    expect(second.res.status).toBe(200);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
