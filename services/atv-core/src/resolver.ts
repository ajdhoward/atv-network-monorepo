import { readJson } from "./env";
import type { Env } from "./env";

export type ResolvedLink = { url: string; headers?: Record<string,string>; profile: string };
export async function resolveStream(id: string, env: Env): Promise<ResolvedLink> {
  const cfg = await readJson<Record<string, string>>(env.ATV_CONFIG, "gdrive_map");
  const direct = cfg?.[id];
  if (!direct) throw new Error("not found");
  if (!direct.startsWith("https://")) throw new Error("insecure url blocked - TLS 1.3 required");
  return { url: direct, profile: "1080p_hevc" };
}
