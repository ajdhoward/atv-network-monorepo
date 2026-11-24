// Client for /api/resolve.
//
// Two answers are about the client rather than the channel, and both get their own
// kind: a 429 is the Worker asking this browser to slow down, so it becomes
// "retry" with the delay to wait; a 401 is the Worker asking for the household
// token (option C), so it becomes "unauthorized" and the prompt opens. Reporting
// either as "unavailable" would blame a channel that is fine.

import { authorizationHeader, readToken } from "./token";

export type ResolveResult =
  | { kind: "ok"; url: string }
  | { kind: "retry"; afterMs: number }
  | { kind: "unauthorized" }
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
  token: string | null = readToken(),
): Promise<ResolveResult> {
  const response = await fetchImpl(`/api/resolve?id=${encodeURIComponent(id)}`, {
    // Read per call, not once at start-up: a token entered from the prompt has to
    // be used by the very next attempt, and the guide is public either way.
    headers: { accept: "application/json", ...authorizationHeader(token) },
  });
  // Before the limiter answers, and before the id is even looked at: no token, or
  // one the Worker does not accept.
  if (response.status === 401) return { kind: "unauthorized" };
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
