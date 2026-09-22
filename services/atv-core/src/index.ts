export interface Env {
  ATV_CACHE: any;
  ATV_CONFIG: any;
  GITHUB_USERNAME: string;
  SYSTEM_ENV: string;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    return new Response(JSON.stringify({ name: "ATV Core", status: "live", domain: "atv.acidwurx.org", time: new Date().toISOString() }, null, 2), { headers: { "Content-Type": "application/json",...cors } });
  }
};
