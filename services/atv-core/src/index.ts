import type { ChannelDef, HealthPayload } from "@atv/ui-shared";
import { backupConfig } from "./backup";
import { CONFIG_SCHEMA_VERSION, checksum, type ConfigMeta } from "./config-meta";
import { checkDeviceToken } from "./device-token";
import { kvJson, readJson, type Env } from "./env";
import { apkUrl, handleInstall, handleInstallQr } from "./install";
import { handleJoin } from "./join";
import { handleOnboard } from "./onboard";
import { mappedLink, resolveStream, streamCoverage } from "./resolver";
import { runRulesIndex } from "./rules";
import { driveFileId, driveMediaUrl, mediaHeaders } from "./stream";
import { checkStreamTicket } from "./stream-sign";

export type { Env };
// The Durable Object class has to be exported from the Worker's main module.
export { RateLimiter } from "./limiter";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  // If-None-Match and the ETag/X-Request-Id response headers are not
  // CORS-safelisted, so a cross-origin client could not use the 304 path or
  // read the request id without these two lines.
  // Authorization is not safelisted either: R6's resolve needs it from the TV.
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match, Authorization",
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
  // KV is external input: a hand-edited seed, an older generator or a typo reaches
  // here unchanged. A blank id addresses no channel, and a repeated one would
  // double the counts and make which link answers ambiguous, so the first entry
  // for an id wins and the rest are dropped rather than served.
  const channels: ChannelDef[] = [];
  const seen = new Set<string>();
  for (const entry of raw as any[]) {
    if (!entry || typeof entry.id !== "string") continue;
    const id = entry.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const genres = Array.isArray(entry.genre)
      ? entry.genre
      : Array.isArray(entry.genres)
        ? entry.genres
        : [];
    channels.push({
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name : id,
      country: typeof entry.country === "string" ? entry.country : "XX",
      category: typeof entry.category === "string" ? entry.category : "general",
      // A non-string genre rendered as `[object Object]` in the tile.
      genres: genres.filter((genre: unknown): genre is string => typeof genre === "string"),
    });
  }
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
  // Computed once: `checksum` walks the whole seeded array, and a cold guide build
  // used to do it three times — the eTag, the mismatch check and the log line.
  const digest = checksum(raw);
  const payload: GuidePayload = {
    generatedAt: Date.now(),
    eTag: `"guide-${sorted.length}-${digest}"`,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    total: sorted.length,
    counts: {
      country: Object.fromEntries([...byCountry].map(([k, v]) => [k, v.length])),
      category: Object.fromEntries([...byCategory].map(([k, v]) => [k, v.length])),
    },
    channels: sorted,
  };
  if (meta && meta.checksum !== digest) {
    payload.warning = "config_checksum_mismatch";
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "channels changed since config_meta was written",
        metaChecksum: meta.checksum,
        checksum: digest,
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

// Matches the cap the audit and any client should assume for ?ids=.
const MAX_BATCH_IDS = 20;

type BatchResolve = {
  resolved: { id: string; url: string; profile: string }[];
  missing: string[];
  invalid: string[];
};

// `resolveStream` signals both expected failures by throwing a message, and the
// single and batch paths have to read the same two. One mapping means a new
// message cannot be taught to only one of them.
type ResolveFault = "missing" | "insecure" | "fault";

function classifyResolveFault(err: unknown): ResolveFault {
  const message = err instanceof Error ? err.message : "";
  if (message === "not found") return "missing";
  if (message.startsWith("insecure url")) return "insecure";
  return "fault";
}

// `?ids=a,b` answers a whole grid sweep in one request, and therefore spends one
// limiter token instead of one per channel. Links are returned only for ids that
// resolved, so an unknown or insecure id discloses nothing.
async function resolveMany(raw: string, env: Env, requestId: string): Promise<Response> {
  // A repeated id must not spend the batch allowance twice.
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (!ids.length) return failure("missing_id", "missing id", requestId, 400);
  if (ids.length > MAX_BATCH_IDS) {
    return failure("too_many_ids", `at most ${MAX_BATCH_IDS} ids per request`, requestId, 400);
  }

  const out: BatchResolve = { resolved: [], missing: [], invalid: [] };
  for (const id of ids) {
    try {
      const link = await resolveStream(id, env);
      out.resolved.push({ id, url: link.url, profile: link.profile });
    } catch (err) {
      const fault = classifyResolveFault(err);
      if (fault === "missing") out.missing.push(id);
      else if (fault === "insecure") out.invalid.push(id);
      // Anything else is a real fault: let the guard turn it into a 503 rather
      // than reporting a partial batch as if it were complete.
      else throw err;
    }
  }
  count(env, "resolve_batch");
  return json(out, 200, { "Cache-Control": "no-store" });
}

async function handleResolve(
  url: URL,
  env: Env,
  requestId: string,
  request: Request,
): Promise<Response> {
  // Option C, before the limiter and before any provider call: an unauthenticated
  // request must not spend the household's allowance or mint a TorBox link. The
  // header is the only place the token is read from — never a query string, where
  // it would land in logs and referrers — and it is never echoed back.
  const verdict = await checkDeviceToken(
    request.headers.get("Authorization"),
    env.ATV_DEVICE_TOKEN,
  );
  if (verdict === "reject") {
    count(env, "resolve_unauthorized");
    return failure("unauthorized", "household token required", requestId, 401, {
      // RFC 6750's challenge: which scheme, and nothing about the secret.
      "WWW-Authenticate": 'Bearer realm="atv"',
    });
  }
  const limit = await allowRequest(env, request, "resolve", requestId);
  if (!limit.ok) {
    count(env, "resolve_rate_limited");
    return failure("rate_limited", "too many requests", requestId, 429, {
      "Retry-After": String(limit.retryAfterS),
    });
  }
  const ids = url.searchParams.get("ids");
  if (ids !== null) return resolveMany(ids, env, requestId);
  const id = url.searchParams.get("id");
  if (!id) return failure("missing_id", "missing id", requestId, 400);
  try {
    const link = await resolveStream(id, env);
    count(env, "resolve_hit", id);
    return json({ id, url: link.url, profile: link.profile }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    // The message is the response body for the two expected failures, exactly as
    // it was thrown: only the branch is shared with the batch path.
    const message = err instanceof Error ? err.message : "resolve failed";
    switch (classifyResolveFault(err)) {
      case "missing":
        count(env, "resolve_miss", id);
        return failure("not_found", message, requestId, 404);
      case "insecure":
        count(env, "resolve_insecure", id);
        return failure("insecure_url", message, requestId, 502);
      default:
        logFailure(requestId, "/api/resolve", err);
        return failure("resolve_failed", "resolve failed", requestId, 502);
    }
  }
}

// A seeded ident is external input too: "https://" on its own, a typo or a
// non-string entry would 302 the TV to an address that cannot load, so only an
// absolute https URL that parses and has a host survives.
function isHttpsMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("https://")) return false;
  try {
    return new URL(value).hostname.length > 0;
  } catch {
    return false;
  }
}

