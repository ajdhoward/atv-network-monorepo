// The household token check for `/api/resolve` — R6, before it is wired in.
//
// Option C (`decisions.md`, 2026-11-23) puts one token in front of the resolve
// endpoint. This module is the comparison alone: it takes what a request
// presented and what the deployment expects, and answers allow, reject or
// unenforced. It reads no binding and imports nothing, so it can be tested
// without an `Env` and the wiring step is a single call in the router.
//
// Two properties matter more than the comparison itself:
//
// - the token never appears in a log, a response or a return value, so nothing
//   here hands it back — only a verdict;
// - the comparison runs over SHA-256 digests and touches every byte, so how long
//   it takes says nothing about how much of a guess was right.
//
// The secret is read by the caller, not here, so adding `ATV_DEVICE_TOKEN` to
// `Env` and to the inventory in `docs/continuity.md` happens in the wiring
// change — the one that actually uses the name.

export type DeviceTokenVerdict = "allow" | "reject" | "unenforced" | "unpresentable";

// Reads the credential out of an `Authorization` header. The scheme is
// case-insensitive (RFC 6750 §2.1) and a header may carry stray whitespace; a
// second scheme, a bare `Bearer`, or a value with spaces inside it is not a
// token this deployment issues, so it reads as nothing rather than as a guess.
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^bearer[ \t]+(\S+)[ \t]*$/i.exec(header.trim());
  return match ? match[1] : null;
}

async function digest(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

// Compares every byte and folds the result at the end: `===` on two strings
// returns at the first difference, which is exactly the leak the digest avoids.
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// `unenforced` is a distinct answer, not a lenient `allow`: it is what a
// deployment with no secret configured does, and what makes shipping this check
// before every TV has a token safe. R8 sets the secret; from then on the same
// request path answers allow or reject — or `unpresentable`, which is not the
// caller's fault at all (Q10).

// `bearerToken` matches one token (`(\S+)`), so a secret with whitespace inside
// it can never arrive: every TV holding the right value would be told it is
// wrong. That is a deployment misconfiguration and gets its own answer, so a
// 503 can say so instead of a 401 blaming the household for a typo that is not
// theirs. Whitespace at the ends is trimmed above and is harmless.
function unpresentable(secret: string): boolean {
  return /\s/.test(secret);
}

export async function checkDeviceToken(
  header: string | null,
  expected: string | null | undefined,
): Promise<DeviceTokenVerdict> {
  const wanted = typeof expected === "string" ? expected.trim() : "";
  if (!wanted) return "unenforced";
  if (unpresentable(wanted)) return "unpresentable";
  const presented = bearerToken(header);
  if (!presented) return "reject";
  const [given, mine] = await Promise.all([digest(presented), digest(wanted)]);
  return equalBytes(given, mine) ? "allow" : "reject";
}
