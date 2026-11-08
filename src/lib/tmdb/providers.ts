import "server-only";
import { cacheLife } from "next/cache";
import { z } from "zod";
import { LANGUAGE, REGION, tmdbGet } from "./client";

export type Provider = { id: number; name: string; logoPath: string | null; priority: number };

const providerList = z.object({
  results: z.array(
    z.object({
      provider_id: z.number(),
      provider_name: z.string(),
      logo_path: z.string().nullable(),
      display_priorities: z.record(z.string(), z.number()).optional(),
    }),
  ),
});

/** Every streaming service TMDB knows in Sweden, movies and tv merged, in TMDB's display order. */
export async function getSwedishProviders(): Promise<Provider[]> {
  "use cache";
  cacheLife("days");

  const params = { watch_region: REGION, language: LANGUAGE };
  const [movie, tv] = await Promise.all([
    tmdbGet("/watch/providers/movie", params, providerList),
    tmdbGet("/watch/providers/tv", params, providerList),
  ]);

  const byId = new Map<number, Provider>();
  for (const p of [...movie.results, ...tv.results]) {
    if (byId.has(p.provider_id)) continue;
    byId.set(p.provider_id, {
      id: p.provider_id,
      name: p.provider_name,
      logoPath: p.logo_path,
      priority: p.display_priorities?.[REGION] ?? 999,
    });
  }
  return [...byId.values()].sort((a, b) => a.priority - b.priority);
}
