import "server-only";
import { z } from "zod";
import { LANGUAGE, tmdbGet } from "./client";
import type { MediaType } from "./titles";

const videos = z.object({
  results: z.array(
    z.object({
      key: z.string(),
      site: z.string(),
      type: z.string(),
      official: z.boolean().optional(),
      iso_639_1: z.string().nullable().optional(),
    }),
  ),
});

/** YouTube key for the best trailer: Swedish first, then English, official before fan uploads. */
export async function getTrailerKey(mediaType: MediaType, id: number): Promise<string | null> {
  const data = await tmdbGet(
    `/${mediaType}/${id}/videos`,
    { language: LANGUAGE, include_video_language: "sv,en,null" },
    videos,
  );
  const yt = data.results.filter((v) => v.site === "YouTube");
  const score = (v: (typeof yt)[number]) =>
    (v.type === "Trailer" ? 4 : v.type === "Teaser" ? 2 : 0) +
    (v.official ? 1 : 0) +
    (v.iso_639_1 === "sv" ? 2 : 0);
  return yt.sort((a, b) => score(b) - score(a))[0]?.key ?? null;
}
