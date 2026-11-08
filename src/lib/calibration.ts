import "server-only";
import { createClient } from "@/lib/supabase/server";
import { key, toCard, type Card } from "@/lib/deck";
import { getGenreNames } from "@/lib/tmdb/genres";
import { discover, getTitles, type DiscoverHit, type MediaType } from "@/lib/tmdb/titles";

export const CALIBRATION_SIZE = 20;
const PAGES = [1, 2, 3];
const TYPES: MediaType[] = ["movie", "tv"];

/**
 * Well-known titles on the user's services, for rating with swipes. Sorted by
 * vote count so they are likely to have been seen. Skips anything already
 * rated or marked as seen, so calibrating again shows new titles.
 */
export async function getCalibrationCards(userId: string, providerIds: number[]): Promise<Card[]> {
  const supabase = await createClient();
  const [ratings, seen, results, genres] = await Promise.all([
    supabase.from("ratings").select("tmdb_id, media_type").eq("user_id", userId),
    supabase.from("watch_log").select("tmdb_id, media_type").eq("user_id", userId),
    Promise.all(
      PAGES.map((page) =>
        Promise.all(TYPES.map((t) => discover(t, { providerIds, page, sortBy: "vote_count.desc" }))),
      ),
    ),
    getGenreNames(),
  ]);
  if (ratings.error) throw ratings.error;
  if (seen.error) throw seen.error;

  const done = new Set([...ratings.data, ...seen.data].map(key));
  const picked = new Set<string>();
  const hits: DiscoverHit[] = [];
  // Alternate film and series within each page.
  for (const [movies, shows] of results) {
    const longest = Math.max(movies.hits.length, shows.hits.length);
    for (let i = 0; i < longest; i++) {
      for (const h of [movies.hits[i], shows.hits[i]]) {
        if (!h || done.has(key(h)) || picked.has(key(h))) continue;
        picked.add(key(h));
        hits.push(h);
      }
    }
  }

  const wanted = hits.slice(0, CALIBRATION_SIZE + 4);
  const rows = await getTitles(wanted);
  const mine = new Set(providerIds);
  return wanted
    .flatMap((h) => {
      const row = rows.get(key(h));
      return row ? [toCard(row, mine, genres)] : [];
    })
    .slice(0, CALIBRATION_SIZE);
}
