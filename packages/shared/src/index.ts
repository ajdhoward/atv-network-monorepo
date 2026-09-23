export const ROOM_ID_REGEX = /^[a-z0-9-]{4,64}$/;
export function isValidRoomId(r:string){return ROOM_ID_REGEX.test(r);}
export const SECURITY_HEADERS: Record<string,string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'; connect-src 'self' wss://REPLACE_ME_REMOTE_HUB https://REPLACE_ME_API; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; object-src 'none'; base-uri 'self'",
  "Access-Control-Allow-Origin": "REPLACE_ME_TV_ORIGIN",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, x-atv-device-token, Content-Type",
  "Access-Control-Max-Age": "86400"
};
export function buildSecurityHeaders(remoteHub:string, tv:string, api?:string){ const h={...SECURITY_HEADERS}; h["Content-Security-Policy"]=h["Content-Security-Policy"].replace("REPLACE_ME_REMOTE_HUB",remoteHub).replace("REPLACE_ME_API",api||"https://api.atv.acidwurx.org").replace("REPLACE_ME_TV_ORIGIN",tv); h["Access-Control-Allow-Origin"]=tv; return h; }
export async function hashToken(t:string){ const d=new TextEncoder().encode(t); const b=await crypto.subtle.digest("SHA-256",d); return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""); }
export const KV_KEYS = { device: (h:string)=>`device:${h}`, pin: (r:string)=>`pin:${r}`, cache: (p:string,k:string)=>`cache:${p}:${k}` } as const;
export const DEVICE_TOKEN_TTL_SEC=86400;
export const CIRCUIT_OPEN_MS=60000;
export const PROVIDER_TIMEOUT_MS=1500;
export const EDGE_CACHE_TTL_SEC=300;
