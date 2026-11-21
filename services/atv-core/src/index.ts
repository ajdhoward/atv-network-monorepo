import type { ChannelDef } from "@atv/ui-shared";
import { backupConfig } from "./backup";
import { resolveStream } from "./resolver";
import { runRulesIndex } from "./rules";

export interface Env {
  ATV_CACHE: any;
  ATV_CONFIG: any;
  GITHUB_USERNAME: string;
  SYSTEM_ENV: string;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Content-Type-Options": "nosniff",
};

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

function guard(handler: () => Promise<Response>): Promise<Response> {
  return handler().catch((err) => {
    const message = err instanceof Error ? err.message : "internal error";
    return json({ error: "service unavailable", detail: message }, 503);
  });
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

async function loadChannels(env: Env): Promise<ChannelDef[]> {
  const direct = await env.ATV_CONFIG.get("channels", "json");
  const system = Array.isArray(direct)
    ? null
    : await env.ATV_CONFIG.get("system_config", "json");
  const raw = Array.isArray(direct) ? direct : system?.channels;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c: any) => c && typeof c.id === "string")
    .map((c: any) => ({
      id: c.id,
      name: typeof c.name === "string" ? c.name : c.id,
      country: typeof c.country === "string" ? c.country : "XX",
      category: typeof c.category === "string" ? c.category : "general",
      genres: Array.isArray(c.genre) ? c.genre : Array.isArray(c.genres) ? c.genres : [],
    }));
}

const GUIDE_TTL_MS = 30_000;
let guideMemo: { at: number; payload: any } | null = null;

async function buildGuidePayload(env: Env) {
  const channels = await loadChannels(env);
  const { byCountry, byCategory, list, truncated } = runRulesIndex(channels);
  return {
    generatedAt: Date.now(),
    eTag: `"guide-${list.length}-${Date.now()}"`,
    total: list.length,
    truncated,
    counts: {
      country: Object.fromEntries([...byCountry].map(([k, v]) => [k, v.length])),
      category: Object.fromEntries([...byCategory].map(([k, v]) => [k, v.length])),
    },
    channels: list,
  };
}

async function handleGuide(env: Env): Promise<Response> {
  if (guideMemo && Date.now() - guideMemo.at < GUIDE_TTL_MS) {
    return json(guideMemo.payload);
  }
  const payload = await buildGuidePayload(env);
  guideMemo = { at: Date.now(), payload };
  return json(payload);
}

// Runs on the Cron Trigger in wrangler.toml, not on a request: a write in the
// request path costs one KV write per cold isolate instead of one per interval.
// A truncated index is a partial view of the lineup, so never snapshot it.
async function snapshotGuide(env: Env): Promise<void> {
  const payload = await buildGuidePayload(env);
  if (payload.truncated) {
    console.warn("guide snapshot skipped: rules index truncated");
    return;
  }
  await backupConfig(env, payload);
}

async function handleResolve(url: URL, env: Env): Promise<Response> {
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "missing id" }, 400);
  try {
    const link = await resolveStream(id, env);
    return json({ id, url: link.url, profile: link.profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : "resolve failed";
    return json({ id, error: message }, message === "not found" ? 404 : 502);
  }
}

async function handleIdent(env: Env): Promise<Response> {
  const stored = await env.ATV_CONFIG.get("idents", "json");
  const urls = (Array.isArray(stored) ? stored : [])
    .map((entry: any) => (typeof entry === "string" ? entry : entry?.url))
    .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("https://"));
  if (urls.length === 0) {
    return json(
      { error: "no idents configured", hint: 'set ATV_CONFIG key "idents" to an array of https media urls' },
      503,
    );
  }
  const url = urls[Math.floor(Math.random() * urls.length)];
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store", ...CORS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method not allowed" }, 405);
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";
    switch (path) {
      case "/":
      case "/api/status":
        return json(statusBody(env));
      case "/api/guide":
        return guard(() => handleGuide(env));
      case "/api/resolve":
        return guard(() => handleResolve(url, env));
      case "/api/idents/random":
        return guard(() => handleIdent(env));
      default:
        return json({ error: "not found", path: url.pathname }, 404);
    }
  },

  async scheduled(_event: { cron: string; scheduledTime: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(
      snapshotGuide(env).catch((err) => {
        console.error("guide snapshot failed", err instanceof Error ? err.message : err);
      }),
    );
  },
};
