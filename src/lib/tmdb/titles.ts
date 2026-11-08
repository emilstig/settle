import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { LANGUAGE, REGION, tmdbGet } from "./client";

export type MediaType = "movie" | "tv";

export type StreamProvider = { id: number; name: string; logo_path: string | null };
export type ProvidersSE = { link: string | null; flatrate: StreamProvider[] };

/** A row in the shared `titles` cache. */
export type Title = {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  original_title: string | null;
  year: number | null;
  runtime: number | null;
  genre_ids: number[];
  overview: string | null;
  poster_path: string | null;
  vote_average: number | null;
  certification_se: string | null;
  providers_se: ProvidersSE | null;
  /** TMDB collection for films in a series, such as all Harry Potter films. */
  collection_id: number | null;
  providers_updated_at: string | null;
  updated_at: string;
};

/** Titles are cached up to 6 months; streaming availability changes faster. */
const TITLE_MAX_AGE_MS = 180 * 24 * 3600 * 1000;
const PROVIDERS_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const DETAIL_CONCURRENCY = 8;

/**
 * Swedish age ratings come as "Btl", "7", "Från 15 år" and so on. Stored as
 * "Btl" (barntillåten) or the age as digits, so they can be compared later.
 */
export function normalizeCertSE(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/btl|barntill/i.test(raw)) return "Btl";
  return raw.match(/\d{1,2}/)?.[0] ?? null;
}

const yearOf = (date: string | null | undefined) =>
  date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;

const providerEntry = z.object({
  provider_id: z.number(),
  provider_name: z.string(),
  logo_path: z.string().nullable().optional(),
});

const watchProviders = z
  .object({
    results: z.record(
      z.string(),
      z.object({ link: z.string().optional(), flatrate: z.array(providerEntry).optional() }),
    ),
  })
  .optional();

const toProvidersSE = (wp: z.infer<typeof watchProviders>): ProvidersSE => {
  const se = wp?.results?.[REGION];
  return {
    link: se?.link ?? null,
    flatrate: (se?.flatrate ?? []).map((p) => ({
      id: p.provider_id,
      name: p.provider_name,
      logo_path: p.logo_path ?? null,
    })),
  };
};

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------

const discoverResult = z.object({
  id: z.number(),
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  genre_ids: z.array(z.number()).default([]),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  vote_average: z.number().nullable().optional(),
  popularity: z.number().default(0),
});

const discoverPage = z.object({
  page: z.number(),
  total_pages: z.number(),
  results: z.array(discoverResult),
});

export type DiscoverHit = { tmdb_id: number; media_type: MediaType; popularity: number };

export type DiscoverParams = {
  providerIds: number[];
  page?: number;
  sortBy?: string;
  /** Extra TMDB discover filters, passed through as-is (genres, runtime, votes …). */
  filters?: Record<string, string | number | undefined>;
};

