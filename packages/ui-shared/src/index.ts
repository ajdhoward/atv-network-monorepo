export type SystemConfig = {
  version: 1;
  gdrive: { identsFolder: string; lineupFolder: string; clientId: string };
  torbox: { apiKeyRef: string; enabled: boolean };
  tmdb: { apiKeyRef: string };
  simkl: { clientId: string };
  player: { profile: 'auto' | '4k' | '1080p'; forcedSubsOnly: boolean };
  channels: ChannelDef[];
};
export type ChannelDef = { id: string; name: string; category: string; country: string; genre: string[]; lineup: string[] };
export type GuidePayload = { generatedAt: number; channels: ChannelDef[]; eTag: string };
export type LogPacket = { deviceId: string; bufferRate: number; wsLatency: number; linkResolveMs: number; ts: number };
export const CONFIG_SCHEMA_VERSION = 1;
export function validateConfig(c: any): c is SystemConfig {
  if (!c || c.version !== 1) return false;
  if (typeof c.gdrive?.identsFolder !== 'string') return false;
  if (!Array.isArray(c.channels)) return false;
  return true;
}
