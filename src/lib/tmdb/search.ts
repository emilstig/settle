import "server-only";
import { cacheLife } from "next/cache";
import { z } from "zod";
import { tmdbGet } from "./client";

/**
 * Names from prompt 1 (people, companies, keywords) as TMDB ids. Matched on
 * the exact name, case aside. Cached for weeks: ids do not change.
 */

const named = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      popularity: z.number().optional(),
    }),
  ),
});
const counted = z.object({ total_results: z.number() });

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The most popular person with that name, or the first hit. */
export async function findPerson(name: string): Promise<number | null> {
  "use cache";
  cacheLife("weeks");
  const { results } = await tmdbGet("/search/person", { query: name }, named);
  const exact = results.filter((r) => same(r.name, name));
  const pool = exact.length ? exact : results;
  return (
    [...pool].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0]
      ?.id ?? null
  );
}

/**
 * Companies share names (TMDB has several "A24"): the real studio is the one
 * with the most films.
 */
export async function findCompany(name: string): Promise<number | null> {
  "use cache";
  cacheLife("weeks");
  const { results } = await tmdbGet("/search/company", { query: name }, named);
  const exact = results.filter((r) => same(r.name, name)).slice(0, 5);
  const withCounts = await Promise.all(
    exact.map(async (r) => ({
      id: r.id,
      films: (
        await tmdbGet("/discover/movie", { with_companies: r.id }, counted)
      ).total_results,
    })),
  );
  return withCounts.sort((a, b) => b.films - a.films)[0]?.id ?? null;
}

/** A keyword with exactly that name (TMDB's keywords are in English). */
export async function findKeyword(name: string): Promise<number | null> {
  "use cache";
  cacheLife("weeks");
  const { results } = await tmdbGet("/search/keyword", { query: name }, named);
  return results.find((r) => same(r.name, name))?.id ?? null;
}

/** Ids for a list of names, leaving out names TMDB does not know. */
export async function findAll(
  find: (name: string) => Promise<number | null>,
  names: string[],
): Promise<number[]> {
  const ids = await Promise.all(
    names.slice(0, 5).map((n) => find(n).catch(() => null)),
  );
  return [...new Set(ids.filter((id): id is number => id !== null))];
}
