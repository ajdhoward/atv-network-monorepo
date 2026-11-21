// Mirrors services/atv-core/src/config-meta.ts. The checksum must be computed
// exactly the same way on both sides or /api/guide reports a mismatch.
export const CONFIG_SCHEMA_VERSION = 1;

export function configChecksum(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
