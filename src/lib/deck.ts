import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formatCertSE, formatRuntime } from "@/lib/format";
import { DEFAULT_YOUNGEST_AGE, type Group } from "@/lib/groups";
import { discover, getTitles, type DiscoverHit, type MediaType, type Title } from "@/lib/tmdb/titles";
import { getGenreNames } from "@/lib/tmdb/genres";

export const QUICK_PICKS = ["Lätt", "Spännande", "Kort", "Något tryggt", "Överraska mig"] as const;
export type QuickPick = (typeof QUICK_PICKS)[number];

/** Stored in sessions.filters. Rule-based until Claude parses the mood (step 5). */
export const deckFiltersSchema = z.object({
  mediaTypes: z.array(z.enum(["movie", "tv"])),
  movie: z.record(z.string(), z.union([z.string(), z.number()])),
  tv: z.record(z.string(), z.union([z.string(), z.number()])),
  sortBy: z.string(),
  firstPage: z.number().int().min(1),
  maxCert: z.number().int().nullable(),
});
export type DeckFilters = z.infer<typeof deckFiltersSchema>;

export type Card = {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  year: number | null;
  meta: string;
  overview: string | null;
  poster_path: string | null;
  vote_average: number | null;
  certification: string | null;
  services: string[];
  providers_link: string | null;
};

const G = {
  comedy: 35,
  thriller: 53,
  crime: 80,
  mystery: 9648,
  horror: 27,
  family: 10751,
  kids: 10762,
  animation: 16,
  actionAdventureTv: 10759,
};

/** Swedish rating ceiling for a child of the given age: Btl (0), 7, 11, 15. */
function maxCertForAge(age: number): number {
  if (age >= 15) return 15;
  if (age >= 11) return 11;
  if (age >= 7) return 7;
  return 0;
}
const CERT_LABEL: Record<number, string> = { 0: "Btl", 7: "7", 11: "11", 15: "15" };

export function buildFilters(group: Group, quickPicks: string[]): DeckFilters {
  const picks = new Set(quickPicks);
  const movie: Record<string, string | number> = { "vote_count.gte": 100 };
  const tv: Record<string, string | number> = { "vote_count.gte": 50 };
  let sortBy = "popularity.desc";
  let firstPage = 1;
  let maxCert: number | null = null;

  const movieGenres: number[] = [];
  const tvGenres: number[] = [];
  if (picks.has("Lätt")) {
    movieGenres.push(G.comedy);
    tvGenres.push(G.comedy);
  }
  if (picks.has("Spännande")) {
    movieGenres.push(G.thriller, G.crime, G.mystery);
    tvGenres.push(G.crime, G.mystery, G.actionAdventureTv);
  }
  if (picks.has("Kort")) {
    movie["with_runtime.lte"] = 100;
    tv["with_runtime.lte"] = 35;
  }
  if (picks.has("Något tryggt")) sortBy = "vote_count.desc";
  if (picks.has("Överraska mig")) firstPage = 1 + Math.floor(Math.random() * 5);

  if (group.kind === "family") {
    // Everyone watches together: Swedish age rating and nothing scary.
    maxCert = maxCertForAge(group.youngest_age ?? DEFAULT_YOUNGEST_AGE);
    movie.certification_country = "SE";
    movie["certification.lte"] = CERT_LABEL[maxCert];
    movie.without_genres = [G.horror, G.thriller].join(",");
    // TV has no certification filter in discover, so stick to family genres.
    tv.with_genres = [G.family, G.kids, G.animation].join("|");
    tv.without_genres = [G.crime, G.mystery].join(",");
    picks.delete("Spännande");
  }

  if (movieGenres.length) movie.with_genres = movieGenres.join("|");
  if (tvGenres.length && group.kind !== "family") tv.with_genres = tvGenres.join("|");

  return { mediaTypes: ["movie", "tv"], movie, tv, sortBy, firstPage, maxCert };
}

const key = (t: { tmdb_id: number; media_type: string }) => `${t.media_type}:${t.tmdb_id}`;

