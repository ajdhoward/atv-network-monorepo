export type Channel = {
  id: string;
  name: string;
  country: string;
  category: string;
  genres: string[];
};

type GuideResponse = {
  generatedAt: number;
  total: number;
  channels: Channel[];
};

export async function loadGuide(): Promise<Channel[]> {
  const r = await fetch('/api/guide', { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`guide responded ${r.status}`);
  const contentType = r.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('guide returned a non-JSON response');
  const data = (await r.json()) as Partial<GuideResponse>;
  if (!Array.isArray(data.channels)) throw new Error('guide payload has no channels');
  return data.channels.filter((c): c is Channel => !!c && typeof c.id === 'string');
}
