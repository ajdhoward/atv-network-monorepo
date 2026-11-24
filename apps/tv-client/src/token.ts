// The household token: one secret for every TV, kept where a client change can
// reach an already-installed APK without re-sideloading it.
//
// `decisions.md` (2026-11-23, option C) makes `/api/resolve` require
// `Authorization: Bearer <ATV_DEVICE_TOKEN>` once enforcement lands. The token
// lives in localStorage rather than in the shell, so the one TV that is already
// installed takes it on its next load. The guide stays public: a TV with no
// token is a normal state, not an error, and the player asks for one the first
// time resolve answers 401.
//
// The Fire OS shell enables DOM storage, but a write can still be refused (a
// full quota, a WebView with storage off), so every access here is allowed to
// fail without breaking playback. Same reason as `guide.ts`'s cache.

export const TOKEN_KEY = "atv:token:v1";

// Only the three methods this module uses, so a test can pass a Map-backed
// stand-in and a WebView without storage can pass null.
export type TokenStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): TokenStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// Anything a prompt produces is trimmed, and an empty or whitespace-only string
// means "no token" rather than a header with nothing in it. No other rewriting:
// the value is a secret, not a name.
export function normaliseToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return token ? token : null;
}

export function readToken(store: TokenStore | null = browserStore()): string | null {
  try {
    return normaliseToken(store?.getItem(TOKEN_KEY));
  } catch {
    return null;
  }
}

// False means the token was blank or storage refused it, so the caller can say
// it was not saved instead of showing a prompt that will reappear on the next
// launch after the household believes it is done.
export function saveToken(token: string, store: TokenStore | null = browserStore()): boolean {
  const value = normaliseToken(token);
  if (!value || !store) return false;
  try {
    store.setItem(TOKEN_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function clearToken(store: TokenStore | null = browserStore()): void {
  try {
    store?.removeItem(TOKEN_KEY);
  } catch {
    // A token that cannot be removed is still replaced by the next save.
  }
}

// The header itself, in one place so the two resolve call sites cannot disagree
// about its spelling. It is never put in a query string, where it would land in
// logs, analytics and referrers.
export function authorizationHeader(token: string | null): Record<string, string> {
  const value = normaliseToken(token);
  return value ? { Authorization: `Bearer ${value}` } : {};
}
