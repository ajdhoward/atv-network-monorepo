import type { ChannelDef } from "@atv/ui-shared";
import { backupConfig } from "./backup";
import { CONFIG_SCHEMA_VERSION, checksum, type ConfigMeta } from "./config-meta";
import { kvJson, readJson, type Env } from "./env";
import { resolveStream } from "./resolver";
import { runRulesIndex } from "./rules";

export type { Env };

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Content-Type-Options": "nosniff",
};

// A config written by a newer generator is not something this build can index.
class ConfigSchemaError extends Error {
  constructor(readonly found: number) {
    super(`config schema ${found} does not match ${CONFIG_SCHEMA_VERSION}`);
    this.name = "ConfigSchemaError";
  }
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS,
      ...headers,
    },
  });
}

function failure(
  code: string,
  message: string,
  requestId: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return json({ error: message, code, requestId }, status, headers);
}

function logFailure(requestId: string, path: string, err: unknown): void {
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      path,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}

// The request id is attached here for every response, including 304s.
function withRequestId(response: Response, requestId: string): Response {
  if (response.headers.has("X-Request-Id")) return response;
  const copy = new Response(response.body, response);
  copy.headers.set("X-Request-Id", requestId);
  return copy;
}

function statusBody(env: Env) {
  return {
    name: "ATV Core",
    status: "live",
    domain: "atv.acidwurx.org",
    env: env.SYSTEM_ENV ?? "unknown",
    time: new Date().toISOString(),
  };
}

type Lineup = { raw: unknown[]; channels: ChannelDef[] };

// `raw` is the value exactly as seeded: config_meta's checksum is computed over
// it, so it must not be normalised before comparison.
async function loadLineup(env: Env): Promise<Lineup> {
  const direct = await readJson<unknown>(env.ATV_CONFIG, "channels");
  const system = Array.isArray(direct)
    ? null
    : await readJson<{ channels?: unknown }>(env.ATV_CONFIG, "system_config");
  const raw = Array.isArray(direct) ? direct : system?.channels;
  if (!Array.isArray(raw)) return { raw: [], channels: [] };
  const channels = raw
    .filter((c: any) => c && typeof c.id === "string")
    .map((c: any) => ({
      id: c.id,
      name: typeof c.name === "string" ? c.name : c.id,
      country: typeof c.country === "string" ? c.country : "XX",
      category: typeof c.category === "string" ? c.category : "general",
      genres: Array.isArray(c.genre) ? c.genre : Array.isArray(c.genres) ? c.genres : [],
    }));
  return { raw, channels };
}

async function readConfigMeta(env: Env): Promise<ConfigMeta | null> {
  const meta = await readJson<ConfigMeta>(env.ATV_CONFIG, "config_meta");
  if (meta && meta.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new ConfigSchemaError(meta.schemaVersion);
  }
  return meta;
}

type GuidePayload = {
  generatedAt: number;
  eTag: string;
  schemaVersion: number;
  total: number;
  counts: { country: Record<string, number>; category: Record<string, number> };
  channels: ChannelDef[];
  warning?: string;
};

async function buildGuidePayload(env: Env): Promise<GuidePayload> {
  const meta = await readConfigMeta(env);
  const { raw, channels } = await loadLineup(env);
  const { byCountry, byCategory, list } = runRulesIndex(channels);
  // Stable order so the eTag and the cursor stay valid between isolates.
  const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
  const payload: GuidePayload = {
    generatedAt: Date.now(),
    eTag: `"guide-${sorted.length}-${checksum(raw)}"`,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    total: sorted.length,
    counts: {
      country: Object.fromEntries([...byCountry].map(([k, v]) => [k, v.length])),
      category: Object.fromEntries([...byCategory].map(([k, v]) => [k, v.length])),
    },
    channels: sorted,
  };
  if (meta && meta.checksum !== checksum(raw)) {
    payload.warning = "config_checksum_mismatch";
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "channels changed since config_meta was written",
        metaChecksum: meta.checksum,
        checksum: checksum(raw),
      }),
    );
  }
  return payload;
}

const GUIDE_TTL_MS = 30_000;
const DEFAULT_PAGE = 500;
const MAX_PAGE = 1000;
let guideMemo: { at: number; payload: GuidePayload } | null = null;

async function currentGuide(env: Env): Promise<GuidePayload> {
  if (guideMemo && Date.now() - guideMemo.at < GUIDE_TTL_MS) return guideMemo.payload;
  const payload = await buildGuidePayload(env);
  guideMemo = { at: Date.now(), payload };
  return payload;
}

function paginate(payload: GuidePayload, url: URL) {
  const wantedLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(wantedLimit) && wantedLimit > 0
      ? Math.min(Math.floor(wantedLimit), MAX_PAGE)
      : DEFAULT_PAGE;
  const wantedCursor = Number(url.searchParams.get("cursor"));
  const offset = Number.isFinite(wantedCursor) && wantedCursor > 0 ? Math.floor(wantedCursor) : 0;
  const channels = payload.channels.slice(offset, offset + limit);
  const nextCursor = offset + limit < payload.channels.length ? String(offset + limit) : null;
  return { ...payload, channels, returned: channels.length, limit, nextCursor };
}

