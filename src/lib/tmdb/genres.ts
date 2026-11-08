import "server-only";
import { cacheLife } from "next/cache";
import { z } from "zod";
import { LANGUAGE, tmdbGet } from "./client";

const genreList = z.object({ genres: z.array(z.object({ id: z.number(), name: z.string() })) });

/** TMDB genre names in Swedish, movie and tv merged by id. */
export async function getGenreNames(): Promise<Record<number, string>> {
  "use cache";
  cacheLife("weeks");
  const [movie, tv] = await Promise.all([
    tmdbGet("/genre/movie/list", { language: LANGUAGE }, genreList),
    tmdbGet("/genre/tv/list", { language: LANGUAGE }, genreList),
  ]);
  const names: Record<number, string> = {};
  for (const g of [...tv.genres, ...movie.genres]) names[g.id] = g.name;
  return names;
}
