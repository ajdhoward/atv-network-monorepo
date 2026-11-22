export type SystemConfig = {
  version: 1;
  gdrive: { identsFolder: string; lineupFolder: string; clientId: string };
  torbox: { apiKeyRef: string; enabled: boolean };
  tmdb: { apiKeyRef: string };
  simkl: { clientId: string };
  player: { profile: "auto" | "4k" | "1080p"; forcedSubsOnly: boolean };
  channels: ChannelDef[];
};
// The API normalises every channel to this shape (see services/atv-core): the
// seed config may spell genres as `genre`, but the wire format is `genres`.
export type ChannelDef = {
  id: string;
  name: string;
  country: string;
  category: string;
  genres: string[];
  lineup?: string[];
};
// Wire shape of GET /api/guide (see services/atv-core/src/index.ts). Pages are
// requested with ?limit=&cursor=; `nextCursor` is null on the last page.
export type GuidePayload = {
  generatedAt: number;
  eTag: string;
  schemaVersion: number;
  total: number;
  returned: number;
  limit: number;
  nextCursor: string | null;
  counts: { country: Record<string, number>; category: Record<string, number> };
  channels: ChannelDef[];
  warning?: string;
};
// Wire shape of GET /api/health. `resolve` counts stream-link coverage and
// never carries a link itself; `schemaMatches`/`checksumMatches` are null when
// no config has been seeded yet.
export type ResolveCoverage = {
  configured: number;
  invalid: number;
  missing: number;
};
export type HealthPayload = {
  status: "ok" | "degraded";
  schemaVersion: number | null;
  config: {
    seeded: boolean;
    channels: number;
    // ISO timestamp written by the seed script, not an epoch number.
    updatedAt: string | null;
    schemaMatches: boolean | null;
    checksumMatches: boolean | null;
  };
  resolve: ResolveCoverage;
  guideSnapshot: { generatedAt: number | null; total: number | null } | null;
};
// Single-channel wire shape of GET /api/resolve?id=.
export type ResolvePayload = { id: string; url: string; profile: string };
export type LogPacket = {
  deviceId: string;
  bufferRate: number;
  wsLatency: number;
  linkResolveMs: number;
  ts: number;
};
export const CONFIG_SCHEMA_VERSION = 1;
export function validateConfig(c: any): c is SystemConfig {
  if (!c || c.version !== 1) return false;
  if (typeof c.gdrive?.identsFolder !== "string") return false;
  if (!Array.isArray(c.channels)) return false;
  return true;
}
