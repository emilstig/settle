import "server-only";
import { discover, getTitles, type MediaType, type Title } from "@/lib/tmdb/titles";

export type Candidate = Title & { onServices: { id: number; name: string; logo_path: string | null }[] };

/**
 * Movies and series on the user's services, newest TMDB data first.
 * Discover finds them; the cache confirms they are still on one of the
 * user's services in Sweden and adds runtime, rating and certification.
 */
export async function discoverForUser({
  providerIds,
  page = 1,
  mediaTypes = ["movie", "tv"],
}: {
  providerIds: number[];
  page?: number;
  mediaTypes?: MediaType[];
}): Promise<Candidate[]> {
  const pages = await Promise.all(mediaTypes.map((t) => discover(t, { providerIds, page })));
  // Alternate movie and series so neither crowds out the other; each keeps TMDB's order.
  const longest = Math.max(0, ...pages.map((p) => p.hits.length));
  const hits = Array.from({ length: longest }, (_, i) => pages.map((p) => p.hits[i]))
    .flat()
    .filter((h) => h !== undefined);

  const rows = await getTitles(hits);
  const mine = new Set(providerIds);

  return hits.flatMap((h) => {
    const row = rows.get(`${h.media_type}:${h.tmdb_id}`);
    if (!row) return [];
    const onServices = (row.providers_se?.flatrate ?? []).filter((p) => mine.has(p.id));
    return onServices.length > 0 ? [{ ...row, onServices }] : [];
  });
}