async function handleIdent(env: Env, requestId: string): Promise<Response> {
  const stored = await kvJson<unknown>(env.ATV_CONFIG, "idents");
  const urls = (Array.isArray(stored) ? stored : [])
    .map((entry: unknown) =>
      typeof entry === "string" ? entry : (entry as { url?: unknown } | null)?.url,
    )
    .filter(isHttpsMediaUrl);
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

// P1: the Drive proxy. A TV cannot send `Authorization` on a `<video>`, so the
// resolve call (already token-protected) mints `/api/stream/<id>?exp&sig` and this
// route spends that ticket. The signature is over the id, so one ticket cannot be
// pointed at another channel, and `exp` is signed with it, so it cannot be
// extended. `Range` is forwarded untouched: seeking is the feature, and a proxy
// that ignores it gets a player that plays but cannot skip.
async function handleStream(
  request: Request,
  env: Env,
  url: URL,
  id: string,
  requestId: string,
): Promise<Response> {
  const verdict = await checkStreamTicket({
    id,
    exp: url.searchParams.get("exp"),
    sig: url.searchParams.get("sig"),
    secret: env.ATV_STREAM_SIGNING_KEY,
  });
  if (verdict === "unconfigured") {
    // The deployment's fault, not the caller's: its own code and counter, so an
    // operator who has not set the key does not read as a forge attempt.
    count(env, "stream_unconfigured");
    return failure(
      "stream_unconfigured",
      "stream signing is not configured on this deployment",
      requestId,
      503,
    );
  }
  if (verdict !== "ok") {
    count(env, verdict === "expired" ? "stream_expired" : "stream_forbidden");
    return failure(
      verdict,
      verdict === "expired" ? "stream ticket has expired" : "stream ticket is missing or invalid",
      requestId,
      403,
    );
  }

  // The map is re-read rather than carried in the ticket: a ticket outlives a
  // rotation of the link, and a link the operator has replaced must not keep
  // serving from the old file.
  const link = await mappedLink(id, env);
  const fileId = link ? driveFileId(link) : null;
  if (!fileId) {
    count(env, "stream_miss", id);
    return failure("not_found", "not found", requestId, 404);
  }

  const range = request.headers.get("Range");
  let upstream: Response;
  try {
    upstream = await fetch(driveMediaUrl(fileId), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers: range ? { Range: range } : {},
    });
  } catch (err) {
    // No URL, no id and no body in the log: the failing request is a stream link.
    logFailure(requestId, "/api/stream", err);
    return failure("upstream_unavailable", "stream source is unreachable", requestId, 502);
  }
  // 416 is the answer to an unsatisfiable Range and carries the `Content-Range:
  // bytes */<size>` a player needs, so it passes through. Drive's own errors do
  // not: their body is not media, and relaying it would report Drive's status as
  // this Worker's.
  if (!upstream.ok && upstream.status !== 416) {
    logFailure(requestId, "/api/stream", new Error(`drive responded ${upstream.status}`));
    return failure("upstream_error", "stream source refused the request", requestId, 502);
  }

  count(env, "stream_served", id);
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: mediaHeaders(upstream),
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
  const payload: HealthPayload = {
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
    // Presence only: this is how an operator sees that R8 is half-done, and it
    // says nothing about the value.
    deviceTokenSet: !!env.ATV_DEVICE_TOKEN?.trim(),
    guideSnapshot: snapshot
      ? { generatedAt: snapshot.generatedAt ?? null, total: snapshot.total ?? null }
      : null,
  };
  return json(payload);
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

// One place maps a path to a handler, so `fetch` can wrap the whole dispatch in a
// single catch. The per-handler `guard` stays: it turns a config-schema mismatch
// into its own code instead of a generic 503.
async function route(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  requestId: string,
): Promise<Response> {
  // Compare the raw pathname here: `path` is slash-normalised, so /admin/
  // would otherwise redirect to itself.
  if (url.pathname === "/admin") {
    return new Response(null, { status: 308, headers: { Location: "/admin/" } });
  }
  if (path === "/admin" || path.startsWith("/admin/")) {
    // Asset paths (a file extension) are served as-is; anything else under
    // /admin falls back to the admin shell rather than the TV client's SPA.
    const isFile = /\.[a-z0-9]+$/i.test(path);
    const target = isFile ? request : new URL("/admin/", url).toString();
    return env.ASSETS.fetch(target);
  }
  // P1's media route has an id in its path, so it is matched before the switch.
  // An id is one segment on the wire (a slash in it travels as %2F) and the
  // ticket is signed over the decoded value, which is what the route reads back.
  if (path.startsWith("/api/stream/")) {
    let id: string;
    try {
      id = decodeURIComponent(path.slice("/api/stream/".length));
    } catch {
      return failure("bad_id", "malformed channel id", requestId, 400);
    }
    if (!id) return failure("missing_id", "missing id", requestId, 400);
    return guard(requestId, "/api/stream", () => handleStream(request, env, url, id, requestId));
  }
  switch (path) {
    case "/":
    case "/api/status":
      return json(statusBody(env));
    case "/api/health":
      return guard(requestId, path, () => handleHealth(env));
    case "/api/guide":
      return guard(requestId, path, () => handleGuide(env, url, request));
    case "/api/resolve":
      return guard(requestId, path, () => handleResolve(url, env, requestId, request));
    case "/api/idents/random":
      return guard(requestId, path, () => handleIdent(env, requestId));
    case "/a":
      // The short install address: a TV remote types /a instead of the whole
      // release URL. A redirect, not a proxy, so the APK stays GitHub's
      // bandwidth and the Worker never holds a large asset in a request.
      return new Response(null, {
        status: 302,
        headers: { Location: apkUrl(env.GITHUB_USERNAME), "Cache-Control": "no-store" },
      });
    case "/install":
      return handleInstall(env, url);
    case "/install/qr.svg":
      return handleInstallQr(env);
    case "/join":
      return handleJoin(env);
    case "/onboard":
      return handleOnboard(env);
    default:
      return failure("not_found", "not found", requestId, 404);
  }
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
    try {
      response = await route(request, env, url, path, requestId);
    } catch (err) {
      // Last resort. The page routes, the redirect and the asset fetch have no
      // per-handler guard, and a platform 500 carries no request id and no CORS
      // headers, so neither `wrangler tail` nor a browser can find it. This one
      // can: the id is in the log line and on the response.
      logFailure(requestId, path, err);
      response = failure("internal_error", "service unavailable", requestId, 503);
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
