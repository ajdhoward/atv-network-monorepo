import { kvJson, type Env } from "./env";

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

export async function resolveStream(id: string, env: Env): Promise<ResolvedLink> {
  // An id the secret covers needs no KV read at all.
  const operator = operatorMap(env)?.[id];
  const direct =
    operator ?? (await kvJson<Record<string, string>>(env.ATV_CONFIG, "gdrive_map"))?.[id];
  if (!direct) throw new Error("not found");
  if (!direct.startsWith("https://")) throw new Error("insecure url blocked - TLS 1.3 required");
  return { url: direct, profile: "1080p_hevc" };
}
