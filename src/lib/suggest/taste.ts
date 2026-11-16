import "server-only";
import { runCost, type RunCost } from "./cost";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { fitsAge, key, toCard, type Card, type DeckFilters } from "@/lib/deck";
import type { Group } from "@/lib/groups";
import { genresOf } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { getGenreIds, getGenreNames } from "@/lib/tmdb/genres";
import { findAll, findKeyword, findPerson } from "@/lib/tmdb/search";
import {
  discover,
  getTitles,
  streamingProviders,
  type DiscoverHit,
} from "@/lib/tmdb/titles";
import { TASTE_PROMPT } from "./prompts";

/**
 * The taste lane. The other lanes start from a list of TMDB's (popular, well
 * rated, recommended) that the profile can only reorder. Here the fetch
 * itself starts from the profile: Haiku turns it into a few discover
 * searches for what genres alone do not say (a theme, a tone, a director, a
 * country), and their titles take turns with the rest of the deck under
 * the source "taste". Only without a mood, outside Familj, and once there
 * are ratings enough to read a taste from.
 */
export const TASTE_MODEL = "claude-haiku-5-5";
/** Ratings needed before the profile says enough to search from. */
export const TASTE_MIN_RATINGS = 10;
/** Cards from the lane per page of the deck, and discover pages read per search. */
const TASTE_PER_PAGE = 12;
const TASTE_PAGES = [1, 2];
/** A genre weight that counts as clearly turned down (as in withTaste). */
const AVOIDED = -0.5;
/** Known enough to trust the rating, and liked. */
const TASTE_FLOOR = {
  movie: { "vote_count.gte": 200, "vote_average.gte": 6.5 },
  tv: { "vote_count.gte": 100, "vote_average.gte": 7 },
} as const;

const tasteSchema = z.strictObject({
  searches: z
    .array(
      z.strictObject({
        label: z.string(),
        media_type: z.enum(["movie", "tv"]),
        genres: z.array(z.number()),
        keywords: z.array(z.string()),
        people: z.array(z.string()),
        origin_countries: z.array(z.string()),
        languages: z.array(z.string()),
        era: z.strictObject({
          from: z.number().nullable(),
          to: z.number().nullable(),
        }),
      }),
    ),
});
/** Searches used from an answer, should it give more than asked for. */
const MAX_SEARCHES = 6;
export type TasteSearch = z.infer<typeof tasteSchema>["searches"][number];
export type TasteLane = NonNullable<DeckFilters["lane"]>;

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

/**
 * Asks for the searches. One attempt: the lane is an extra, so a failure
 * just leaves it out. Logged in suggest_runs as "taste".
 */
