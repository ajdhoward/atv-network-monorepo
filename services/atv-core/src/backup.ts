export async function backupConfig(env: { ATV_CACHE: any }, payload: any) {
  await env.ATV_CACHE.put("guide:latest", JSON.stringify(payload));
}
