import { describe, expect, it } from "vitest";
import { kvJson } from "../src/env";

// Only `get(key, "json")` is used by readJson, and the call count is the point:
// these tests are about how many reads reach KV, not about its contents.
function fakeKv(value: unknown, options: { delayMs?: number; failFirst?: boolean } = {}) {
  const reads: string[] = [];
  const kv = {
    async get(key: string, type?: string) {
      reads.push(key);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.failFirst && reads.length === 1) throw new Error("kv read failed");
      if (value === undefined) return null;
      return type === "json" ? JSON.parse(JSON.stringify(value)) : JSON.stringify(value);
    },
  };
  return { kv: kv as unknown as KVNamespace, reads };
}

describe("kvJson", () => {
  it("reads a key once inside the memo window", async () => {
    const { kv, reads } = fakeKv({ a: 1 });

    expect(await kvJson(kv, "memo-once")).toEqual({ a: 1 });
    expect(await kvJson(kv, "memo-once")).toEqual({ a: 1 });

    expect(reads).toHaveLength(1);
  });

  // A grid sweep resolves many channels at once, and every one of them reads the
  // same map: a cold isolate must not issue one KV read per channel.
  it("shares one read between concurrent callers", async () => {
    const { kv, reads } = fakeKv({ a: 1 }, { delayMs: 10 });

    const results = await Promise.all([
      kvJson(kv, "memo-concurrent"),
      kvJson(kv, "memo-concurrent"),
      kvJson(kv, "memo-concurrent"),
    ]);

    expect(results).toEqual([{ a: 1 }, { a: 1 }, { a: 1 }]);
    expect(reads).toHaveLength(1);
  });

  it("does not remember a failed read", async () => {
    const { kv, reads } = fakeKv({ a: 1 }, { failFirst: true });

    await expect(kvJson(kv, "memo-failure")).rejects.toThrow("kv read failed");
    expect(await kvJson(kv, "memo-failure")).toEqual({ a: 1 });

    expect(reads).toHaveLength(2);
  });
});
