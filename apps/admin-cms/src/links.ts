import type { ChannelDef, GuidePayload } from "@atv/ui-shared";
import { authHeader } from "./linkToken";

// On-demand coverage check for the admin panel. It reads the public guide for the
// channel list and asks the batched resolve endpoint for each channel; the guide
// needs no credential, so only the resolve calls carry the household token the
// panel stores. The response does carry a link per resolved id, in
// `resolved[].url`; this module reads only the ids, so nothing here can show,
// keep or log a URL.
// "unconfigured" is the deployment, not the channel: its Drive links exist but
// this Worker has no `ATV_STREAM_SIGNING_KEY`, so it cannot proxy them (P5).
export type LinkState = "configured" | "missing" | "invalid" | "unconfigured";

export type LinkCheck = { id: string; name: string; state: LinkState };

export type BatchPayload = {
  // The worker does include the link in each resolved entry. Naming it here keeps
  // the type true to the wire while `classifyBatch` reads only the id: nothing in
  // this app is allowed to show or keep a stream URL.
  resolved?: { id?: string; url?: string }[];
  missing?: string[];
  invalid?: string[];
  // Optional on the wire: a deployment older than P5 omits the list entirely.
  unconfigured?: string[];
};

// Matches the worker's cap on ?ids=.
export const BATCH_SIZE = 20;
const MAX_GUIDE_PAGES = 20;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Any id the worker did not account for is reported as missing rather than
// silently marked healthy.
export function classifyBatch(ids: string[], body: BatchPayload): Record<string, LinkState> {
  const states: Record<string, LinkState> = {};
  for (const id of ids) states[id] = "missing";
  for (const entry of body.resolved ?? []) {
    if (typeof entry?.id === "string") states[entry.id] = "configured";
  }
  for (const id of body.invalid ?? []) {
    if (typeof id === "string") states[id] = "invalid";
  }
  for (const id of body.unconfigured ?? []) {
    if (typeof id === "string") states[id] = "unconfigured";
  }
  return states;
}

// The guide is the one payload the panel does not control, so it narrows here
// the way `apps/tv-client`'s loader does. Without this a channel missing an id
// rendered as `undefined` in the list and produced an `?ids=undefined` batch.
function isChannel(value: unknown): value is ChannelDef {
  const channel = value as ChannelDef | null;
  return !!channel && typeof channel.id === "string" && typeof channel.name === "string";
}

export async function loadChannels(
  fetchImpl: typeof fetch = fetch,
  maxPages = MAX_GUIDE_PAGES,
): Promise<ChannelDef[]> {
  const channels: ChannelDef[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await fetchImpl(`/api/guide${query}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`guide responded ${res.status}`);
    const body = (await res.json()) as GuidePayload;
    if (Array.isArray(body.channels)) channels.push(...body.channels.filter(isChannel));
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return channels;
}

/** How far the walk has got, so the panel can show it rather than a spinner. */
export type LinkProgress = { done: number; total: number };

export async function checkLinks(
  fetchImpl: typeof fetch = fetch,
  onProgress?: (progress: LinkProgress) => void,
  token: string | null = null,
): Promise<LinkCheck[]> {
  // R6: once the worker enforces the household token, a headerless batch answers
  // 401 for every request, and "0 of 12 have a usable link" would read as twelve
  // broken streams.
  const auth = authHeader(token);
  const channels = await loadChannels(fetchImpl);
  const states: Record<string, LinkState> = {};
  // One batch at a time, so a failure names the batch it came from and the
  // limiter sees the walk rather than a burst.
  const batches = chunk(
    channels.map((channel) => channel.id),
    BATCH_SIZE,
  );
  let done = 0;
  for (const ids of batches) {
    const query = ids.map((id) => encodeURIComponent(id)).join(",");
    const res = await fetchImpl(`/api/resolve?ids=${query}`, {
      headers: { accept: "application/json", ...auth },
    });
    if (res.status === 401) {
      throw new Error(
        "The worker needs the household token — paste it above and run the check again.",
      );
    }
    if (res.status === 503) {
      // A batch answers 200 with the ids in `unconfigured`; a 503 here is about
      // the deployment as a whole, so name the likelier cause rather than the code.
      throw new Error(
        "This deployment cannot resolve streams right now (503) — its token or stream signing key is misconfigured.",
      );
    }
    if (!res.ok) throw new Error(`resolve responded ${res.status}`);
    Object.assign(states, classifyBatch(ids, (await res.json()) as BatchPayload));
    done += 1;
    onProgress?.({ done, total: batches.length });
  }
  return channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    state: states[channel.id] ?? "missing",
  }));
}

export const LINK_LABEL: Record<LinkState, string> = {
  configured: "link ready",
  missing: "no link",
  invalid: "link is not a usable https URL",
  unconfigured: "Drive link, but this deployment has no stream signing key",
};

export const LINK_ICON: Record<LinkState, string> = {
  configured: "✅",
  missing: "❌",
  invalid: "⚠️",
  unconfigured: "🔑",
};
