// Client for /api/resolve.
//
// The Worker rate limits resolves per client IP. A 429 there is the server
// asking this browser to slow down, not a channel that is broken, so it is
// reported as "retry" with the delay to wait rather than "unavailable".

export type ResolveResult =
  | { kind: "ok"; url: string }
  | { kind: "retry"; afterMs: number }
  | { kind: "missing" }
  | { kind: "unavailable" };

// A missing or unparseable Retry-After must not turn into an immediate retry.
export const DEFAULT_RETRY_MS = 5_000;
export const MAX_RETRY_MS = 60_000;

function clampMs(ms: number): number {
  return Math.min(Math.max(Math.round(ms), 0), MAX_RETRY_MS);
}

// Retry-After is either delta-seconds or an HTTP date.
export function retryAfterMs(response: Response): number {
  const raw = response.headers.get("Retry-After");
  if (!raw) return DEFAULT_RETRY_MS;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return clampMs(seconds * 1000);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return clampMs(at - Date.now());
  return DEFAULT_RETRY_MS;
}

export async function resolveChannel(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolveResult> {
  const response = await fetchImpl(`/api/resolve?id=${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 429) return { kind: "retry", afterMs: retryAfterMs(response) };
  if (!response.ok) return { kind: "unavailable" };
  const body = (await response.json()) as { url?: unknown } | null;
  if (!body || typeof body.url !== "string" || !body.url) return { kind: "missing" };
  return { kind: "ok", url: body.url };
}

export type RetryOptions = {
  // Extra attempts after the first, so attempts: 1 allows two requests.
  attempts?: number;
  // Cap on one pause. The server advertises a whole window (60 s), which is too
  // long to park a TV on, so the client waits at most this long per retry.
  maxWaitMs?: number;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  onRetry?: (afterMs: number, waitMs: number) => void;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// Waits out a 429 instead of reporting the channel as unavailable. Network
// errors still reject, so the caller keeps its own "unavailable" wording there.
export async function resolveWithRetry(
  id: string,
  options: RetryOptions = {},
): Promise<ResolveResult> {
  const attempts = options.attempts ?? 1;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_RETRY_MS;
  const wait = options.wait ?? sleep;
  for (let attempt = 0; ; attempt += 1) {
    const result = await resolveChannel(id, options.fetchImpl);
    if (result.kind !== "retry" || attempt >= attempts) return result;
    const pause = Math.max(0, Math.min(result.afterMs, maxWaitMs));
    options.onRetry?.(result.afterMs, pause);
    await wait(pause);
  }
}
