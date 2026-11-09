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

  // TMDB has short spells of 502 and 503, and rate limits with 429. Try a
  // couple more times before giving up, so a blip does not end a session.
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}`, accept: "application/json" },
      });
    } catch (e) {
      if (attempt >= RETRIES) throw e;
    }
    if (res?.ok) return schema.parse(await res.json());
    if (res && !(res.status === 429 || res.status >= 500)) throw new TmdbError(res.status, path);
    if (attempt >= RETRIES) throw new TmdbError(res?.status ?? 0, path);
    await new Promise((r) => setTimeout(r, RETRY_MS * (attempt + 1)));
  }
}

const RETRIES = 2;
const RETRY_MS = 400;

export const imageUrl = (path: string | null | undefined, size: "w92" | "w185" | "w342" | "w500") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
