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
  // Whether ATV_DEVICE_TOKEN is configured, so a rollout can be watched (R8).
  // Presence only, never the value; a deployment older than this field omits it.
  deviceTokenSet?: boolean;
  // Whether ATV_STREAM_SIGNING_KEY is configured: with it unset the Drive proxy
  // answers 503, so this is the difference between "proxy live" and "proxy
  // deployed but dead". Presence only; a deployment older than this field omits it.
  streamSigningKeySet?: boolean;
  // The commit this Worker was built from, so `pnpm drift` can see a deploy that
  // did not take effect even when nothing under `apps/` changed. `id` is null when
  // the deploy carried no ATV_BUILD_ID. Optional because a deployment older than
  // this field omits it: a consumer must treat absent and null the same way, which
  // is how `deviceTokenSet` is read too.
  build?: { id: string | null };
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
// Types only (Q6). This package had two runtime exports — a schema constant and a
// `validateConfig` — that nothing imported as a value: every consumer writes
// `import type`, and the constant is duplicated for real in
// `services/atv-core/src/config-meta.ts` and `scripts/lib/config-meta.mjs`, which
// have a parity test. A third copy with no reader was a place to edit by mistake.
