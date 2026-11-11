import "server-only";
import { createClient } from "@/lib/supabase/server";
import { key, toCard, type Card } from "@/lib/deck";
import { getGenreNames } from "@/lib/tmdb/genres";
import { genresOf } from "@/lib/profile";
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
/** Answered titles per page, roughly: the six lists overlap, so less than 120. */
const TITLES_PER_PAGE = 90;
const TYPES: MediaType[] = ["movie", "tv"];
type Filters = Record<string, string | number>;
/**
 * Three sources take turns: the most voted (widely seen), the best rated with
 * a fair number of votes (smaller, acclaimed titles), and the most voted
 * outside action, adventure, sci-fi, fantasy and animation, which otherwise
 * fill the top of both lists. So the profile is not built from blockbusters
 * only, and romance, horror or documentaries get a chance.
 */
const SOURCES: { sortBy: string; filters: Record<MediaType, Filters> }[] = [
  { sortBy: "vote_count.desc", filters: { movie: {}, tv: {} } },
  {
    sortBy: "vote_average.desc",
    filters: {
      movie: { "vote_count.gte": 1000, without_genres: "10762" },
      tv: { "vote_count.gte": 1000, without_genres: "10762" },
    },
  },
  {
    sortBy: "vote_count.desc",
    filters: {
      movie: { without_genres: "28,12,878,14,16" },
      tv: { without_genres: "10759,10765,16,10762" },
    },
  },
];

/**
 * Picks `size` titles so genres get about equal room: each slot takes the
 * first title whose genres have been used least so far. Series genres count
 * as the film genres they cover, so Action & Adventure and Action are one.
 * Drama is on most titles and counts a third, or it would block the rest.
 */
function balanceGenres<
  T extends { genre_ids: number[]; media_type?: "movie" | "tv" },
>(
  items: T[],
  size: number,
): T[] {
  const used = new Map<number, number>();
  const weight = (g: number) => (g === 18 ? 1 / 3 : 1);
  const load = (item: T) =>
    Math.max(
      0,
      ...genresOf(item.genre_ids, item.media_type).map((g) => (used.get(g) ?? 0) * weight(g)),
    );
  const left = [...items];
  const out: T[] = [];
  while (out.length < size && left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++)
      if (load(left[i]) < load(left[best])) best = i;
    const [item] = left.splice(best, 1);
    out.push(item);
    for (const g of genresOf(item.genre_ids, item.media_type))
      used.set(g, (used.get(g) ?? 0) + 1);
  }
  return out;
}

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
  // Fetch extra so balancing genres and film series has room to choose.
  const target = CALIBRATION_SIZE * 3;

  // Fetch pages in batches until there are enough unanswered titles. The
  // more someone has answered, the further down they start: each page of the
  // six lists holds up to 120 titles, and the first pages get used up.
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
            TYPES.map((t) =>
              discover(t, {
                providerIds: "all",
                page,
                sortBy: src.sortBy,
                filters: src.filters[t],
              }),
            ),
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
  return balanceGenres(spread(found), CALIBRATION_SIZE).map((row) =>
    toCard(row, none, genres),
  );
}
