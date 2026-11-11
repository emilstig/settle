import "server-only";
import { z } from "zod";
import { tmdbGet } from "./client";
import type { MediaType } from "./titles";

const externalIds = z.object({
  imdb_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
});

export type ExternalLinks = {
  /** IMDb id (tt…), used only to link out to IMDb. */
  imdbId: string | null;
  /** Rotten Tomatoes path (m/… or tv/…), used only to link out to its reviews. */
  rtPath: string | null;
};

/** Ids for the plain links out in the detail view. No data from them is shown. */
export async function getExternalLinks(mediaType: MediaType, id: number): Promise<ExternalLinks> {
  const data = await tmdbGet(`/${mediaType}/${id}/external_ids`, {}, externalIds);
  const imdb = data.imdb_id?.trim();
  const wikidata = data.wikidata_id?.trim();
  return {
    imdbId: imdb && /^tt\d+$/.test(imdb) ? imdb : null,
    rtPath: wikidata && /^Q\d+$/.test(wikidata) ? await getRtPath(wikidata).catch(() => null) : null,
  };
}

const claims = z.object({
  claims: z
    .record(
      z.string(),
      z.array(
        z.object({
          rank: z.string().optional(),
          mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }),
        }),
      ),
    )
    .optional(),
});

/**
 * TMDB has no Rotten Tomatoes id, but Wikidata does (P1258, such as
 * "m/the_matrix" or "tv/breaking_bad"), and TMDB knows the Wikidata item.
 * Cached for a month, the ids rarely change.
 */
async function getRtPath(wikidataId: string): Promise<string | null> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({
    action: "wbgetclaims",
    entity: wikidataId,
    property: "P1258",
    format: "json",
  }).toString();
  const res = await fetch(url, {
    headers: { "User-Agent": "Settle/1.0", accept: "application/json" },
    signal: AbortSignal.timeout(3000),
    next: { revalidate: 60 * 60 * 24 * 30 },
  });
  if (!res.ok) return null;
  const list = claims.parse(await res.json()).claims?.P1258 ?? [];
  const best = [...list].sort((a, b) => Number(b.rank === "preferred") - Number(a.rank === "preferred"));
  for (const c of best) {
    if (c.rank === "deprecated") continue;
    const v = c.mainsnak.datavalue?.value;
    if (typeof v === "string" && /^(m|tv)\/[\w-]+(\/[\w-]+)?$/.test(v.trim())) return v.trim();
  }
  return null;
}
