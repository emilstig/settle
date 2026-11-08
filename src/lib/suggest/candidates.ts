import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  certNumber,
  getExcluded,
  key,
  toCard,
  type Card,
  type DeckFilters,
} from "@/lib/deck";
import { getGenreNames } from "@/lib/tmdb/genres";
import {
  discover,
  getTitles,
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
  if (!(row.providers_se?.flatrate ?? []).some((p) => mine.has(p.id)))
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

/**
 * Seen titles that may come back, per the domain rules: what the user said
 * "Se igen med" this group about, any night, and, when the mood is safe,
 * loved titles not rated in the last 6 months.
 */
export async function seenCandidates(
  ctx: Pick<Context, "userId" | "groupId" | "providerIds" | "filters">,
  comfort: boolean,
): Promise<Card[]> {
  const supabase = await createClient();
  const sixMonthsAgo = new Date(Date.now() - SIX_MONTHS_MS).toISOString();
  const [rewatch, loved] = await Promise.all([
    supabase
      .from("watchlist")
      .select("tmdb_id, media_type")
      .eq("user_id", ctx.userId)
      .eq("group_id", ctx.groupId)
      .eq("interest", "rewatch")
      .limit(5),
    comfort
      ? supabase
          .from("ratings")
          .select("tmdb_id, media_type")
          .eq("user_id", ctx.userId)
          .eq("rating", 3)
          .lt("updated_at", sixMonthsAgo)
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (rewatch.error) throw rewatch.error;
  if (loved.error) throw loved.error;

  const refs = [...rewatch.data, ...(loved.data ?? [])] as {
    tmdb_id: number;
    media_type: MediaType;
  }[];
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
