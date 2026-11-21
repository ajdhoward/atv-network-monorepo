import type { Env } from "./env";

export async function backupConfig(env: Pick<Env, "ATV_CACHE">, payload: unknown) {
  await env.ATV_CACHE.put("guide:latest", JSON.stringify(payload));
}
