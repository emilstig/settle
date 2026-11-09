import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { DeckFilters } from "@/lib/deck";
import type { Group } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";
import { getGenreIds, getGenreNames } from "@/lib/tmdb/genres";
import {
  findAll,
  findCompany,
  findKeyword,
  findPerson,
} from "@/lib/tmdb/search";
import { PARSE_PROMPT } from "./prompts";

/** Prompt 1 runs on Haiku, per the project doc. */
export const PARSE_MODEL = "claude-haiku-5-5";

const parseSchema = z.strictObject({
  media_type: z.enum(["movie", "tv", "any"]),
  with_genres: z.array(z.number()),
  required_genres: z.array(z.number()),
  without_genres: z.array(z.number()),
  origin_countries: z.array(z.string()),
  languages: z.array(z.string()),
  people: z.array(z.string()),
  companies: z.array(z.string()),
  keywords: z.array(z.string()),
  without_keywords: z.array(z.string()),
  max_runtime: z.number().nullable(),
  min_vote: z.number().nullable(),
  era: z.strictObject({
    from: z.number().nullable(),
    to: z.number().nullable(),
  }),
  sort: z.enum(["popularity", "votes", "rating", "newest"]),
  tv_ended: z.boolean(),
  tv_miniseries: z.boolean(),
  comfort: z.boolean(),
  novelty: z.enum(["low", "medium", "high"]),
  vibe: z.string(),
});
export type ParsedMood = z.infer<typeof parseSchema>;

/** Film genres as series genres, and series genres as film genres. */
const FILM_TO_TV: Record<number, number[]> = {
  878: [10765], // Science Fiction → Sci-Fi & Fantasy
  14: [10765], // Fantasy → Sci-Fi & Fantasy
  28: [10759], // Action → Action & Adventure
  12: [10759], // Äventyr → Action & Adventure
  10752: [10768], // Krig → War & Politics
  53: [80, 9648], // Thriller → Kriminal, Mysterium
  27: [9648], // Skräck → Mysterium
};
const TV_TO_FILM: Record<number, number[]> = {
  10765: [878, 14],
  10759: [28, 12],
  10768: [10752],
  10762: [10751],
};

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

/**
 * Prompt 1: the free text and quick picks become TMDB filters. Strict JSON
 * validated with zod, one retry, then null so the rule-based filters stay.
 * Every attempt is logged in suggest_runs.
 */
export async function parseMood(input: {
  sessionId: string;
  userId: string;
  group: Group;
  moodText: string;
  quickPicks: string[];
}): Promise<ParsedMood | null> {
  const names = await getGenreNames();
  const group = {
    kind: input.group.kind,
    ...(input.group.kind === "family"
      ? { youngest_age: input.group.youngest_age ?? 7 }
      : {}),
  };
  const vars: Record<string, string> = {
    GENRES: Object.entries(names)
      .map(([id, name]) => `${id}: ${name}`)
      .join("\n"),
    GROUP: JSON.stringify(group),
    QUICK_PICKS: input.quickPicks.join(", ") || "Inga",
    MOOD_TEXT: input.moodText.trim() || "Ingen",
  };
  const prompt = PARSE_PROMPT.replace(
    /\{\{(\w+)\}\}/g,
    (m, k: string) => vars[k] ?? m,
  );
  const known = new Set(Object.keys(names).map(Number));
  const supabase = await createClient();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    let output: object;
    let result: ParsedMood | null = null;
    try {
      const response = await anthropic().messages.create({
        model: PARSE_MODEL,
        max_tokens: 4000,
        // A plain translation: no thinking needed, and it keeps the wait short.
        thinking: { type: "disabled" },
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: z.toJSONSchema(parseSchema) as Record<string, unknown>,
          },
        },
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("");
      const parsed =
        response.stop_reason === "end_turn"
          ? parseSchema.safeParse(JSON.parse(text))
          : null;
      if (parsed?.success) {
        // Keep only what TMDB understands: known genres, two-letter
        // languages and countries.
        const genres = (ids: number[]) => ids.filter((g) => known.has(g));
        result = {
          ...parsed.data,
          with_genres: genres(parsed.data.with_genres),
          required_genres: genres(parsed.data.required_genres),
          without_genres: genres(parsed.data.without_genres),
          languages: parsed.data.languages
            .map((l) => l.toLowerCase())
            .filter((l) => /^[a-z]{2}$/.test(l)),
          origin_countries: parsed.data.origin_countries
            .map((c) => c.toUpperCase())
            .filter((c) => /^[A-Z]{2}$/.test(c)),
        };
        output = { attempt, ...result };
      } else {
        output = {
          attempt,
          error:
            response.stop_reason === "end_turn"
              ? "invalid"
              : response.stop_reason,
          raw: text,
        };
      }
    } catch (e) {
      console.error("prompt 1 failed", e);
      output = { attempt, error: e instanceof Error ? e.message : String(e) };
    }
    const { error } = await supabase.from("suggest_runs").insert({
      session_id: input.sessionId,
      user_id: input.userId,
      prompt: "parse",
      input: { prompt },
      output,
      model: PARSE_MODEL,
      latency_ms: Date.now() - started,
    });
    if (error) console.error("suggest_runs insert failed", error);
    if (result) return result;
  }
  return null;
}

const uniq = (ids: number[]) => [...new Set(ids)];

/** Rating sort needs a real floor of votes, or new titles with a handful of 9s lead. */
const RATING_SORT_VOTES = { movie: 1000, tv: 300 };
/** TMDB's series status and type for "avslutad" and "miniserie". */
const TV_ENDED = "3";
const TV_MINISERIES = "2";

