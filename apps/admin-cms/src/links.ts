import type { ChannelDef, GuidePayload } from "@atv/ui-shared";

// On-demand coverage check for the admin panel. It reads the public guide for
// the channel list and asks the batched resolve endpoint for each channel, so
// it never needs a secret and never receives a stream link: only which ids came
// back resolved, missing or invalid.
export type LinkState = "configured" | "missing" | "invalid";

export type LinkCheck = { id: string; name: string; state: LinkState };

export type BatchPayload = {
  resolved?: { id?: string }[];
  missing?: string[];
  invalid?: string[];
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
  return states;
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
    if (Array.isArray(body.channels)) channels.push(...body.channels);
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return channels;
}

export async function checkLinks(fetchImpl: typeof fetch = fetch): Promise<LinkCheck[]> {
  const channels = await loadChannels(fetchImpl);
  const states: Record<string, LinkState> = {};
  for (const ids of chunk(
    channels.map((channel) => channel.id),
    BATCH_SIZE,
  )) {
    const query = ids.map((id) => encodeURIComponent(id)).join(",");
    const res = await fetchImpl(`/api/resolve?ids=${query}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`resolve responded ${res.status}`);
    Object.assign(states, classifyBatch(ids, (await res.json()) as BatchPayload));
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
};

export const LINK_ICON: Record<LinkState, string> = {
  configured: "✅",
  missing: "❌",
  invalid: "⚠️",
};
