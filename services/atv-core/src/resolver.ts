import { kvJson, type Env } from "./env";
import { proxyTicket } from "./stream";
import { parseTorboxRef, resolveTorbox, torboxToken } from "./torbox";

export type ResolvedLink = { url: string; headers?: Record<string, string>; profile: string };

// Links the operator supplies directly in the Worker secret ATV_GDRIVE_MAP
// (`{"<id>": "https://…"}`), so a stream can be added or rotated with
// `wrangler secret put` instead of re-seeding the whole lineup into KV.
//
// The secret wins over KV: it is the newer instruction, and it keeps a link that
// must not sit in the shared config out of it. Parsed once per isolate per
// value; a malformed secret is logged and ignored rather than taking
// /api/resolve down for every id.
let operatorCache: { raw: string; map: Record<string, string> | null } | null = null;

function operatorMap(env: Env): Record<string, string> | null {
  const raw = env.ATV_GDRIVE_MAP;
  if (!raw) return null;
  if (operatorCache?.raw === raw) return operatorCache.map;

  let map: Record<string, string> | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      map = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } else {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "ATV_GDRIVE_MAP is not a JSON object; ignoring it",
        }),
      );
    }
  } catch {
    console.warn(
      JSON.stringify({ level: "warn", message: "ATV_GDRIVE_MAP is not valid JSON; ignoring it" }),
    );
  }
  operatorCache = { raw, map };
  return map;
}

export type StreamCoverage = { configured: number; invalid: number; missing: number };

// How much of the lineup /api/resolve can answer for. Reports counts only: the
// links themselves stay out of every response, so health stays safe to expose.
// An id the secret covers is checked there rather than in KV, the same
// precedence resolveStream uses.
export async function streamCoverage(env: Env, ids: string[]): Promise<StreamCoverage> {
  const operator = operatorMap(env);
  const stored = await kvJson<Record<string, string>>(env.ATV_CONFIG, "gdrive_map");
  const torbox = await kvJson<Record<string, unknown>>(env.ATV_CONFIG, "torbox_map");
  const torboxReady = !!torboxToken(env);
  let configured = 0;
  let invalid = 0;
  for (const id of ids) {
    // Same precedence as resolveStream: a direct operator link wins over the
    // TorBox map, which wins over the KV link map.
    const url = operator?.[id] ?? stored?.[id];
    if (typeof url === "string" && url) {
      // A non-HTTPS link resolves to a 502, so it is neither usable nor missing.
      if (url.startsWith("https://")) configured++;
      else invalid++;
      continue;
    }
    if (torbox && id in torbox) {
      // A mapped id with no token is missing coverage, not a broken link: the
      // operator still has to add the secret. A malformed entry is a typo.
      if (torboxReady && parseTorboxRef(torbox[id])) configured++;
      else if (torboxReady) invalid++;
    }
  }
  return { configured, invalid, missing: ids.length - configured - invalid };
}

// The link the maps hold for an id, with no provider call: the operator secret
// first, then KV `gdrive_map`. `/api/stream` serves bytes from one of these two
// and must never spend a TorBox resolve on a media request — a TorBox link is
// already short-lived media, not a Drive file to proxy.
export async function mappedLink(id: string, env: Env): Promise<string | null> {
  const operator = operatorMap(env)?.[id];
  if (typeof operator === "string" && operator) return operator;
  const stored = (await kvJson<Record<string, string>>(env.ATV_CONFIG, "gdrive_map"))?.[id];
  return typeof stored === "string" && stored ? stored : null;
}

export async function resolveStream(id: string, env: Env): Promise<ResolvedLink> {
  // Precedence: the operator secret is the newest instruction, then the TorBox
  // map (which asks TorBox at resolve time), then a link seeded into KV.
  const operator = operatorMap(env)?.[id];
  const link =
    (typeof operator === "string" && operator ? operator : null) ??
    (await resolveTorbox(id, env)) ??
    (await mappedLink(id, env));
  if (!link) throw new Error("not found");
  if (!link.startsWith("https://")) throw new Error("insecure url blocked - TLS 1.3 required");
  // P1: a Drive link is replaced by a same-origin ticket, because Drive has no
  // playable URL. Anything else (a CDN file, a TorBox link) is handed over as it
  // was: proxying a playlist without rewriting its segments would break it.
  return { url: await proxyTicket(id, link, env), profile: "1080p_hevc" };
}
