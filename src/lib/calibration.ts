import "server-only";
import { createClient } from "@/lib/supabase/server";
import { key, toCard, type Card } from "@/lib/deck";
import { getGenreNames } from "@/lib/tmdb/genres";
import { spread } from "@/lib/spread";
import {
  discover,
  getTitles,
  type DiscoverHit,
  type MediaType,
} from "@/lib/tmdb/titles";

export const CALIBRATION_SIZE = 20;
/** TMDB pages fetched per round, and the most pages to look through. */
const BATCH = 3;
const MAX_PAGES = 15;
const TYPES: MediaType[] = ["movie", "tv"];
/**
 * Two sources take turns: the most voted (widely seen) and the best rated with
 * a fair number of votes (smaller, acclaimed titles), so the profile is not
 * built from blockbusters only.
 */
const SOURCES = [
  { sortBy: "vote_count.desc", filters: {} },
  {
    sortBy: "vote_average.desc",
    filters: { "vote_count.gte": 1000, without_genres: "10762" },
  },
];

/**
 * Well-known titles on the user's services, for rating with swipes. Sorted by
 * vote count so they are likely to have been seen. Skips anything already
 * rated, marked as seen, or answered "Inte sett", so calibrating again shows
 * new titles.
 */
export async function getCalibrationCards(
  userId: string,
  providerIds: number[],
): Promise<Card[]> {
  const supabase = await createClient();
  const [ratings, seen, notSeen, genres] = await Promise.all([
    supabase
      .from("ratings")
      .select("tmdb_id, media_type")
      .eq("user_id", userId),
    supabase
      .from("watch_log")
      .select("tmdb_id, media_type")
      .eq("user_id", userId),
    supabase
      .from("interactions")
      .select("tmdb_id, media_type")
      .eq("user_id", userId)
      .eq("action", "not_seen"),
    getGenreNames(),
  ]);
  if (ratings.error) throw ratings.error;
  if (seen.error) throw seen.error;
  if (notSeen.error) throw notSeen.error;

  const done = new Set(
    [...ratings.data, ...seen.data, ...notSeen.data].map(key),
  );
  const picked = new Set<string>();
  const hits: DiscoverHit[] = [];
  // Fetch extra so spreading over genres and film series still leaves enough.
  const target = CALIBRATION_SIZE * 2;

  // Fetch pages in batches until there are enough unanswered titles.
  for (
    let first = 1;
    first <= MAX_PAGES && hits.length < target;
    first += BATCH
  ) {
    const pages = Array.from({ length: BATCH }, (_, i) => first + i);
    const results = await Promise.all(
      pages.flatMap((page) =>
        SOURCES.map((src) =>
          Promise.all(
            TYPES.map((t) => discover(t, { providerIds, page, ...src })),
          ),
        ),
      ),
    );
    // Take turns between sources, film and series, so each round mixes
    // well-known and acclaimed titles.
    const lists = results.flatMap(([movies, shows]) => [
      movies.hits,
      shows.hits,
    ]);
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) {
      for (const h of lists.map((l) => l[i])) {
        if (!h || done.has(key(h)) || picked.has(key(h))) continue;
        picked.add(key(h));
        hits.push(h);
      }
    }
    if (
      results.every(
        ([m, t]) => first + BATCH > Math.max(m.totalPages, t.totalPages),
      )
    )
      break;
  }

  const wanted = hits.slice(0, target);
  const rows = await getTitles(wanted);
  const mine = new Set(providerIds);
  const found = wanted.flatMap((h) => {
    const row = rows.get(key(h));
    return row ? [row] : [];
  });
  return spread(found)
    .slice(0, CALIBRATION_SIZE)
    .map((row) => toCard(row, mine, genres));
}