/**
 * Titles that must not be suggested now, per the domain rules: disliked,
 * dropped or already seen, "inte min grej", "inte nu" in the last 7 days,
 * and anything already on this group's list.
 */
async function getExcluded(userId: string, groupId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [ratings, seen, left, listed] = await Promise.all([
    supabase.from("ratings").select("tmdb_id, media_type").eq("user_id", userId).eq("rating", -1),
    supabase.from("watch_log").select("tmdb_id, media_type").eq("user_id", userId),
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, reason, created_at")
      .eq("user_id", userId)
      .eq("action", "left")
      .or(`reason.eq.not_for_me,created_at.gte.${weekAgo}`),
    supabase.from("watchlist").select("tmdb_id, media_type").eq("user_id", userId).eq("group_id", groupId),
  ]);
  for (const r of [ratings, seen, left, listed]) if (r.error) throw r.error;

  const out = new Set<string>();
  for (const r of [...ratings.data!, ...seen.data!, ...left.data!, ...listed.data!]) out.add(key(r));
  return out;
}

function certNumber(cert: string | null): number | null {
  if (!cert) return null;
  if (cert === "Btl") return 0;
  const n = Number(cert);
  return Number.isFinite(n) ? n : null;
}

function toCard(t: Title, mine: Set<number>, genres: Record<number, string>): Card {
  const length =
    t.media_type === "movie"
      ? formatRuntime(t.runtime)
      : t.runtime && t.runtime >= 5 // TMDB has some bogus 1-minute episode lengths
        ? `${t.runtime} min/avsnitt`
        : null;
  const genreNames = t.genre_ids.slice(0, 2).map((id) => genres[id]).filter(Boolean);
  return {
    tmdb_id: t.tmdb_id,
    media_type: t.media_type,
    title: t.title,
    year: t.year,
    meta: [t.media_type === "movie" ? "Film" : "Serie", length, genreNames.join(", ")]
      .filter(Boolean)
      .join(" · "),
    overview: t.overview,
    poster_path: t.poster_path,
    vote_average: t.vote_average,
    certification: formatCertSE(t.certification_se),
    services: (t.providers_se?.flatrate ?? []).filter((p) => mine.has(p.id)).map((p) => p.name),
    providers_link: t.providers_se?.link ?? null,
  };
}

/** One page of cards for a session: discover, refresh the cache, apply the rules. */
export async function loadDeckPage({
  userId,
  groupId,
  providerIds,
  filters,
  page,
  skip = [],
}: {
  userId: string;
  groupId: string;
  providerIds: number[];
  filters: DeckFilters;
  page: number;
  skip?: string[];
}): Promise<{ cards: Card[]; hasMore: boolean }> {
  const tmdbPage = filters.firstPage + page - 1;
  const results = await Promise.all(
    filters.mediaTypes.map((t) =>
      discover(t, { providerIds, page: tmdbPage, sortBy: filters.sortBy, filters: filters[t] }),
    ),
  );
  const longest = Math.max(0, ...results.map((r) => r.hits.length));
  const hits: DiscoverHit[] = Array.from({ length: longest }, (_, i) => results.map((r) => r.hits[i]))
    .flat()
    .filter((h) => h !== undefined);

  const [excluded, rows, genres] = await Promise.all([
    getExcluded(userId, groupId),
    getTitles(hits),
    getGenreNames(),
  ]);
  const skipSet = new Set(skip);
  const mine = new Set(providerIds);

  const cards = hits.flatMap((h) => {
    const k = key(h);
    const row = rows.get(k);
    if (!row || excluded.has(k) || skipSet.has(k)) return [];
    if (!(row.providers_se?.flatrate ?? []).some((p) => mine.has(p.id))) return [];
    if (filters.maxCert !== null) {
      const cert = certNumber(row.certification_se);
      if (cert !== null && cert > filters.maxCert) return [];
    }
    return [toCard(row, mine, genres)];
  });

  return { cards, hasMore: results.some((r) => tmdbPage < r.totalPages) };
}
