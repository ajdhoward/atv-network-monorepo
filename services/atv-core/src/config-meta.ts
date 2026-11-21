// Shape of ATV_CONFIG/config_meta, written by scripts/seed-kv.mjs.
// The Worker refuses to index a lineup whose schema it does not understand,
// so a future config generation fails loudly instead of serving garbage.

export const CONFIG_SCHEMA_VERSION = 1;

export type ConfigMeta = {
  schemaVersion: number;
  checksum: string;
  channels: number;
  updatedAt: string;
};

// FNV-1a 32 over the serialised value. The seed script carries the same
// function (scripts/lib/config-meta.mjs); keep the two in step.
export function checksum(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