export async function askTasteSearches(input: {
  sessionId: string;
  userId: string;
  group: Group;
  profileText: string;
}): Promise<TasteSearch[]> {
  const names = await getGenreNames();
  const vars: Record<string, string> = {
    GENRES: Object.entries(names)
      .map(([id, name]) => `${id}: ${name}`)
      .join("\n"),
    PROFILE: input.profileText,
    GROUP: JSON.stringify({ kind: input.group.kind }),
  };
  const prompt = TASTE_PROMPT.replace(
    /\{\{(\w+)\}\}/g,
    (m, k: string) => vars[k] ?? m,
  );
  const started = Date.now();
  let output: object;
  let cost: RunCost | null = null;
  let searches: TasteSearch[] = [];
  try {
    const response = await anthropic().messages.create({
      model: TASTE_MODEL,
      max_tokens: 4000,
      thinking: { type: "disabled" },
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: z.toJSONSchema(tasteSchema) as Record<string, unknown>,
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
        ? tasteSchema.safeParse(JSON.parse(text))
        : null;
    if (parsed?.success) {
      searches = parsed.data.searches.slice(0, MAX_SEARCHES);
      output = { searches };
    } else {
      output = {
        error:
          response.stop_reason === "end_turn" ? "invalid" : response.stop_reason,
        raw: text,
      };
    }
  } catch (e) {
    console.error("taste lane failed", e);
    output = { error: e instanceof Error ? e.message : String(e) };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("suggest_runs").insert({
    session_id: input.sessionId,
    user_id: input.userId,
    prompt: "taste",
    input: { prompt },
    output,
    model: TASTE_MODEL,
    latency_ms: Date.now() - started,
    ...cost,
  });
  if (error) console.error("suggest_runs insert failed", error);
  return searches;
}

/**
 * The searches as discover filters, within the group's own limits. Names
 * are looked up in TMDB; a search left with nothing but the floor (every
 * name unknown, no genre) is dropped, since it would be the top list again.
 */
export async function tasteLane(
  searches: TasteSearch[],
  base: DeckFilters,
  /** Genre weights from the taste profile: clearly disliked genres stay out. */
  affinity: Record<number, number> = {},
): Promise<TasteLane> {
  const valid = await getGenreIds();
  const avoided = Object.entries(affinity)
    .filter(([, w]) => w <= AVOIDED)
    .map(([g]) => Number(g));
  const lane = await Promise.all(
    searches
      .filter((s) => base.mediaTypes.includes(s.media_type))
      .map(async (s) => {
        const type = s.media_type;
        // Discover has people for films only, and people and keywords
        // together ("and") find next to nothing: a search with people is
        // carried by them alone.
        const people =
          type === "movie" ? await findAll(findPerson, s.people.slice(0, 3)) : [];
        const keywords = people.length
          ? []
          : await findAll(findKeyword, s.keywords.slice(0, 4));
        const genres = people.length
          ? []
          : s.genres.filter((g) => valid[type].includes(g)).slice(0, 3);
        const countries = s.origin_countries
          .map((c) => c.toUpperCase())
          .filter((c) => /^[A-Z]{2}$/.test(c));
        const languages = s.languages
          .map((l) => l.toLowerCase())
          .filter((l) => /^[a-z]{2}$/.test(l));
        if (
          !people.length &&
          !keywords.length &&
          !countries.length &&
          !languages.length &&
          !s.era.from &&
          !s.era.to
        )
          return null;
        const f: Record<string, string | number> = { ...TASTE_FLOOR[type] };
        const without = [
          ...new Set([
            ...String(base[type].without_genres ?? "")
              .split(",")
              .filter(Boolean)
              .map(Number),
            ...avoided.filter((g) => valid[type].includes(g)),
          ]),
        ].filter((g) => !genres.includes(g));
        if (without.length) f.without_genres = without.join(",");
        if (genres.length) f.with_genres = genres.join("|");
        if (keywords.length) f.with_keywords = keywords.join("|");
        if (people.length) f.with_people = people.join("|");
        if (countries.length) f.with_origin_country = countries.join("|");
        if (languages.length) f.with_original_language = languages.join("|");
        const date = type === "movie" ? "primary_release_date" : "first_air_date";
        if (s.era.from) f[`${date}.gte`] = `${s.era.from}-01-01`;
        if (s.era.to) f[`${date}.lte`] = `${s.era.to}-12-31`;
        return { type, label: s.label.trim().slice(0, 60), filters: f };
      }),
  );
  return lane.filter((l) => l !== null);
}

/**
 * The lane's next cards: the best rated of each search not yet shown or
 * answered, the searches taking turns. The same pages are read each time
 * and what was shown is skipped, so the lane simply runs dry when its
 * searches do.
 */
export async function tasteCards({
  lane,
  providerIds,
  maxCert,
  excluded,
  shown,
  affinity = {},
}: {
  /** Genre weights: a title whose genres weigh below zero is left out. */
  affinity?: Record<number, number>;
  lane: TasteLane;
  providerIds: number[];
  maxCert: number | null;
  /** Keys the deck leaves out (see getExcluded). */
  excluded: ReadonlySet<string>;
  /** Cards already in the deck this session. */
  shown: ReadonlySet<string>;
}): Promise<Card[]> {
  if (lane.length === 0) return [];
  const perSearch = await Promise.all(
    lane.map(async (l) => {
      const pages = await Promise.all(
        TASTE_PAGES.map((page) =>
          discover(l.type, {
            providerIds,
            page,
            sortBy: "vote_average.desc",
            filters: l.filters,
          }).catch((e) => {
            console.warn("Taste lane search failed", e);
            return { hits: [] as DiscoverHit[], totalPages: 0 };
          }),
        ),
      );
      return pages
        .flatMap((p) => p.hits)
        .filter((h) => !excluded.has(key(h)) && !shown.has(key(h)));
    }),
  );
  const longest = Math.max(0, ...perSearch.map((h) => h.length));
  const hits = [
    ...new Map(
      Array.from({ length: longest }, (_, i) => perSearch.map((h) => h[i]))
        .flat()
        .filter((h) => h !== undefined)
        .map((h) => [key(h), h] as const),
    ).values(),
    // Some fall away below (services, age), so look up a few more.
  ].slice(0, TASTE_PER_PAGE * 2);
  if (hits.length === 0) return [];
  const [rows, genres] = await Promise.all([getTitles(hits), getGenreNames()]);
  const mine = new Set(providerIds);
  const cards: Card[] = [];
  for (const h of hits) {
    const row = rows.get(key(h));
    if (!row) continue;
    if (!streamingProviders(row.providers_se).some((p) => mine.has(p.id)))
      continue;
    if (!fitsAge(row, maxCert)) continue;
    // Keywords are loose ("small town" also finds a romance): what the
    // profile on the whole says no to is not the lane's to bring.
    const gs = genresOf(row.genre_ids, row.media_type);
    if (gs.length && gs.reduce((sum, g) => sum + (affinity[g] ?? 0), 0) < 0)
      continue;
    cards.push({ ...toCard(row, mine, genres), source: "taste" });
    if (cards.length === TASTE_PER_PAGE) break;
  }
  return cards;
}

/** One lane card after every two of the deck's, nothing twice. */
export function withTasteLane(taste: Card[], deck: Card[]): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  const add = (c: Card | undefined) => {
    if (c && !seen.has(key(c))) {
      seen.add(key(c));
      out.push(c);
    }
  };
  let t = 0;
  for (let i = 0; i < deck.length; i++) {
    add(deck[i]);
    if (i % 2 === 1) add(taste[t++]);
  }
  for (; t < taste.length; t++) add(taste[t]);
  return out;
}
