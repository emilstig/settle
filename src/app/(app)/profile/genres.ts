/** Shorter names on the tiles, where a long one would wrap. */
const SHORT: Record<number, string> = { 878: "Sci-fi" };

export type TasteGenre = { id: number; name: string; value: number };

/**
 * The genre profile as Din smak shows it: every ranked genre, most liked
 * first. The weights come from buildProfile (average per title).
 */
export function tasteGenres(
  affinity: Record<number, number>,
  names: Record<number, string>,
): TasteGenre[] {
  return Object.entries(affinity)
    .map(([id, value]) => ({
      id: Number(id),
      name: SHORT[Number(id)] ?? names[Number(id)],
      value,
    }))
    .filter((g) => g.name)
    .sort((a, b) => b.value - a.value);
}

/** Labelled "Gillar mest" on the tiles and named in Profil. */
export const TOP_GENRES = 3;
