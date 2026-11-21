export type RawItem = { id: string; country: string; category: string; genres: string[] };

// Deterministic: indexes the whole lineup. The previous wall-clock cutoff made
// /api/guide silently answer with a random prefix of the channels and marked it
// `truncated`, which no client acted on. Response size is bounded by pagination
// (limit + nextCursor) in the router instead.
export function runRulesIndex<T extends RawItem>(
  payload: T[],
): {
  byCountry: Map<string, T[]>;
  byCategory: Map<string, T[]>;
  list: T[];
} {
  const byCountry = new Map<string, T[]>();
  const byCategory = new Map<string, T[]>();
  const list: T[] = [];

  for (const item of payload) {
    list.push(item);
    if (!byCountry.has(item.country)) byCountry.set(item.country, []);
    byCountry.get(item.country)!.push(item);
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  return { byCountry, byCategory, list };
}
