// The admin panel's copy of the household token.
//
// R6 puts the token in front of `/api/resolve`, and this panel runs on the same
// origin, so its stream-link check needs one too. It is typed once per browser and
// kept in localStorage: compiling it into the bundle would publish it to anyone who
// opens the JavaScript, which is the thing R1 rejected.
//
// Deliberately not shared with `apps/tv-client/src/token.ts`: the two bundles have
// no runtime module in common, and a workspace package for this much code would
// need a build step of its own. The key differs, so the two never collide.

export type TokenStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "atv:admin:token:v1";

function browserStore(): TokenStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// `undefined` means "this browser's storage", `null` means "there is none" — the
// same distinction the TV's store makes, so a test can pass a stand-in.
function resolveStore(store?: TokenStore | null): TokenStore | null {
  return store === undefined ? browserStore() : store;
}

export function readLinkToken(store?: TokenStore | null): string | null {
  const target = resolveStore(store);
  if (!target) return null;
  try {
    const value = target.getItem(KEY)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

export function saveLinkToken(token: string, store?: TokenStore | null): boolean {
  const value = token.trim();
  const target = resolveStore(store);
  if (!value || !target) return false;
  try {
    target.setItem(KEY, value);
    return true;
  } catch {
    return false;
  }
}

// The header R6 wants, spelled once so the check and any later caller agree.
export function authHeader(token: string | null): Record<string, string> {
  const value = token?.trim();
  return value ? { Authorization: `Bearer ${value}` } : {};
}
