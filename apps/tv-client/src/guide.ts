export type Channel = {
  id: string;
  name: string;
  country: string;
  category: string;
  genres: string[];
};

export type GuideResult = {
  channels: Channel[];
  // True when the network failed and the last saved lineup is being shown.
  stale: boolean;
};

type GuidePage = {
  channels?: Channel[];
  nextCursor?: string | null;
};

const CACHE_KEY = "atv:guide:v1";
const MAX_PAGES = 20;

function isChannel(value: unknown): value is Channel {
  const channel = value as Channel | null;
  return !!channel && typeof channel.id === "string";
}

function readCache(): Channel[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { channels?: unknown };
    const channels = Array.isArray(parsed.channels) ? parsed.channels.filter(isChannel) : [];
    return channels.length ? channels : null;
  } catch {
    return null;
  }
}

function writeCache(channels: Channel[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), channels }));
  } catch {
    // A full or disabled localStorage must not break playback.
  }
}

async function fetchPage(cursor?: string): Promise<GuidePage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  // Deliberately cacheable: /api/guide answers `max-age=30` with an ETag, so
  // the browser revalidates with If-None-Match instead of refetching the body.
  // `cache: "no-store"` here would disable that and the CDN hint both ways.
  const res = await fetch(`/api/guide${query}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`guide responded ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json"))
    throw new Error("guide returned a non-JSON response");
  return (await res.json()) as GuidePage;
}

export async function loadGuide(): Promise<GuideResult> {
  try {
    const channels: Channel[] = [];
    let cursor: string | null = null;
    // /api/guide pages with nextCursor; a partial lineup is worse than a slow one.
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await fetchPage(cursor ?? undefined);
      if (Array.isArray(body.channels)) channels.push(...body.channels.filter(isChannel));
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    if (channels.length) writeCache(channels);
    return { channels, stale: false };
  } catch (err) {
    const cached = readCache();
    if (cached) return { channels: cached, stale: true };
    throw err;
  }
}
