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
const MAX_PAGES = 30;
/** Answered titles per page, roughly: the four lists overlap, so less than 80. */
const TITLES_PER_PAGE = 60;
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
 * Well-known titles on any service in Sweden, for rating with swipes. Not
 * only the user's services: a rating says what they like, not what they can
 * watch tonight, and one or two services would make the pool small. The cards
 * show no services, so no one takes them to be on the services just chosen. Sorted by
 * vote count so they are likely to have been seen. Skips anything already
 * rated, marked as seen, or answered "Inte sett", so calibrating again shows
 * new titles. `skipped` holds titles passed over with "Hoppa över" this time,
 * which are not saved and so only stay away until the calibration is left.
 */
export async function getCalibrationCards(
  userId: string,
  skipped: Iterable<string> = [],
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

  const answered = new Set(
    [...ratings.data, ...seen.data, ...notSeen.data].map(key),
  );
  const done = new Set([...answered, ...skipped]);
  const picked = new Set<string>();
  const hits: DiscoverHit[] = [];
  // Fetch extra so spreading over genres and film series still leaves enough.
  const target = CALIBRATION_SIZE * 2;

  // Fetch pages in batches until there are enough unanswered titles. The
  // more someone has answered, the further down they start: each page of the
  // four lists holds up to 80 titles, and the first pages get used up.
  const startPage = Math.max(1, Math.floor(answered.size / TITLES_PER_PAGE));
  for (
    let first = startPage;
    first < startPage + MAX_PAGES && hits.length < target;
    first += BATCH
  ) {
    const pages = Array.from({ length: BATCH }, (_, i) => first + i);
    const results = await Promise.all(
      pages.flatMap((page) =>
        SOURCES.map((src) =>
          Promise.all(
            TYPES.map((t) => discover(t, { providerIds: "all", page, ...src })),
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
  const none = new Set<number>();
  const found = wanted.flatMap((h) => {
    const row = rows.get(key(h));
    return row ? [row] : [];
  });
  return spread(found)
    .slice(0, CALIBRATION_SIZE)
    .map((row) => toCard(row, none, genres));
}