/** One page of TMDB discover, restricted to the given services on flatrate in Sweden. */
export async function discover(
  mediaType: MediaType,
  { providerIds, page = 1, sortBy = "popularity.desc", filters = {} }: DiscoverParams,
): Promise<{ hits: DiscoverHit[]; totalPages: number }> {
  if (providerIds.length === 0) return { hits: [], totalPages: 0 };

  const data = await tmdbGet(
    `/discover/${mediaType}`,
    {
      watch_region: REGION,
      with_watch_providers: providerIds.join("|"),
      with_watch_monetization_types: "flatrate",
      language: LANGUAGE,
      sort_by: sortBy,
      include_adult: "false",
      page,
      ...filters,
    },
    discoverPage,
  );

  return {
    hits: data.results.map((r) => ({ tmdb_id: r.id, media_type: mediaType, popularity: r.popularity })),
    totalPages: data.total_pages,
  };
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

const movieDetails = z.object({
  id: z.number(),
  title: z.string(),
  original_title: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
  runtime: z.number().nullable().optional(),
  genres: z.array(z.object({ id: z.number() })).default([]),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  vote_average: z.number().nullable().optional(),
  belongs_to_collection: z.object({ id: z.number() }).nullable().optional(),
  release_dates: z
    .object({
      results: z.array(
        z.object({
          iso_3166_1: z.string(),
          release_dates: z.array(z.object({ certification: z.string().optional() })),
        }),
      ),
    })
    .optional(),
  "watch/providers": watchProviders,
});

const tvDetails = z.object({
  id: z.number(),
  name: z.string(),
  original_name: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
  episode_run_time: z.array(z.number()).default([]),
  last_episode_to_air: z.object({ runtime: z.number().nullable().optional() }).nullable().optional(),
  genres: z.array(z.object({ id: z.number() })).default([]),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  vote_average: z.number().nullable().optional(),
  content_ratings: z
    .object({ results: z.array(z.object({ iso_3166_1: z.string(), rating: z.string() })) })
    .optional(),
  "watch/providers": watchProviders,
});

type TitleWrite = Omit<Title, "updated_at" | "providers_updated_at">;

async function fetchDetails(mediaType: MediaType, id: number): Promise<TitleWrite> {
  if (mediaType === "movie") {
    const d = await tmdbGet(
      `/movie/${id}`,
      { language: LANGUAGE, append_to_response: "watch/providers,release_dates" },
      movieDetails,
    );
    const cert = d.release_dates?.results
      .find((r) => r.iso_3166_1 === REGION)
      ?.release_dates.map((r) => r.certification?.trim())
      .find(Boolean);
    return {
      tmdb_id: d.id,
      media_type: "movie",
      title: d.title,
      original_title: d.original_title ?? null,
      year: yearOf(d.release_date),
      runtime: d.runtime || null,
      genre_ids: d.genres.map((g) => g.id),
      overview: d.overview || null,
      poster_path: d.poster_path ?? null,
      vote_average: d.vote_average ?? null,
      certification_se: normalizeCertSE(cert),
      providers_se: toProvidersSE(d["watch/providers"]),
      collection_id: d.belongs_to_collection?.id ?? null,
    };
  }

  const d = await tmdbGet(
    `/tv/${id}`,
    { language: LANGUAGE, append_to_response: "watch/providers,content_ratings" },
    tvDetails,
  );
  return {
    tmdb_id: d.id,
    media_type: "tv",
    title: d.name,
    original_title: d.original_name ?? null,
    year: yearOf(d.first_air_date),
    runtime: d.episode_run_time[0] ?? d.last_episode_to_air?.runtime ?? null,
    genre_ids: d.genres.map((g) => g.id),
    overview: d.overview || null,
    poster_path: d.poster_path ?? null,
    vote_average: d.vote_average ?? null,
    certification_se: normalizeCertSE(
      d.content_ratings?.results.find((r) => r.iso_3166_1 === REGION)?.rating,
    ),
    providers_se: toProvidersSE(d["watch/providers"]),
    collection_id: null,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]).then(
          (value) => ({ status: "fulfilled", value }) as const,
          (reason) => ({ status: "rejected", reason }) as const,
        );
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const key = (t: { tmdb_id: number; media_type: MediaType }) => `${t.media_type}:${t.tmdb_id}`;

function isStale(row: Title | undefined, now: number) {
  if (!row) return true;
  if (now - Date.parse(row.updated_at) > TITLE_MAX_AGE_MS) return true;
  if (!row.providers_updated_at) return true;
  return now - Date.parse(row.providers_updated_at) > PROVIDERS_MAX_AGE_MS;
}

/**
 * Returns cached rows for the given titles, fetching details from TMDB for any
 * that are missing, older than 6 months, or whose providers are older than a week.
 * Titles TMDB fails on are left out.
 */
export async function getTitles(
  refs: { tmdb_id: number; media_type: MediaType }[],
): Promise<Map<string, Title>> {
  const admin = createAdminClient();
  const rows = new Map<string, Title>();

  for (const mediaType of ["movie", "tv"] as const) {
    const ids = refs.filter((r) => r.media_type === mediaType).map((r) => r.tmdb_id);
    if (ids.length === 0) continue;
    const { data, error } = await admin
      .from("titles")
      .select("*")
      .eq("media_type", mediaType)
      .in("tmdb_id", ids);
    if (error) throw error;
    for (const row of data as Title[]) rows.set(key(row), row);
  }

  const now = Date.now();
  const stale = refs.filter((r) => isStale(rows.get(key(r)), now));
  if (stale.length > 0) {
    const fetched = await mapLimit(stale, DETAIL_CONCURRENCY, (r) => fetchDetails(r.media_type, r.tmdb_id));
    const stamp = new Date(now).toISOString();
    const fresh = fetched
      .filter((r): r is PromiseFulfilledResult<TitleWrite> => r.status === "fulfilled")
      .map((r) => ({ ...r.value, updated_at: stamp, providers_updated_at: stamp }));

    if (fresh.length > 0) {
      const { error } = await admin.from("titles").upsert(fresh, { onConflict: "tmdb_id,media_type" });
      if (error) throw error;
      for (const row of fresh) rows.set(key(row), row);
    }

    const failed = fetched.filter((r) => r.status === "rejected").length;
    if (failed > 0) console.warn(`TMDB details failed for ${failed} of ${stale.length} titles`);
  }

  return rows;
}
