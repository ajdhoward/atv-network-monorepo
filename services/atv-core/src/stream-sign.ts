// Signed stream URLs for the Drive proxy — P1, before the route exists.
//
// A `<video src>` cannot send `Authorization`, which is why option C puts the
// household token on `/api/resolve` rather than on media. The proxy therefore
// takes a ticket instead: `/api/resolve` mints one per link and `/api/stream/<id>`
// accepts it. The authenticated half is the resolve call; the media request is
// authorised by carrying its own expiry and signature.
//
// HMAC-SHA256 under a Worker secret binds the ticket to one id — a URL cannot be
// pointed at another channel — and `exp` is inside the signed text, so it cannot
// be extended without the secret. The default is 15 minutes: long enough for a
// TV that resolves a link and then buffers, short enough that a leaked URL is not
// a standing invitation.
//
// The secret is passed in rather than read here, the same shape as
// `device-token.ts`: no binding, no `Env`, and the wiring change is where
// `ATV_STREAM_SIGNING_KEY` enters `env.ts` and the continuity inventory together.

export const DEFAULT_TTL_S = 15 * 60;

// `unconfigured` is the deployment's fault and gets its own answer: a 403 there
// would read as "this link is wrong" when the operator has simply not set the
// secret yet.
export type StreamTicketCheck = "ok" | "expired" | "bad-signature" | "missing" | "unconfigured";

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// `\n` cannot appear in a channel id, so `abc`+`12` and `abc1`+`2` cannot produce
// the same signed text.
function signedText(id: string, exp: number): string {
  return `${id}\n${exp}`;
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Returns the path and query a `<video>` can use as-is. `encodeURIComponent` keeps
// an id like `news/us` from becoming a path segment of its own while the ticket
// still signs the decoded id the route will read back.
export async function signStreamUrl(
  id: string,
  secret: string,
  opts: { now?: number; ttlS?: number } = {},
): Promise<string> {
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + (opts.ttlS ?? DEFAULT_TTL_S);
  const sig = await hmac(secret, signedText(id, exp));
  return `/api/stream/${encodeURIComponent(id)}?exp=${exp}&sig=${sig}`;
}

export async function checkStreamTicket(args: {
  id: string;
  exp: string | null;
  sig: string | null;
  secret: string | null | undefined;
  now?: number;
}): Promise<StreamTicketCheck> {
  const secret = typeof args.secret === "string" ? args.secret.trim() : "";
  if (!secret) return "unconfigured";
  if (!args.exp || !args.sig) return "missing";

  const exp = Number(args.exp);
  // A non-integer expiry cannot have been signed by us; it is a forged ticket, not
  // a missing one, and the two are worth separate answers in the logs.
  if (!Number.isSafeInteger(exp)) return "bad-signature";

  const expected = await hmac(secret, signedText(args.id, exp));
  if (!equalHex(expected, args.sig)) return "bad-signature";

  // Checked after the signature: an expired ticket that verifies is a real link
  // past its time, and a forged one is not told anything about expiry.
  const nowS = Math.floor((args.now ?? Date.now()) / 1000);
  return exp <= nowS ? "expired" : "ok";
}
