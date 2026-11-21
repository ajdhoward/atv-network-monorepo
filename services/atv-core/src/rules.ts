export type RawItem = { id: string; country: string; category: string; genres: string[] };
export function runRulesIndex<T extends RawItem>(payload: T[]): { byCountry: Map<string, T[]>, byCategory: Map<string, T[]>, list: T[], truncated: boolean } {
  const start = performance.now();
  const byCountry = new Map<string, T[]>();
  const byCategory = new Map<string, T[]>();
  const byGenre = new Map<string, T[]>();
  const list: T[] = [];
  const MAX_MS = 8.0;
  let truncated = false;
  for (let i = 0; i < payload.length; i++) {
    if (i % 250 === 0 && performance.now() - start > MAX_MS) {
      console.warn(`rules cutoff at ${i}/${payload.length} due to 8ms budget`);
      truncated = true;
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
  return { byCountry, byCategory, list, truncated };
}
