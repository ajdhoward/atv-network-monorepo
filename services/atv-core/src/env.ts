// Bindings declared in wrangler.toml and wrangler.production.toml.
// One definition for the Worker, the resolver, the backup writer and the tests,
// so an undeclared binding is a type error rather than `any`.

export interface Env {
  ATV_CACHE: KVNamespace;
  ATV_CONFIG: KVNamespace;
  GITHUB_USERNAME: string;
  SYSTEM_ENV: string;
  // Static assets (TV client + admin CMS under /admin).
  ASSETS: Fetcher;
  // Optional: declared in wrangler.toml. Analytics Engine creates the dataset on
  // the first write, so the counters are a no-op when the binding is absent.
  ATV_METRICS?: AnalyticsEngineDataset;
  // Optional Workers Rate Limiting binding. Without it the API does not limit.
  ATV_RATE_LIMITER?: RateLimit;
}

// KV's `json` read is generic over an unknown-typed value; this keeps the cast
// at the boundary instead of at every call site.
export async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  return (await kv.get(key, "json")) as T | null;
}

// Per-isolate memo for keys that only change when someone re-seeds
// (gdrive_map, idents). KV reads are cheap but not free, and these are read on
// every resolve/hover. The guide has its own request-path memo.
const memo = new Map<string, { at: number; value: unknown }>();

export async function kvJson<T>(kv: KVNamespace, key: string, ttlMs = 60_000): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T | null;
  const value = await readJson<T>(kv, key);
  memo.set(key, { at: Date.now(), value });
  return value;
}
