// Single source of truth for which KV namespaces belong to production.
//
// The sandbox worker (atv-core-v2) must never bind these: `pnpm seed` and the
// guide snapshot cron both write, and the live lineup lives here. Scripts use
// this list to refuse an accidental shared-namespace write.

export const PRODUCTION_KV_IDS = new Set([
  "7e635f2e4ac44488a336f9d509b63061", // ATV_CACHE  (production cache)
  "a59048e76fbd47c185bd4fc62fc3111a", // ATV_CONFIG (production runtime config)
]);

// Binding -> title used when creating the sandbox namespaces.
export const SANDBOX_KV_NAMES = {
  ATV_CACHE: "atv-cache-staging",
  ATV_CONFIG: "atv-config-staging",
};

// Returns the production ids still referenced by a wrangler config's text.
export function sharedProductionIds(text) {
  const ids = [...text.matchAll(/^id\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  return [...new Set(ids.filter((id) => PRODUCTION_KV_IDS.has(id)))];
}