/**
 * Lays prompt 1's reading over the rule-based filters. The group's own limits
 * (age limit and family genres for Familj) always stay. Names of people,
 * companies and keywords are looked up in TMDB; unknown names fall away.
 */
export async function applyParsed(
  base: DeckFilters,
  parsed: ParsedMood,
  group: Group,
): Promise<DeckFilters> {
  const [valid, people, companies, keywords, withoutKeywords] =
    await Promise.all([
      getGenreIds(),
      findAll(findPerson, parsed.people),
      findAll(findCompany, parsed.companies),
      findAll(findKeyword, parsed.keywords),
      findAll(findKeyword, parsed.without_keywords),
    ]);
  const ok = { movie: new Set(valid.movie), tv: new Set(valid.tv) };
  const forType = (ids: number[], type: "movie" | "tv") =>
    uniq(
      ids.flatMap((g) =>
        ok[type].has(g)
          ? [g]
          : ((type === "tv" ? FILM_TO_TV[g] : TV_TO_FILM[g]) ?? []),
      ),
    ).filter((g) => ok[type].has(g));

  const out: DeckFilters = {
    ...base,
    movie: { ...base.movie },
    tv: { ...base.tv },
    parsed: {
      comfort: parsed.comfort,
      novelty: parsed.novelty,
      vibe: parsed.vibe,
    },
  };
  let types =
    parsed.media_type === "any" ? base.mediaTypes : [parsed.media_type];
  // Discover has people for films only.
  if (people.length) types = types.filter((t) => t === "movie");

  if (parsed.comfort) out.sortBy = "vote_count.desc";
  else if (parsed.sort === "votes") out.sortBy = "vote_count.desc";
  else if (parsed.sort === "rating") out.sortBy = "vote_average.desc";

  for (const type of ["movie", "tv"] as const) {
    const f = out[type];
    const familyTv = group.kind === "family" && type === "tv";
    const required = forType(parsed.required_genres, type);
    if (required.length && !familyTv) {
      // Comma means and: every required genre.
      f.with_genres = required.join(",");
    } else if (parsed.with_genres.length && !familyTv) {
      const genres = forType(parsed.with_genres, type);
      // Nothing in this genre for series (or films): leave that type out.
      if (genres.length === 0) types = types.filter((t) => t !== type);
      else f.with_genres = genres.join("|");
    }
    const without = uniq([
      ...String(f.without_genres ?? "")
        .split(",")
        .filter(Boolean)
        .map(Number),
      ...forType(parsed.without_genres, type),
    ]);
    if (without.length) f.without_genres = without.join(",");
    if (parsed.languages.length)
      f.with_original_language = parsed.languages.join("|");
    if (parsed.origin_countries.length)
      f.with_origin_country = parsed.origin_countries.join("|");
    if (type === "movie" && people.length) f.with_people = people.join("|");
    if (companies.length) f.with_companies = companies.join("|");
    if (keywords.length) f.with_keywords = keywords.join("|");
    if (withoutKeywords.length) f.without_keywords = withoutKeywords.join(",");
    if (parsed.max_runtime && (type === "movie" || parsed.max_runtime <= 60)) {
      const current = Number(f["with_runtime.lte"] ?? Infinity);
      f["with_runtime.lte"] = Math.min(current, Math.round(parsed.max_runtime));
    }
    if (parsed.min_vote) {
      f["vote_average.gte"] = parsed.min_vote;
      f["vote_count.gte"] = Math.max(
        Number(f["vote_count.gte"] ?? 0),
        type === "movie" ? 200 : 100,
      );
    }
    if (out.sortBy === "vote_average.desc")
      f["vote_count.gte"] = Math.max(
        Number(f["vote_count.gte"] ?? 0),
        RATING_SORT_VOTES[type],
      );
    const date = type === "movie" ? "primary_release_date" : "first_air_date";
    if (parsed.era.from) f[`${date}.gte`] = `${parsed.era.from}-01-01`;
    if (parsed.era.to) f[`${date}.lte`] = `${parsed.era.to}-12-31`;
    if (type === "tv" && parsed.tv_ended) f.with_status = TV_ENDED;
    if (type === "tv" && parsed.tv_miniseries) f.with_type = TV_MINISERIES;
  }

  out.mediaTypes = types.length ? types : base.mediaTypes;
  // "Senaste": newest first, per type (the sort key differs).
  if (parsed.sort === "newest" && !parsed.comfort) {
    out.sortBy =
      out.mediaTypes.length === 1 && out.mediaTypes[0] === "tv"
        ? "first_air_date.desc"
        : "primary_release_date.desc";
  }
  return out;
}

/**
 * Loosens prompt 1's filters when they leave too few titles: first a lower
 * rating bar and fewer votes and no people, companies or keywords, then no
 * genres. The language and country stay, since they are usually the clearest
 * thing the user asked for.
 */
export function relax(filters: DeckFilters, level: 1 | 2): DeckFilters {
  const out: DeckFilters = {
    ...filters,
    movie: { ...filters.movie },
    tv: { ...filters.tv },
  };
  for (const type of ["movie", "tv"] as const) {
    const f = out[type];
    if (f["vote_average.gte"] !== undefined) {
      f["vote_average.gte"] = Math.min(Number(f["vote_average.gte"]), 7);
      // Sorted by rating, the floor of votes stays, or the top fills up
      // with new titles that have a handful of votes.
      f["vote_count.gte"] =
        filters.sortBy === "vote_average.desc"
          ? RATING_SORT_VOTES[type]
          : type === "movie"
            ? 50
            : 20;
    }
    delete f.with_people;
    delete f.with_companies;
    delete f.with_keywords;
    if (level === 2) delete f.with_genres;
  }
  return out;
}
