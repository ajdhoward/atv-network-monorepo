export type ResolvedLink = { url: string; headers?: Record<string,string>; profile: string };
export async function resolveStream(id: string, env: any): Promise<ResolvedLink> {
  const cfg = await env.ATV_CONFIG.get("gdrive_map", "json") as Record<string,string> | null;
  const direct = cfg?.[id];
  if (!direct) throw new Error("not found");
  if (!direct.startsWith("https://")) throw new Error("insecure url blocked - TLS 1.3 required");
  return { url: direct, profile: "1080p_hevc" };
}
