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
