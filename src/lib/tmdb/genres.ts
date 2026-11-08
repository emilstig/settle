import "server-only";
import { cacheLife } from "next/cache";
import { z } from "zod";
import { LANGUAGE, tmdbGet } from "./client";

const genreList = z.object({
  genres: z.array(z.object({ id: z.number(), name: z.string() })),
});

/** Genres TMDB has no Swedish name for; they come back in English. */
const SWEDISH: Record<number, string> = {
  10402: "Musik",
  10759: "Action och äventyr",
  10762: "Barn",
  10763: "Nyheter",
  10765: "Sci-fi och fantasy",
  10766: "Såpa",
  10767: "Talkshow",
  10768: "Krig och politik",
  878: "Science fiction",
  10770: "Tv-film",
};

/** TMDB genre names in Swedish, movie and tv merged by id. */
export async function getGenreNames(): Promise<Record<number, string>> {
  "use cache";
  cacheLife("weeks");
  const [movie, tv] = await Promise.all([
    tmdbGet("/genre/movie/list", { language: LANGUAGE }, genreList),
    tmdbGet("/genre/tv/list", { language: LANGUAGE }, genreList),
  ]);
  const names: Record<number, string> = {};
  for (const g of [...tv.genres, ...movie.genres]) names[g.id] = SWEDISH[g.id] ?? g.name;
  return names;
}

/** Valid genre ids for /discover/movie and /discover/tv, which differ. */
export async function getGenreIds(): Promise<{
  movie: number[];
  tv: number[];
}> {
  "use cache";
  cacheLife("weeks");
  const [movie, tv] = await Promise.all([
    tmdbGet("/genre/movie/list", { language: LANGUAGE }, genreList),
    tmdbGet("/genre/tv/list", { language: LANGUAGE }, genreList),
  ]);
  return {
    movie: movie.genres.map((g) => g.id),
    tv: tv.genres.map((g) => g.id),
  };
}
