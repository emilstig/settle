import "server-only";
import type { z } from "zod";

const BASE = "https://api.themoviedb.org/3";
export const REGION = "SE";
export const LANGUAGE = "sv-SE";

export class TmdbError extends Error {
  constructor(public status: number, path: string) {
    super(`TMDB ${status} on ${path}`);
  }
}

/** GET from TMDB v3 and validate the response. Server only: the token never reaches the client. */
export async function tmdbGet<T extends z.ZodType>(
  path: string,
  params: Record<string, string | number | undefined>,
  schema: T,
): Promise<z.infer<T>> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}`, accept: "application/json" },
  });
  if (!res.ok) throw new TmdbError(res.status, path);
  return schema.parse(await res.json());
}

export const imageUrl = (path: string | null | undefined, size: "w92" | "w185" | "w342" | "w500") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