async function handleGuide(env: Env, url: URL, request: Request): Promise<Response> {
  const payload = await currentGuide(env);
  const page = paginate(payload, url);
  const headers = {
    ...CORS,
    "Cache-Control": "public, max-age=30, s-maxage=60",
    ETag: payload.eTag,
  };
  if (request.headers.get("If-None-Match") === payload.eTag) {
    return new Response(null, { status: 304, headers });
  }
  return json(page, 200, headers);
}

async function handleResolve(url: URL, env: Env, requestId: string): Promise<Response> {
  const id = url.searchParams.get("id");
  if (!id) return failure("missing_id", "missing id", requestId, 400);
  try {
    const link = await resolveStream(id, env);
    return json({ id, url: link.url, profile: link.profile }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "resolve failed";
    if (message === "not found") return failure("not_found", message, requestId, 404);
    if (message.startsWith("insecure url")) return failure("insecure_url", message, requestId, 502);
    logFailure(requestId, "/api/resolve", err);
    return failure("resolve_failed", "resolve failed", requestId, 502);
  }
}

async function handleIdent(env: Env, requestId: string): Promise<Response> {
  const stored = await kvJson<unknown>(env.ATV_CONFIG, "idents");
  const urls = (Array.isArray(stored) ? stored : [])
    .map((entry: unknown) =>
      typeof entry === "string" ? entry : (entry as { url?: unknown } | null)?.url,
    )
    .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("https://"));
  if (urls.length === 0) {
    return json(
      {
        error: "no idents configured",
        code: "no_idents",
        requestId,
        hint: 'set ATV_CONFIG key "idents" to an array of https media urls',
      },
      503,
    );
  }
  const url = urls[Math.floor(Math.random() * urls.length)];
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store", ...CORS },
  });
}

async function handleHealth(env: Env): Promise<Response> {
  const [meta, lineup, snapshot] = await Promise.all([
    readJson<ConfigMeta>(env.ATV_CONFIG, "config_meta"),
    loadLineup(env),
    readJson<{ generatedAt?: number; total?: number }>(env.ATV_CACHE, "guide:latest"),
  ]);
  const seeded = lineup.channels.length > 0;
  // /api/guide refuses a schema it does not know. Health has to say so too,
  // otherwise a monitor sees `ok` while every guide request is a 503.
  const schemaMatches = meta ? meta.schemaVersion === CONFIG_SCHEMA_VERSION : null;
  const checksumMatches = meta ? meta.checksum === checksum(lineup.raw) : null;
  return json({
    status: seeded && schemaMatches !== false ? "ok" : "degraded",
    schemaVersion: meta?.schemaVersion ?? null,
    config: {
      seeded,
      channels: lineup.channels.length,
      updatedAt: meta?.updatedAt ?? null,
      schemaMatches,
      checksumMatches,
    },
    guideSnapshot: snapshot
      ? { generatedAt: snapshot.generatedAt ?? null, total: snapshot.total ?? null }
      : null,
  });
}

function guard(
  requestId: string,
  path: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  return handler().catch((err) => {
    if (err instanceof ConfigSchemaError) {
      logFailure(requestId, path, err);
      return failure("config_schema_mismatch", "config schema mismatch", requestId, 503);
    }
    logFailure(requestId, path, err);
    return failure("internal_error", "service unavailable", requestId, 503);
  });
}

// Runs on the Cron Trigger in wrangler.toml, not on a request: a write in the
// request path costs one KV write per cold isolate instead of one per interval.
async function snapshotGuide(env: Env): Promise<void> {
  const payload = await buildGuidePayload(env);
  await backupConfig(env, payload);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID().slice(0, 8);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withRequestId(new Response(null, { status: 204, headers: CORS }), requestId);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return withRequestId(
        failure("method_not_allowed", "method not allowed", requestId, 405),
        requestId,
      );
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";
    let response: Response;

    // Compare the raw pathname here: `path` is slash-normalised, so /admin/
    // would otherwise redirect to itself.
    if (url.pathname === "/admin") {
      response = new Response(null, { status: 308, headers: { Location: "/admin/" } });
    } else if (path === "/admin" || path.startsWith("/admin/")) {
      // Asset paths (a file extension) are served as-is; anything else under
      // /admin falls back to the admin shell rather than the TV client's SPA.
      const isFile = /\.[a-z0-9]+$/i.test(path);
      const target = isFile ? request : new URL("/admin/", url).toString();
      response = await env.ASSETS.fetch(target);
    } else {
      switch (path) {
        case "/":
        case "/api/status":
          response = json(statusBody(env));
          break;
        case "/api/health":
          response = await guard(requestId, path, () => handleHealth(env));
          break;
        case "/api/guide":
          response = await guard(requestId, path, () => handleGuide(env, url, request));
          break;
        case "/api/resolve":
          response = await guard(requestId, path, () => handleResolve(url, env, requestId));
          break;
        case "/api/idents/random":
          response = await guard(requestId, path, () => handleIdent(env, requestId));
          break;
        default:
          response = failure("not_found", "not found", requestId, 404);
      }
    }

    return withRequestId(response, requestId);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      snapshotGuide(env).catch((err) => {
        logFailure("cron", "/scheduled", err);
      }),
    );
  },
};
