import "server-only";
import { createClient } from "@/lib/supabase/server";
import { genresOf } from "@/lib/profile";
import { shuffle } from "@/lib/spread";
import {
  getRecommendations,
  type Recommendation,
} from "@/lib/tmdb/recommendations";
import type { MediaType, Title } from "@/lib/tmdb/titles";

/**
 * The lane "Liknar det ni gillat": TMDB's recommendations for titles the
 * group already liked. Seeds are the group's own, since the user's personal
 * favourites (often children's films) do not say what works with a partner.
 */

const YEAR_MS = 365 * 24 * 3600 * 1000;
/**
 * Seed titles per session, rotated so the lane does not repeat itself. With
 * fewer, hardly any title is recommended by more than one seed, and the
 * votes say nothing.
 */
const MAX_SEEDS = 24;
/** Enough votes on TMDB for the rating to mean something. */
const MIN_VOTES = { movie: 200, tv: 100 };

export type SimilarHit = Recommendation & {
  /** How many seeds recommend it; more means a surer match. */
  votes: number;
};

type Ref = { tmdb_id: number; media_type: MediaType };
const keyOf = (r: Ref) => `${r.media_type}:${r.tmdb_id}`;

/**
 * Seeds: right swipes and ratings of "gillar mycket" or "älskar" with the
 * group in the last year, the latest reaction per title counting. For Själv,
 * also every title the user loves.
 */
async function getSeeds(
  userId: string,
  group: { id: string; kind: string },
): Promise<Ref[]> {
  const supabase = await createClient();
  const yearAgo = new Date(Date.now() - YEAR_MS).toISOString();
  const solo = group.kind === "solo";
  const [swipes, groupRatings, loved] = await Promise.all([
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, action, sessions!inner(group_id)")
      .eq("user_id", userId)
      .eq("sessions.group_id", group.id)
      .or("action.eq.right,reason.eq.not_for_me")
      .gte("created_at", yearAgo)
      .order("created_at"),
    supabase
      .from("ratings")
      .select("tmdb_id, media_type, rating")
      .eq("user_id", userId)
      .eq("group_id", group.id)
      .gte("updated_at", yearAgo),
    solo
      ? supabase
          .from("ratings")
          .select("tmdb_id, media_type, group_id")
          .eq("user_id", userId)
          .eq("rating", 3)
          .or(`group_id.is.null,group_id.eq.${group.id}`)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (swipes.error) throw swipes.error;
  if (groupRatings.error) throw groupRatings.error;
  if (loved.error) throw loved.error;

  const liked = new Map<string, boolean>();
  const refs = new Map<string, Ref>();
  const put = (r: Ref, ok: boolean) => {
    liked.set(keyOf(r), ok);
    refs.set(keyOf(r), { tmdb_id: r.tmdb_id, media_type: r.media_type });
  };
  for (const s of swipes.data as unknown as (Ref & { action: string })[])
    put(s, s.action === "right");
  for (const r of groupRatings.data as (Ref & { rating: number })[])
    put(r, r.rating >= 2);
  for (const r of loved.data as Ref[]) put(r, true);
  return [...refs.values()].filter((r) => liked.get(keyOf(r)));
}

/**
 * The lane for a session, best first: recommended by the most seeds, then the
 * best rated. Titles with few votes and genres the group has turned down are
 * left out.
 */
export async function getSimilar({
  userId,
  group,
  seed,
  avoid,
}: {
  userId: string;
  group: { id: string; kind: string };
  /** The session id, so the seeds rotate between sessions. */
  seed: string;
  /** Film genre ids the group has turned down (see buildGroupTaste). */
  avoid: number[];
}): Promise<SimilarHit[]> {
  const seeds = shuffle(await getSeeds(userId, group), seed).slice(
    0,
    MAX_SEEDS,
  );
  if (seeds.length === 0) return [];
  const lists = await Promise.all(
    seeds.map((s) => getRecommendations(s.media_type, s.tmdb_id)),
  );

  const avoided = new Set(avoid);
  const seedKeys = new Set(seeds.map(keyOf));
  const hits = new Map<string, SimilarHit>();
  for (const list of lists) {
    for (const r of list) {
      const k = keyOf(r);
      if (seedKeys.has(k)) continue;
      if (r.vote_count < MIN_VOTES[r.media_type]) continue;
      if (genresOf(r.genre_ids, r.media_type).some((g) => avoided.has(g))) continue;
      const hit = hits.get(k);
      if (hit) hit.votes += 1;
      else hits.set(k, { ...r, votes: 1 });
    }
  }
  return [...hits.values()].sort(
    (a, b) => b.votes - a.votes || b.vote_average - a.vote_average,
  );
}

/** Discover filters the lane can check on a cached title row. */
const CHECKED = new Set([
  "with_genres",
  "without_genres",
  "with_runtime.lte",
  "vote_average.gte",
  "primary_release_date.gte",
  "primary_release_date.lte",
  "first_air_date.gte",
  "first_air_date.lte",
]);
/** Filters that need no check here: votes, and the age limit checked apart. */
const IGNORED = new Set([
  "vote_count.gte",
  "certification_country",
  "certification.lte",
]);

/**
 * Whether the lane can be used with these discover filters at all. A filter
 * it cannot check on a title row (such as the original language) means the
 * lane stays out, so it never shows what the mood ruled out.
 */
export function laneFits(filters: Record<string, string | number>): boolean {
  return Object.keys(filters).every((k) => CHECKED.has(k) || IGNORED.has(k));
}

const ids = (v: string | number | undefined) =>
  String(v ?? "")
    .split(/[,|]/)
    .filter(Boolean)
    .map(Number);

/** The same filters as discover, applied to a title from the lane. */
export function matchesFilters(
  row: Title,
  filters: Record<string, string | number>,
): boolean {
  const genres = new Set(row.genre_ids);
  const want = filters.with_genres;
  if (want !== undefined) {
    // In discover, "|" means any of the genres and "," all of them.
    const list = ids(want);
    const ok = String(want).includes(",")
      ? list.every((g) => genres.has(g))
      : list.some((g) => genres.has(g));
    if (!ok) return false;
  }
  if (ids(filters.without_genres).some((g) => genres.has(g))) return false;
  const maxRuntime = filters["with_runtime.lte"];
  if (maxRuntime !== undefined && row.runtime && row.runtime > Number(maxRuntime))
    return false;
  const minVote = filters["vote_average.gte"];
  if (minVote !== undefined && (row.vote_average ?? 0) < Number(minVote))
    return false;
  const date = row.media_type === "movie" ? "primary_release_date" : "first_air_date";
  const from = filters[`${date}.gte`];
  const to = filters[`${date}.lte`];
  if (from !== undefined && (row.year ?? 0) < Number(String(from).slice(0, 4)))
    return false;
  if (to !== undefined && (row.year ?? 9999) > Number(String(to).slice(0, 4)))
    return false;
  return true;
}
