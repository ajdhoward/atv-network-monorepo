// TorBox links: the operator maps a channel to an item in their TorBox account,
// and the Worker asks TorBox for a time-limited CDN link at resolve time.
//
// The API token lives in the Worker secret ATV_TORBOX_API_KEY. It is never sent
// to a TV, never written to KV and never logged; the device receives only the
// CDN URL, which it plays directly over TLS. Asking TorBox per resolve would
// spend 300 requests/minute at a grid sweep, so a link is cached per isolate for
// half of the three-hour window TorBox opens.
import { kvJson, type Env } from "./env";

export type TorboxKind = "torrent" | "usenet" | "webdl";

export type TorboxRef = { kind: TorboxKind; itemId: number; fileId: number };

// Endpoint and item id parameter for each TorBox library (see api-docs.torbox.app).
const ENDPOINTS: Record<TorboxKind, { path: string; param: string }> = {
  torrent: { path: "torrents/requestdl", param: "torrent_id" },
  usenet: { path: "usenet/requestdl", param: "usenet_id" },
  webdl: { path: "webdl/requestdl", param: "webdl_id" },
};

const LINK_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { url: string; expiresAt: number }>();

function nonNegativeInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

// A map entry is `{ "kind"?: "torrent"|"usenet"|"webdl", "<kind>Id": n, "fileId": n }`.
// A malformed entry is a config error, not a missing channel, so the caller can
// tell an operator typo apart from a channel that was never mapped.
export function parseTorboxRef(value: unknown): TorboxRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const kind = entry.kind === undefined ? "torrent" : entry.kind;
  if (kind !== "torrent" && kind !== "usenet" && kind !== "webdl") return null;
  const itemId = nonNegativeInt(entry[`${kind}Id`]);
  const fileId = nonNegativeInt(entry.fileId);
  if (itemId === null || fileId === null) return null;
  return { kind, itemId, fileId };
}

export function torboxToken(env: Env): string | null {
  const token = env.ATV_TORBOX_API_KEY?.trim();
  return token ? token : null;
}

// null means "this channel is not mapped to TorBox", so another source can
// answer for it. A thrown error means TorBox was asked and could not answer.
export async function resolveTorbox(id: string, env: Env): Promise<string | null> {
  const map = await kvJson<Record<string, unknown>>(env.ATV_CONFIG, "torbox_map");
  if (!map || !(id in map)) return null;
  const ref = parseTorboxRef(map[id]);
  if (!ref) throw new Error("torbox map entry is malformed");
  const token = torboxToken(env);
  // Without the secret the channel is mapped but unusable; reporting it as
  // "not found" would hide the missing key from the operator.
  if (!token) throw new Error("torbox token is not configured");

  const key = `${ref.kind}:${ref.itemId}:${ref.fileId}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  const endpoint = new URL(`https://api.torbox.app/v1/api/${ENDPOINTS[ref.kind].path}`);
  endpoint.searchParams.set("token", token);
  endpoint.searchParams.set(ENDPOINTS[ref.kind].param, String(ref.itemId));
  endpoint.searchParams.set("file_id", String(ref.fileId));

  const res = await fetch(endpoint.toString(), {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  // Never echo the upstream body: it can quote the token and the link.
  if (!res.ok) throw new Error(`torbox responded ${res.status}`);
  const body = (await res.json()) as { success?: unknown; data?: unknown } | null;
  const data = body?.data as { url?: unknown } | string | undefined;
  const link = typeof data === "string" ? data : typeof data?.url === "string" ? data.url : null;
  if (!link) throw new Error("torbox returned no link");
  if (!link.startsWith("https://")) throw new Error("insecure url blocked - TLS 1.3 required");

  cache.set(key, { url: link, expiresAt: Date.now() + LINK_TTL_MS });
  return link;
}
