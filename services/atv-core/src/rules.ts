type RawItem = { id: string; country: string; category: string; genres: string[] };
export function runRulesIndex(payload: RawItem[]): { byCountry: Map<string, RawItem[]>, byCategory: Map<string, RawItem[]>, list: RawItem[] } {
  const start = performance.now();
  const byCountry = new Map<string, RawItem[]>();
  const byCategory = new Map<string, RawItem[]>();
  const byGenre = new Map<string, RawItem[]>();
  const list: RawItem[] = [];
  const MAX_MS = 8.0;
  for (let i = 0; i < payload.length; i++) {
    if (i % 250 === 0 && performance.now() - start > MAX_MS) {
      console.warn(`rules cutoff at ${i}/${payload.length} due to 8ms budget`);
      break;
    }
    const item = payload[i];
    list.push(item);
    if (!byCountry.has(item.country)) byCountry.set(item.country, []);
    byCountry.get(item.country)!.push(item);
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
    for (const g of item.genres) {
      if (!byGenre.has(g)) byGenre.set(g, []);
      byGenre.get(g)!.push(item);
    }
  }
  return { byCountry, byCategory, list };
}
