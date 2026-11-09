import "server-only";
import { z } from "zod";
import { tmdbGet } from "./client";
import type { MediaType } from "./titles";

const externalIds = z.object({ imdb_id: z.string().nullable().optional() });

/** IMDb id (tt…) for a movie or series, used only to link out to IMDb. */
export async function getImdbId(mediaType: MediaType, id: number): Promise<string | null> {
  const data = await tmdbGet(`/${mediaType}/${id}/external_ids`, {}, externalIds);
  const imdb = data.imdb_id?.trim();
  return imdb && /^tt\d+$/.test(imdb) ? imdb : null;
}
