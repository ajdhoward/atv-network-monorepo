// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  TOKEN_KEY,
  authorizationHeader,
  clearToken,
  normaliseToken,
  readToken,
  saveToken,
  type TokenStore,
} from "../src/token";

function mapStore() {
  const map = new Map<string, string>();
  const store: TokenStore = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return { store, map };
}

// Every write this WebView might refuse: a full quota, storage turned off.
const refusing: TokenStore = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("quota exceeded");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};

describe("token", () => {
  it("trims a pasted value and treats blank as no token", () => {
    expect(normaliseToken("  abc.def  ")).toBe("abc.def");
    expect(normaliseToken("   ")).toBeNull();
    expect(normaliseToken(undefined)).toBeNull();
    expect(normaliseToken(42)).toBeNull();
  });

  it("round-trips a saved token through the documented key", () => {
    const { store, map } = mapStore();
    expect(saveToken(" abc ", store)).toBe(true);
    expect(map.get(TOKEN_KEY)).toBe("abc");
    expect(readToken(store)).toBe("abc");
  });

  it("reports a refused write instead of pretending it saved", () => {
    expect(saveToken("abc", refusing)).toBe(false);
    expect(readToken(refusing)).toBeNull();
    expect(saveToken("   ", mapStore().store)).toBe(false);
    expect(saveToken("abc", null)).toBe(false);
    expect(readToken(null)).toBeNull();
    expect(() => clearToken(refusing)).not.toThrow();
    expect(() => clearToken(null)).not.toThrow();
  });

  it("clears the stored token", () => {
    const { store, map } = mapStore();
    saveToken("abc", store);
    clearToken(store);
    expect(map.has(TOKEN_KEY)).toBe(false);
    expect(readToken(store)).toBeNull();
  });

  it("builds a bearer header, and nothing at all without a token", () => {
    expect(authorizationHeader("abc")).toEqual({ Authorization: "Bearer abc" });
    expect(authorizationHeader("  abc  ")).toEqual({ Authorization: "Bearer abc" });
    expect(authorizationHeader(null)).toEqual({});
    expect(authorizationHeader("   ")).toEqual({});
  });
});
