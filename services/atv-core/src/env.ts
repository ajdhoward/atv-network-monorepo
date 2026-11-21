// Bindings declared in wrangler.toml and wrangler.production.toml.
// One definition for the Worker, the resolver, the backup writer and the tests,
// so an undeclared binding is a type error rather than `any`.

export interface Env {
  ATV_CACHE: KVNamespace;
  ATV_CONFIG: KVNamespace;
  GITHUB_USERNAME: string;
  SYSTEM_ENV: string;
}

// KV's `json` read is generic over an unknown-typed value; this keeps the cast
// at the boundary instead of at every call site.
export async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  return (await kv.get(key, "json")) as T | null;
}
