import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadGuide } from "../src/guide.js";

const CACHE_KEY = "atv:guide:v1";

const channel = (id: string) => ({
  id,
  name: id,
  country: "US",
  category: "news",
  genres: [],
});

// guide.ts only needs getItem/setItem; a Map-backed stand-in keeps the tests in
// the node environment instead of pulling in jsdom.
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}

function page(channels: unknown[], nextCursor: string | null) {
  return new Response(JSON.stringify({ channels, nextCursor }), {
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("loadGuide", () => {
  it("follows nextCursor across pages and caches the whole lineup", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        seen.push(input);
        return input.includes("cursor=1")
          ? page([channel("bravo")], null)
          : page([channel("alpha")], "1");
      }),
    );

    const result = await loadGuide();

    expect(result.stale).toBe(false);
    expect(result.channels.map((c) => c.id)).toEqual(["alpha", "bravo"]);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("cursor=1");

    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) as string);
    expect(cached.channels.map((c: { id: string }) => c.id)).toEqual(["alpha", "bravo"]);
  });

  it("serves the cached lineup with stale=true when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => page([channel("alpha")], null)),
    );
    await loadGuide();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await loadGuide();
    expect(result.stale).toBe(true);
    expect(result.channels.map((c) => c.id)).toEqual(["alpha"]);
  });

  it("rejects when the network fails and nothing is cached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(loadGuide()).rejects.toThrow("network down");
  });

  it("ignores a cache with no usable channels", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ channels: [{ nope: true }] }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(loadGuide()).rejects.toThrow("network down");
  });
});
