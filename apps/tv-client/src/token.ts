// The household token: one secret for every TV, kept where a client change can
// reach an already-installed APK without re-sideloading it.
//
// `decisions.md` (2026-11-23, option C) has `/api/resolve` require
// `Authorization: Bearer <ATV_DEVICE_TOKEN>` once enforcement lands. The token
// lives in localStorage rather than in the shell, so an installed TV takes it on
// its next load instead of waiting for a new APK. The guide stays public: a TV
// with no token is a normal state, not an error.
//
// Only the storage half exists so far. R5 still has to read this token in
// `resolve.ts` and `playerManager.js` and turn a 401 into the prompt that fills
// it in; until then nothing sends the header, and the Worker does not ask for one.
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

// Every access below fails the same two ways: no storage at all, or storage that
// throws. One wrapper keeps the three callers from growing three slightly
// different guards, and hands each the value it should be left with.
function attempt<T>(run: (store: TokenStore) => T, fallback: T, store: TokenStore | null): T {
  if (!store) return fallback;
  try {
    return run(store);
  } catch {
    return fallback;
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
  return attempt((s) => normaliseToken(s.getItem(TOKEN_KEY)), null, store);
}

// False means the token was blank or storage refused it, so the caller can say
// it was not saved instead of showing a prompt that will reappear on the next
// launch after the household believes it is done.
export function saveToken(token: string, store: TokenStore | null = browserStore()): boolean {
  const value = normaliseToken(token);
  if (!value) return false;
  return attempt(
    (s) => {
      s.setItem(TOKEN_KEY, value);
      return true;
    },
    false,
    store,
  );
}

export function clearToken(store: TokenStore | null = browserStore()): void {
  // A token that cannot be removed is still replaced by the next save.
  attempt((s) => s.removeItem(TOKEN_KEY), undefined, store);
}

// The header itself, in one place so the resolve call sites cannot disagree about
// its spelling once R5 sends it. It is never put in a query string, where it would
// land in logs, analytics and referrers.
export function authorizationHeader(token: string | null): Record<string, string> {
  const value = normaliseToken(token);
  return value ? { Authorization: `Bearer ${value}` } : {};
}
