import "server-only";
import { runCost, type RunCost } from "./cost";
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
  /** A short heading for the deck, shown under the header. */
  label: z.string(),
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
    let cost: RunCost | null = null;
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
      cost = runCost(response.model, response.usage);
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
      ...cost,
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
      label: parsed.label.trim(),
    },
  };
  let types =
    parsed.media_type === "any" ? base.mediaTypes : [parsed.media_type];
  // Discover has people for films only.
  if (people.length) types = types.filter((t) => t === "movie");

  if (parsed.comfort) out.sortBy = "vote_count.desc";
  else if (parsed.sort === "votes") out.sortBy = "vote_count.desc";
  else if (parsed.sort === "rating") out.sortBy = "vote_average.desc";

  // Types where the mood's genres are all ruled out by the group's own
  // limits, such as crime series with Familj.
  const unfit = new Set<"movie" | "tv">();
  for (const type of ["movie", "tv"] as const) {
    const f = out[type];
    const familyTv = group.kind === "family" && type === "tv";
    // The group's exclusions always win; prompt 1's own only over its
    // wishes, so a genre both wanted and left out is left out.
    const groupWithout = String(base[type].without_genres ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number);
    const without = uniq([
      ...groupWithout,
      ...forType(parsed.without_genres, type),
    ]);
    const allowed = (ids: number[]) => ids.filter((g) => !without.includes(g));
    const askedRequired = forType(parsed.required_genres, type);
    const asked = forType(parsed.with_genres, type);
    const required = allowed(askedRequired);
    const genres = allowed(asked);
    if (familyTv) {
      // Series for Familj stay within its own genres, which stand in for an
      // age limit. They have their share of comedy, adventure and fantasy,
      // but a mood for westerns or murder mysteries is met by the films
      // instead, or, asked as series only, said not to fit.
      const wish = [...askedRequired, ...asked];
      if (wish.length && !wish.some((g) => FAMILY_TV_FITS.has(g))) unfit.add(type);
    } else if (required.length) {
      // Comma means and: every required genre.
      f.with_genres = required.join(",");
    } else if (askedRequired.length || asked.length) {
      if (genres.length) f.with_genres = genres.join("|");
      // Everything asked for is ruled out by the group.
      else if ([...askedRequired, ...asked].some((g) => groupWithout.includes(g)))
        unfit.add(type);
      // Nothing in this genre for series (or films): leave that type out.
      else types = types.filter((t) => t !== type);
    } else if (parsed.with_genres.length || parsed.required_genres.length) {
      types = types.filter((t) => t !== type);
    }
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

  // A type that cannot meet the mood within the group's limits gives way to
  // one that can. With none left, the deck keeps to the group's limits and
  // says that the mood does not fit.
  const fitting = types.filter((t) => !unfit.has(t));
  if (fitting.length) types = fitting;
  else if (types.length) out.parsed = { ...out.parsed!, unfit: true };
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

/** Familj's own series genres (see buildFilters): they never fall away. */
const FAMILY_TV_GENRES = "10751|10762|16";
/**
 * Series genres a mood can ask for that Familj's series meet: its own, and
 * comedy, Action & Adventure and Sci-Fi & Fantasy, which children's series
 * are full of.
 */
const FAMILY_TV_FITS = new Set([10751, 10762, 16, 35, 10759, 10765]);

/**
 * Loosens prompt 1's filters when they leave too few titles, in the order the
 * user is least likely to miss: first a lower rating bar, fewer votes and no
 * keywords; then no genres; last no people or companies, since a named studio
 * or actor ("Disneyklassiker") is the clearest thing asked for after the
 * language and country, which always stay. Familj keeps its age limit and
 * its genres for series, which stand in for an age limit there.
 */
export function relax(filters: DeckFilters, level: 1 | 2 | 3): DeckFilters {
  const out: DeckFilters = {
    ...filters,
    movie: { ...filters.movie },
    tv: { ...filters.tv },
    relaxed: level,
  };
  const family = filters.maxCert !== null;
  for (const type of ["movie", "tv"] as const) {
    const f = out[type];
    if (f["vote_average.gte"] !== undefined) {
      f["vote_average.gte"] = Math.min(Number(f["vote_average.gte"]), 7);
    }
    if (f["vote_average.gte"] !== undefined || filters.sortBy === "vote_average.desc") {
      // Sorted by rating, some floor of votes stays, or the top fills up
      // with new titles that have a handful of votes; the full floor left
      // too few westerns with a high rating.
      f["vote_count.gte"] =
        filters.sortBy === "vote_average.desc"
          ? RELAXED_RATING_SORT_VOTES[type]
          : type === "movie"
            ? 50
            : 20;
    }
    delete f.with_keywords;
    if (level >= 2) {
      if (family && type === "tv") f.with_genres = FAMILY_TV_GENRES;
      else delete f.with_genres;
    }
    if (level >= 3) {
      delete f.with_people;
      delete f.with_companies;
    }
  }
  return out;
}

/**
 * Whether "Visa bredare förslag" would change anything: a mood that did not
 * fit the group, or filters with more to let go.
 */
export function canWiden(filters: DeckFilters): boolean {
  if (filters.parsed?.unfit) return true;
  if ((filters.relaxed ?? 0) >= 3) return false;
  const wider = relax(filters, 3);
  return (["movie", "tv"] as const).some(
    (t) =>
      filters.mediaTypes.includes(t) &&
      JSON.stringify(wider[t]) !== JSON.stringify(filters[t]),
  );
}

/** The floor of votes for rating sort once the filters are loosened. */
const RELAXED_RATING_SORT_VOTES = { movie: 300, tv: 100 };
