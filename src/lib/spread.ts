/**
 * Spreads a ranked list so it does not get stuck in one place: at most one
 * film per collection (one Harry Potter at a time), and genres take turns by
 * each title's main genre, keeping the original order within a genre.
 */
export function spread<
  T extends { genre_ids: number[]; collection_id: number | null },
>(items: T[], usedCollections: Set<number> = new Set()): T[] {
  const buckets = new Map<number, T[]>();
  for (const item of items) {
    if (item.collection_id !== null) {
      if (usedCollections.has(item.collection_id)) continue;
      usedCollections.add(item.collection_id);
    }
    const genre = item.genre_ids[0] ?? 0;
    const bucket = buckets.get(genre);
    if (bucket) bucket.push(item);
    else buckets.set(genre, [item]);
  }

  const out: T[] = [];
  const queues = [...buckets.values()];
  for (
    let round = 0;
    out.length < items.length && queues.some((q) => q.length > round);
    round++
  ) {
    for (const q of queues) if (q[round]) out.push(q[round]);
  }
  return out;
}

/** Deterministic random numbers from a seed, so a reload keeps the order. */
export function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++)
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Shuffles a copy with a seed: same seed, same order. */
export function shuffle<T>(items: T[], seed: string): T[] {
  const rand = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
