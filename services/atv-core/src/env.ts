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
  // Optional strict limiter: a Durable Object per client key, so the count is
  // global instead of per Cloudflare location. Declared in wrangler.toml.
  ATV_LIMITER?: DurableObjectNamespace;
  // Optional Workers Rate Limiting binding, kept as a coarse fallback for when
  // the Durable Object is missing or throws. Without either, the API does not
  // limit.
  ATV_RATE_LIMITER?: RateLimit;
  // Optional operator-supplied stream links: a JSON object of id -> https URL,
  // set as a Worker secret so /api/resolve can be populated or rotated without
  // re-seeding KV. Secrets need no wrangler.toml binding, hence no block there.
  ATV_GDRIVE_MAP?: string;
  // Optional TorBox API token, set as a Worker secret. Only the Worker ever sees
  // it: a resolve returns the temporary CDN link, never this value.
  ATV_TORBOX_API_KEY?: string;
  // Optional household token (option C/R6). While it is unset `/api/resolve`
  // answers any caller, which is what keeps a deploy ahead of the TVs safe; once
  // it is set every resolve needs `Authorization: Bearer <this>`.
  ATV_DEVICE_TOKEN?: string;
  // Optional key that signs the Drive proxy's tickets (P1). While it is unset a
  // Drive-linked channel resolves to its stored link instead of a ticket, and
  // `/api/stream` answers 503 rather than pretending a ticket is wrong. Set as a
  // Worker secret; rotating it invalidates every URL already handed out.
  ATV_STREAM_SIGNING_KEY?: string;
}

// KV's `json` read is generic over an unknown-typed value; this keeps the cast
// at the boundary instead of at every call site.
export async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  return (await kv.get(key, "json")) as T | null;
}

// Per-isolate memo for keys that only change when someone re-seeds
// (gdrive_map, idents). KV reads are cheap but not free, and these are read on
// every resolve/hover. The guide has its own request-path memo.
//
// Keyed by the KV key alone, not by namespace: safe because the keys this Worker
// reads are named apart across ATV_CONFIG and ATV_CACHE. A name used in both would
// serve one namespace's value for the other.
const memo = new Map<string, { at: number; value: unknown }>();
// Reads already in the air, per key. A grid sweep resolves many channels in
// parallel, so without this a cold isolate starts one KV read per caller for the
// same key: `Promise.all` of a dozen hovers is a dozen reads of `torbox_map`.
const inFlight = new Map<string, Promise<unknown>>();

function sharedRead<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T | null>;

  const mine: Promise<T | null> = readJson<T>(kv, key).then((value) => {
    memo.set(key, { at: Date.now(), value });
    return value;
  });
  inFlight.set(key, mine);
  // Settle-and-forget, keyed on this promise: the entry goes away when it
  // finishes, so a failed read is never remembered for the rest of the TTL and
  // the next request can try KV again instead of inheriting the failure.
  const clear = () => {
    if (inFlight.get(key) === mine) inFlight.delete(key);
  };
  mine.then(clear, clear);
  return mine;
}

// Reads a JSON key through the memo, sharing a read already in the air with every
// concurrent caller. `ttlMs` is the memo window: a caller that needs a fresher
// answer can pass a smaller one, and the TTL decides nothing else.
export async function kvJson<T>(kv: KVNamespace, key: string, ttlMs = 60_000): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T | null;
  return sharedRead<T>(kv, key);
}
