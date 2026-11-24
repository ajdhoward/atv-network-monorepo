import { describe, expect, it, vi } from "vitest";
import {
  BATCH_SIZE,
  checkLinks,
  chunk,
  classifyBatch,
  loadChannels,
  type LinkProgress,
} from "../src/links";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("chunk", () => {
  it("splits into full batches and a remainder", () => {
    const ids = Array.from({ length: 45 }, (_, i) => `c${i}`);
    const batches = chunk(ids, BATCH_SIZE);
    expect(batches.map((b) => b.length)).toEqual([20, 20, 5]);
    expect(batches.flat()).toEqual(ids);
  });

  it("returns nothing for an empty list", () => {
    expect(chunk([], BATCH_SIZE)).toEqual([]);
  });
});

describe("classifyBatch", () => {
  it("marks resolved, missing and invalid ids", () => {
    const states = classifyBatch(["a", "b", "c"], {
      resolved: [{ id: "a", url: "https://example/x.m3u8" }],
      missing: ["b"],
      invalid: ["c"],
    });
    expect(states).toEqual({ a: "configured", b: "missing", c: "invalid" });
  });

  // P5: the link exists and the deployment cannot proxy it. Reporting that as
  // "no link" would send the operator to seed a map they already seeded.
  it("names a Drive link the deployment cannot proxy", () => {
    expect(classifyBatch(["a"], { unconfigured: ["a"] })).toEqual({ a: "unconfigured" });
  });

  it("treats an id the worker did not account for as missing", () => {
    expect(classifyBatch(["a", "b"], { resolved: [{ id: "a" }] })).toEqual({
      a: "configured",
      b: "missing",
    });
  });

  it("survives an empty or malformed body", () => {
    expect(classifyBatch(["a"], {})).toEqual({ a: "missing" });
    expect(classifyBatch(["a"], { resolved: [{ id: 42 } as never] })).toEqual({ a: "missing" });
  });
});

describe("loadChannels", () => {
  // The guide is the one payload the panel does not control: without narrowing,
  // a channel with no id became an `?ids=undefined` batch and a nameless row.
  it("drops a channel it could not address or name", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, {
        channels: [
          { id: "a", name: "A", country: "US", category: "news", genres: [] },
          { id: 7, name: "not-a-string-id" },
          { id: "c" },
          { nope: true },
        ],
        nextCursor: null,
      }),
    );

    const channels = await loadChannels(fetchImpl as unknown as typeof fetch);

    expect(channels.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("checkLinks", () => {
  it("loads the guide, batches resolve and returns the link shown by channel", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("/api/guide")) {
        return json(200, {
          channels: [
            { id: "atv-1", name: "ATV One", country: "US", category: "news", genres: [] },
            { id: "atv-2", name: "ATV Two", country: "US", category: "news", genres: [] },
          ],
          nextCursor: null,
        });
      }
      expect(url).toBe("/api/resolve?ids=atv-1,atv-2");
      return json(200, { resolved: [{ id: "atv-1", url: "https://x/y" }], missing: ["atv-2"] });
    });

    await expect(checkLinks(fetchImpl as unknown as typeof fetch)).resolves.toEqual([
      { id: "atv-1", name: "ATV One", state: "configured" },
      { id: "atv-2", name: "ATV Two", state: "missing" },
    ]);
  });

  it("follows guide pages and keeps every channel", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "/api/guide") {
        return json(200, {
          channels: [{ id: "a", name: "A", country: "US", category: "news", genres: [] }],
          nextCursor: "p2",
        });
      }
      if (url === "/api/guide?cursor=p2") {
        return json(200, {
          channels: [{ id: "b", name: "B", country: "US", category: "news", genres: [] }],
          nextCursor: null,
        });
      }
      return json(200, { resolved: [], missing: ["a", "b"] });
    });

    const checks = await checkLinks(fetchImpl as unknown as typeof fetch);
    expect(checks.map((c) => c.id)).toEqual(["a", "b"]);
    expect(checks.every((c) => c.state === "missing")).toBe(true);
  });

  it("reports a failed resolve batch instead of calling every channel missing", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("/api/guide")
        ? json(200, {
            channels: [{ id: "a", name: "A", country: "US", category: "news", genres: [] }],
            nextCursor: null,
          })
        : json(503, { error: "unavailable" }),
    );

    // A 503 is the deployment's own fault (its token or signing key), so the
    // message names that rather than a status the operator cannot act on.
    await expect(checkLinks(fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "cannot resolve streams right now (503)",
    );
  });

  it("reports a failed guide fetch", async () => {
    const fetchImpl = vi.fn(async () => json(503, {}));
    await expect(checkLinks(fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "guide responded 503",
    );
  });

  it("never sends stream links back to the panel", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("/api/guide")
        ? json(200, {
            channels: [{ id: "a", name: "A", country: "US", category: "news", genres: [] }],
            nextCursor: null,
          })
        : json(200, { resolved: [{ id: "a", url: "https://secret/x.m3u8" }] }),
    );

    const checks = await checkLinks(fetchImpl as unknown as typeof fetch);
    expect(JSON.stringify(checks)).not.toContain("secret");
  });

  // The panel shows this instead of a blank button while the walk runs.
  it("reports how far the walk has got", async () => {
    const ids = Array.from({ length: BATCH_SIZE + 2 }, (_, i) => `c${i}`);
    const seen: LinkProgress[] = [];
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("/api/guide")
        ? json(200, {
            channels: ids.map((id) => ({ id, name: id })),
            nextCursor: null,
          })
        : json(200, { resolved: [], missing: [] }),
    );

    await checkLinks(fetchImpl as unknown as typeof fetch, (progress) => seen.push(progress));

    expect(seen).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
  });

  // R6: the guide stays public, the resolve batch does not. Only the resolve
  // calls may carry the token, and only the panel's own copy of it.
  it("sends the household token with the resolve batches and not the guide", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return url.startsWith("/api/guide")
        ? json(200, { channels: [{ id: "a", name: "A" }], nextCursor: null })
        : json(200, { resolved: [{ id: "a" }], missing: [], invalid: [] });
    });

    await checkLinks(fetchImpl as unknown as typeof fetch, undefined, "household-secret");

    const guide = calls.find((call) => call.url.startsWith("/api/guide"));
    const resolve = calls.find((call) => call.url.startsWith("/api/resolve"));
    expect(guide?.headers.Authorization).toBeUndefined();
    expect(resolve?.headers.Authorization).toBe("Bearer household-secret");
  });

  it("names the token on a 401 instead of calling every channel broken", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("/api/guide")
        ? json(200, { channels: [{ id: "a", name: "A" }], nextCursor: null })
        : json(401, { code: "unauthorized" }),
    );

    await expect(checkLinks(fetchImpl as unknown as typeof fetch, undefined, null)).rejects.toThrow(
      "household token",
    );
  });
});
