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
  type Title,
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
      // High enough that the list is not just anime and festival films,
      // which top the averages but few in Sweden have seen.
      movie: { "vote_count.gte": 5000, without_genres: "10762" },
      tv: { "vote_count.gte": 3000, without_genres: "10762" },
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
 * Titles must have been out this long. New titles get high averages and
 * many votes quickly, but few have seen them yet, and a calibration card no
 * one has seen is a swipe on "Inte sett" instead of a rating.
 */
const MIN_AGE_YEARS = 2;
/**
 * About this share of each round is series. Left to the genre balance alone
 * a round had 3 series in 20, so the profile was built almost only on films
 * although people watch at least as many series.
 */
const SERIES_SHARE = 0.4;
/** Release date filters for discover, per media type, from MIN_AGE_YEARS. */
function oldEnough(): Record<MediaType, Filters> {
  const d = new Date();
  d.setFullYear(d.getFullYear() - MIN_AGE_YEARS);
  const before = d.toISOString().slice(0, 10);
  return {
    movie: { "primary_release_date.lte": before },
    tv: { "first_air_date.lte": before },
  };
}

/**
 * Genres that get a place of their own in every round, the most voted title
 * in each. The three sources fill up with drama, thrillers and blockbusters,
 * so these never made it into the first 20, and the profile knew nothing of
 * romance, horror or children's films until days of swiping later.
 */
const RESERVED: { genre: number; types: MediaType[] }[] = [
  { genre: 10749, types: ["movie"] }, // Romantik
  { genre: 27, types: ["movie"] }, // Skräck
  { genre: 99, types: ["movie", "tv"] }, // Dokumentär
  { genre: 10751, types: ["movie"] }, // Familj
  { genre: 10752, types: ["movie"] }, // Krig
];
/** TMDB pages looked through for a reserved genre's title. */
const RESERVED_PAGES = 3;
/**
 * A reserved title must be well liked too, not only well known: the most
 * voted documentary was the Harry Potter reunion, which says more about
 * Harry Potter than about documentaries. Below the bar only when nothing
 * known enough clears it.
 */
const RESERVED_QUALITY: Filters = {
  "vote_average.gte": 7.5,
  "vote_count.gte": 500,
};

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
  /** Titles already placed, whose genres count as used. */
  placed: T[] = [],
): T[] {
  const used = new Map<number, number>();
  for (const item of placed)
    for (const g of genresOf(item.genre_ids, item.media_type))
      used.set(g, (used.get(g) ?? 0) + 1);
  const weight = (g: number) => (g === 18 ? 1 / 3 : 1);
  const load = (item: T) =>
    Math.max(
      0,
      ...genresOf(item.genre_ids, item.media_type).map((g) => (used.get(g) ?? 0) * weight(g)),
    );
  const left = [...items];
  const out: T[] = [];
  const isTv = (item: T) => item.media_type === "tv";
  let tv = placed.filter(isTv).length;
  const total = placed.length + size;
  while (out.length < size && left.length) {
    // Series take turns with films: when they are behind their share, the
    // slot goes to a series if there is one left.
    const shown = placed.length + out.length;
    const wantTv = tv < Math.round(SERIES_SHARE * total) &&
      tv < SERIES_SHARE * (shown + 1);
    const pool = wantTv && left.some(isTv) ? left.filter(isTv) : left;
    let best = pool[0];
    for (const item of pool) if (load(item) < load(best)) best = item;
    left.splice(left.indexOf(best), 1);
    const item = best;
    if (isTv(item)) tv++;
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
  const age = oldEnough();
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
                filters: { ...src.filters[t], ...age[t] },
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

  const reservedHits = await reservedCandidates(done, age);
  const wanted = hits.slice(0, target);
  const rows = await getTitles([...wanted, ...reservedHits.flat()]);
  const none = new Set<number>();
  const rowsOf = (list: DiscoverHit[]) =>
    list.flatMap((h) => {
      const row = rows.get(key(h));
      return row ? [row] : [];
    });
  // One title per reserved genre, the most voted not already chosen.
  const reserved: Title[] = [];
  const taken = new Set<string>();
  for (const [i, list] of reservedHits.entries()) {
    // The genre should be what the title is about, not a side note: TMDB
    // lists a title's main genres first, and Forrest Gump is a romance
    // third, after comedy and drama.
    const { genre } = RESERVED[i];
    const free = rowsOf(list).filter((r) => !taken.has(key(r)));
    const row =
      free.find((r) => r.genre_ids.slice(0, 2).includes(genre)) ?? free[0];
    if (!row) continue;
    taken.add(key(row));
    reserved.push(row);
  }
  const found = rowsOf(wanted).filter((r) => !taken.has(key(r)));
  const usedCollections = new Set(
    reserved.flatMap((r) => (r.collection_id ? [r.collection_id] : [])),
  );
  const rest = balanceGenres(
    spread(found, usedCollections),
    CALIBRATION_SIZE - reserved.length,
    reserved,
  );
  // The reserved titles go in among the others, after a few well-known ones.
  const out = [...rest];
  reserved.forEach((row, i) =>
    out.splice(Math.min(out.length, 2 + i * 4), 0, row),
  );
  return out.map((row) => toCard(row, none, genres));
}

/**
 * The most voted titles in each reserved genre, per genre in RESERVED's
 * order, without what was answered.
 */
async function reservedCandidates(
  done: Set<string>,
  age: Record<MediaType, Filters>,
): Promise<DiscoverHit[][]> {
  const fetchGenre = (
    genre: number,
    types: MediaType[],
    extra: Filters,
  ): Promise<DiscoverHit[]> =>
    Promise.all(
      Array.from({ length: RESERVED_PAGES }, (_, i) => i + 1).flatMap((page) =>
        types.map((t) =>
          discover(t, {
            providerIds: "all",
            page,
            sortBy: "vote_count.desc",
            filters: { with_genres: genre, ...age[t], ...extra },
          }),
        ),
      ),
    ).then((pages) => pages.flatMap((p) => p.hits));
  return Promise.all(
    RESERVED.map(async ({ genre, types }) => {
      const [liked, known] = await Promise.all([
        fetchGenre(genre, types, RESERVED_QUALITY),
        fetchGenre(genre, types, {}),
      ]);
      return [...liked, ...known].filter((h) => !done.has(key(h))).slice(0, 5);
    }),
  );
}
