import "server-only";
import { cacheLife } from "next/cache";
import { z } from "zod";
import { tmdbGet } from "./client";
import type { MediaType } from "./titles";

const recommendationPage = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      media_type: z.string().optional(),
      genre_ids: z.array(z.number()).default([]),
      vote_average: z.number().default(0),
      vote_count: z.number().default(0),
    }),
  ),
});

export type Recommendation = {
  tmdb_id: number;
  media_type: MediaType;
  genre_ids: number[];
  vote_average: number;
  vote_count: number;
};

/**
 * TMDB's recommendations for a title: what people watch together with it.
 * Cached for about a week, like the providers. Failures give an empty list.
 */
export async function getRecommendations(
  mediaType: MediaType,
  id: number,
): Promise<Recommendation[]> {
  "use cache";
  cacheLife("weeks");
  try {
    const data = await tmdbGet(
      `/${mediaType}/${id}/recommendations`,
      { page: 1 },
      recommendationPage,
    );
    return data.results.flatMap((r) => {
      const type = r.media_type ?? mediaType;
      return type === "movie" || type === "tv"
        ? [
            {
              tmdb_id: r.id,
              media_type: type,
              genre_ids: r.genre_ids,
              vote_average: r.vote_average,
              vote_count: r.vote_count,
            },
          ]
        : [];
    });
  } catch (e) {
    console.warn(`TMDB recommendations failed for ${mediaType}:${id}`, e);
    return [];
  }
}
