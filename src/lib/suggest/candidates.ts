import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  certNumber,
  getDeclined,
  getExcluded,
  key,
  toCard,
  type Card,
  type DeckFilters,
} from "@/lib/deck";
import { getGenreNames } from "@/lib/tmdb/genres";
import { shuffle } from "@/lib/spread";
import {
  discover,
  getTitles,
  streamingProviders,
  type DiscoverHit,
  type MediaType,
  type Title,
} from "@/lib/tmdb/titles";

/** Film genre ids as TMDB's series genres, for discover on /tv. */
const FILM_TO_TV: Record<number, number> = {
  878: 10765, // Science Fiction → Sci-Fi & Fantasy
  14: 10765, // Fantasy → Sci-Fi & Fantasy
  28: 10759, // Action → Action & Adventure
  12: 10759, // Äventyr → Action & Adventure
  10752: 10768, // Krig → War & Politics
};
const SIX_MONTHS_MS = 182 * 24 * 3600 * 1000;
const NEW_SINCE_MS = 548 * 24 * 3600 * 1000; // about 18 months

type Context = {
  userId: string;
  groupId: string;
  providerIds: number[];
  filters: DeckFilters;
  /** Genre weights from the taste profile. */
  affinity: Record<number, number>;
  /** Keys already in the deck, so extras are new titles. */
  skip: Set<string>;
};

/** Same checks as the deck: on the user's services and within the age limit. */
function usable(
  row: Title | undefined,
  mine: Set<number>,
  maxCert: number | null,
): row is Title {
  if (!row) return false;
  if (!streamingProviders(row.providers_se).some((p) => mine.has(p.id)))
    return false;
  if (maxCert !== null) {
    const cert = certNumber(row.certification_se);
    if (cert !== null && cert > maxCert) return false;
  }
  return true;
}

/**
 * Candidates beyond the popular deck page, so prompt 2 has more to choose from:
 * acclaimed titles in the user's top genres and titles from the last 18 months.
 * The group's filters still apply (age limit and genres for Familj).
 */
export async function extraCandidates(
  ctx: Context,
  limit = 8,
): Promise<Card[]> {
  const top = Object.entries(ctx.affinity)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => Number(g));
  const since = new Date(Date.now() - NEW_SINCE_MS).toISOString().slice(0, 10);

  const searches: {
    type: MediaType;
    sortBy: string;
    filters: Record<string, string | number>;
  }[] = [];
  for (const type of ctx.filters.mediaTypes) {
    const base = ctx.filters[type];
    const genres =
      type === "tv" ? [...new Set(top.map((g) => FILM_TO_TV[g] ?? g))] : top;
    if (genres.length && !base.with_genres) {
      searches.push({
        type,
        sortBy: "vote_average.desc",
        filters: {
          ...base,
          with_genres: genres.join("|"),
          "vote_count.gte": 500,
        },
      });
    }
    searches.push({
      type,
      sortBy: "popularity.desc",
      filters: {
        ...base,
        [type === "movie" ? "primary_release_date.gte" : "first_air_date.gte"]:
          since,
      },
    });
  }

  const [results, excluded, genres] = await Promise.all([
    Promise.all(
      searches.map((s) =>
        discover(s.type, {
          providerIds: ctx.providerIds,
          page: 1,
          sortBy: s.sortBy,
          filters: s.filters,
        }),
      ),
    ),
    getExcluded(ctx.userId, ctx.groupId),
    getGenreNames(),
  ]);

  // Take turns between the searches so each source gets a share.
  const picked = new Set<string>();
  const hits: DiscoverHit[] = [];
  const longest = Math.max(0, ...results.map((r) => r.hits.length));
  for (let i = 0; i < longest && hits.length < limit * 2; i++) {
    for (const r of results) {
      const h = r.hits[i];
      if (!h) continue;
      const k = key(h);
      if (excluded.has(k) || ctx.skip.has(k) || picked.has(k)) continue;
      picked.add(k);
      hits.push(h);
    }
  }

  const rows = await getTitles(hits);
  const mine = new Set(ctx.providerIds);
  return hits
    .map((h) => rows.get(key(h)))
    .filter((row) => usable(row, mine, ctx.filters.maxCert))
    .slice(0, limit)
    .map((row) => toCard(row, mine, genres));
}

/** How many of each kind from the user's lists go to prompt 2 per session. */
const FROM_LIST = { want: 2, maybe: 2, rewatch: 2, loved: 3 };
const SEEN_PAUSE_MS = 7 * 24 * 3600 * 1000;

type Ref = { tmdb_id: number; media_type: MediaType };

/**
 * Candidates from the user's own lists, rotated per session so the same few
 * do not come back every time:
 * - the group's list, "vill gärna" before "vill se" (prompt 2 weighs it most)
 * - se igen for the group, any night
 * - when the mood is safe, loved titles not rated in the last 6 months
 * Turned down titles are left out, and so are titles answered "Sett" in the
 * last week, since the user just took a stand on them.
 */
export async function listCandidates(
  ctx: Pick<Context, "userId" | "groupId" | "providerIds" | "filters"> & {
    seed: string;
  },
  comfort: boolean,
  /** False when the mood asks for something new: no se igen or loved titles. */
  allowSeen = true,
): Promise<Card[]> {
  const supabase = await createClient();
  const sixMonthsAgo = new Date(Date.now() - SIX_MONTHS_MS).toISOString();
  const weekAgo = new Date(Date.now() - SEEN_PAUSE_MS).toISOString();
  const [list, loved, recentSeen, declined] = await Promise.all([
    supabase
      .from("watchlist")
      .select("tmdb_id, media_type, interest")
      .eq("user_id", ctx.userId)
      .eq("group_id", ctx.groupId),
    comfort
      ? supabase
          .from("ratings")
          .select("tmdb_id, media_type")
          .eq("user_id", ctx.userId)
          .eq("rating", 3)
          .lt("updated_at", sixMonthsAgo)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("interactions")
      .select("tmdb_id, media_type")
      .eq("user_id", ctx.userId)
      .eq("action", "seen")
      .gte("created_at", weekAgo),
    getDeclined(ctx.userId, ctx.groupId),
  ]);
  if (list.error) throw list.error;
  if (loved.error) throw loved.error;
  if (recentSeen.error) throw recentSeen.error;

  const paused = new Set(recentSeen.data.map(key));
  const ok = (r: Ref) => !declined.has(key(r)) && !paused.has(key(r));
  const pick = (rows: Ref[], n: number, salt: string) =>
    shuffle(rows.filter(ok), `${ctx.seed}:${salt}`).slice(0, n);
  const of = (interest: string) =>
    (list.data as (Ref & { interest: string })[]).filter(
      (r) => r.interest === interest,
    );

  const refs = [
    ...pick(of("want"), FROM_LIST.want, "want"),
    ...pick(of("maybe"), FROM_LIST.maybe, "maybe"),
    ...(allowSeen ? pick(of("rewatch"), FROM_LIST.rewatch, "rewatch") : []),
    ...(allowSeen
      ? pick((loved.data ?? []) as Ref[], FROM_LIST.loved, "loved")
      : []),
  ];
  const unique = [...new Map(refs.map((r) => [key(r), r])).values()];
  if (unique.length === 0) return [];
  const [rows, genres] = await Promise.all([
    getTitles(unique),
    getGenreNames(),
  ]);
  const mine = new Set(ctx.providerIds);
  return unique
    .map((r) => rows.get(key(r)))
    .filter((row) => usable(row, mine, ctx.filters.maxCert))
    .map((row) => toCard(row, mine, genres));
}
