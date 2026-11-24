import { describe, expect, it } from "vitest";
import { authHeader, readLinkToken, saveLinkToken, type TokenStore } from "../src/linkToken";

function mapStore() {
  const map = new Map<string, string>();
  const store: TokenStore = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return { store, map };
}

const refusing: TokenStore = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("quota exceeded");
  },
  removeItem: () => {},
};

describe("linkToken", () => {
  it("round-trips a trimmed token", () => {
    const { store, map } = mapStore();

    expect(saveLinkToken("  household-secret  ", store)).toBe(true);
    expect([...map.values()]).toEqual(["household-secret"]);
    expect(readLinkToken(store)).toBe("household-secret");
  });

  it("treats a blank token as none, so an empty field cannot be saved", () => {
    const { store } = mapStore();

    expect(saveLinkToken("   ", store)).toBe(false);
    expect(saveLinkToken("", store)).toBe(false);
    expect(readLinkToken(store)).toBeNull();
  });

  it("survives storage that refuses or is absent", () => {
    expect(saveLinkToken("abc", refusing)).toBe(false);
    expect(readLinkToken(refusing)).toBeNull();
    expect(saveLinkToken("abc", null)).toBe(false);
    expect(readLinkToken(null)).toBeNull();
  });

  it("builds a bearer header only when there is a token", () => {
    expect(authHeader("abc")).toEqual({ Authorization: "Bearer abc" });
    expect(authHeader("  abc  ")).toEqual({ Authorization: "Bearer abc" });
    expect(authHeader(null)).toEqual({});
    expect(authHeader("   ")).toEqual({});
  });
});
