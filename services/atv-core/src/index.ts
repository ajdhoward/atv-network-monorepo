import type { ChannelDef } from "@atv/ui-shared";
import { backupConfig } from "./backup";
import { CONFIG_SCHEMA_VERSION, checksum, type ConfigMeta } from "./config-meta";
import { kvJson, readJson, type Env } from "./env";
import { resolveStream, streamCoverage } from "./resolver";
import { runRulesIndex } from "./rules";

export type { Env };
// The Durable Object class has to be exported from the Worker's main module.
export { RateLimiter } from "./limiter";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  // If-None-Match and the ETag/X-Request-Id response headers are not
  // CORS-safelisted, so a cross-origin client could not use the 304 path or
  // read the request id without these two lines.
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
  // Retry-After is not safelisted either: a cross-origin client must be able to
  // read it to schedule the retry a 429 asks for.
  "Access-Control-Expose-Headers": "ETag, X-Request-Id, Retry-After",
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

// Best-effort counters: the dataset is optional and a metrics failure must never
// change a response, so both the missing binding and a throw are swallowed.
function count(env: Env, event: string, index?: string): void {
  try {
    env.ATV_METRICS?.writeDataPoint({ blobs: [event, index ?? ""], doubles: [1] });
  } catch {
    /* analytics is optional */
  }
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

// If-None-Match is a weak comparison (RFC 9110 §13.1.2): `W/"x"` matches `"x"`.
// Cloudflare's edge weakens a strong ETag whenever it re-encodes the body, so a
// strict equality check answered 200 to every real browser revalidation even
// though workerd (no edge in front) returned 304.
function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const normalise = (value: string) => value.trim().replace(/^W\//, "");
  const target = normalise(etag);
  // A comma-separated list and "*" (any current representation) are both legal.
  return header.split(",").some((part) => {
    const candidate = normalise(part);
    return candidate === "*" || candidate === target;
  });
}

async function handleGuide(env: Env, url: URL, request: Request): Promise<Response> {
  const payload = await currentGuide(env);
  const page = paginate(payload, url);
  const headers = {
    ...CORS,
    // The lineup changes only on a re-seed, so letting the edge serve a stale
    // copy for a few minutes while it revalidates removes origin requests
    // without showing a channel list older than the CDN TTL by much.
    "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
    ETag: payload.eTag,
  };
  if (etagMatches(request.headers.get("If-None-Match"), payload.eTag)) {
    return new Response(null, { status: 304, headers });
  }
  return json(page, 200, headers);
}

// The limiter's window, mirrored by [[ratelimits.simple]] period in wrangler.toml
// and passed to the Durable Object on every check.
const RATE_LIMIT_WINDOW_S = 60;
// The per-window budget, mirrored by [[ratelimits.simple]] limit in wrangler.toml.
const RATE_LIMIT_MAX = 300;

type LimitCheck = { ok: true } | { ok: false; retryAfterS: number };

// Fail open: a limiter error must not take the API down, and no binding at all
// (local dev, or a deployment without them) simply means no limiting. The key
// is the client IP, so one caller cannot exhaust another's allowance. A request
// with no CF-Connecting-IP cannot be attributed to a caller; it is left
// uncounted rather than sharing one "unknown" bucket, where a single anonymous
// client could spend every other anonymous client's allowance (workerd dev and
// smoke requests have no header either). Cloudflare sets it on every request
// that reaches a Worker.
async function allowRequest(
  env: Env,
  request: Request,
  bucket: string,
  requestId: string,
): Promise<LimitCheck> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return { ok: true };
  const key = `${bucket}:${ip}`;

  // The Durable Object is the authoritative counter: one instance per key, so
  // every location's requests land on the same window. The [[ratelimits]]
  // binding below it is per-location and cached per isolate, which is why a
  // burst spread across locations never tripped it; it stays as a coarse
  // fallback for a missing or failing object.
  const namespace = env.ATV_LIMITER;
  if (namespace) {
    try {
      const stub = namespace.get(namespace.idFromName(key));
      const res = await stub.fetch(
        `https://limiter.internal/check?limit=${RATE_LIMIT_MAX}&window=${RATE_LIMIT_WINDOW_S}`,
      );
      if (!res.ok) throw new Error(`limiter responded ${res.status}`);
      const body = (await res.json()) as { success?: unknown; retryAfterS?: unknown };
      if (body.success === true) return { ok: true };
      const retryAfterS =
        typeof body.retryAfterS === "number" && body.retryAfterS > 0
          ? Math.ceil(body.retryAfterS)
          : RATE_LIMIT_WINDOW_S;
      return { ok: false, retryAfterS };
    } catch (err) {
      logFailure(requestId, `rate-limit:${bucket}`, err);
      // Not a pass yet: try the coarse binding before failing open.
    }
  }

  const limiter = env.ATV_RATE_LIMITER;
  if (!limiter) return { ok: true };
  try {
    const { success } = await limiter.limit({ key });
    return success ? { ok: true } : { ok: false, retryAfterS: RATE_LIMIT_WINDOW_S };
  } catch (err) {
    logFailure(requestId, `rate-limit:${bucket}`, err);
    return { ok: true };
  }
}

async function handleResolve(
  url: URL,
  env: Env,
  requestId: string,
  request: Request,
): Promise<Response> {
  const limit = await allowRequest(env, request, "resolve", requestId);
  if (!limit.ok) {
    count(env, "resolve_rate_limited");
    return failure("rate_limited", "too many requests", requestId, 429, {
      "Retry-After": String(limit.retryAfterS),
    });
  }
  const id = url.searchParams.get("id");
  if (!id) return failure("missing_id", "missing id", requestId, 400);
  try {
    const link = await resolveStream(id, env);
    count(env, "resolve_hit", id);
    return json({ id, url: link.url, profile: link.profile }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "resolve failed";
    if (message === "not found") {
      count(env, "resolve_miss", id);
      return failure("not_found", message, requestId, 404);
    }
    if (message.startsWith("insecure url")) {
      count(env, "resolve_insecure", id);
      return failure("insecure_url", message, requestId, 502);
    }
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
    count(env, "ident_empty");
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
  count(env, "ident_redirect");
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
  // Operators watch playback break without a signal saying which channels have
  // no link at all; counts are enough for that and leak nothing.
  const resolve = await streamCoverage(
    env,
    lineup.channels.map((channel) => channel.id),
  );
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
    resolve,
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
          response = await guard(requestId, path, () =>
            handleResolve(url, env, requestId, request),
          );
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
