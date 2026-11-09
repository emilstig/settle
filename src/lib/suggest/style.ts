import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  certNumber,
  key,
  toCard,
  type Card,
  type DeckFilters,
} from "@/lib/deck";
import type { Group } from "@/lib/groups";
import { matchesFilters } from "@/lib/similar";
import { createClient } from "@/lib/supabase/server";
import { getGenreNames } from "@/lib/tmdb/genres";
import { findTitle } from "@/lib/tmdb/search";
import { getTitles, streamingProviders } from "@/lib/tmdb/titles";
import { STYLE_PROMPT } from "./prompts";

/**
 * Titles in the style: for free text about a style, a feeling or "som X",
 * Claude names real titles, since no TMDB filter can say "smalare" or
 * "som Studio Ghibli". Sonnet, since its judgement of style and level is
 * what makes the difference (see scripts/eval). Runs next to prompt 1.
 */
export const STYLE_MODEL = "claude-sonnet-5-5";
/** With this many left after the limits, they lead the deck. */
export const STYLE_LEAD = 5;

const styleSchema = z.strictObject({
  titles: z.array(
    z.strictObject({
      title: z.string(),
      year: z.number(),
      media_type: z.enum(["movie", "tv"]),
    }),
  ),
});
export type StyleTitle = z.infer<typeof styleSchema>["titles"][number];

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

/**
 * Asks Claude for titles in the style of the free text. Strict JSON
 * validated with zod, one retry, then an empty list: the deck works without
 * them. Every attempt is logged in suggest_runs.
 */
export async function askStyleTitles(input: {
  sessionId: string;
  userId: string;
  group: Group;
  moodText: string;
  quickPicks: string[];
}): Promise<StyleTitle[]> {
  const group = {
    kind: input.group.kind,
    ...(input.group.kind === "family"
      ? { youngest_age: input.group.youngest_age ?? 7 }
      : {}),
  };
  const vars: Record<string, string> = {
    MOOD_TEXT: input.moodText.trim(),
    QUICK_PICKS: input.quickPicks.join(", ") || "Inga",
    GROUP: JSON.stringify(group),
  };
  const prompt = STYLE_PROMPT.replace(
    /\{\{(\w+)\}\}/g,
    (m, k: string) => vars[k] ?? m,
  );
  const supabase = await createClient();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    let output: object;
    let result: StyleTitle[] | null = null;
    try {
      const response = await anthropic().messages.create({
        model: STYLE_MODEL,
        max_tokens: 4000,
        // Naming titles needs no thinking out loud, and it keeps the wait short.
        thinking: { type: "between_tools" },
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: z.toJSONSchema(styleSchema) as Record<string, unknown>,
          },
        },
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("");
      const parsed =
        response.stop_reason === "end_turn"
          ? styleSchema.safeParse(JSON.parse(text))
          : null;
      if (parsed?.success) {
        // The schema cannot cap the list (no maxItems), so it is capped here.
        result = parsed.data.titles.slice(0, 30);
        output = { attempt, titles: result };
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
      console.error("style titles failed", e);
      output = { attempt, error: e instanceof Error ? e.message : String(e) };
    }
    const { error } = await supabase.from("suggest_runs").insert({
      session_id: input.sessionId,
      user_id: input.userId,
      prompt: "style",
      input: { prompt },
      output,
      model: STYLE_MODEL,
      latency_ms: Date.now() - started,
    });
    if (error) console.error("suggest_runs insert failed", error);
    if (result) return result;
  }
  return [];
}

/**
 * Claude's titles as cards, found in TMDB by title and year. They pass the
 * same limits as the deck: the user's services, film or series, length,
 * era, lowest rating, required and excluded genres, the age limit, and
 * nothing the user has seen, disliked or turned down. The style is
 * Claude's; the limits are the user's. Keeps Claude's order.
 */
export async function styleCards({
  titles,
  filters,
  providerIds,
  excluded,
}: {
  titles: StyleTitle[];
  filters: DeckFilters;
  providerIds: number[];
  /** Keys the deck leaves out (see getExcluded). */
  excluded: Set<string>;
}): Promise<Card[]> {
  const wanted = titles.filter((t) =>
    filters.mediaTypes.includes(t.media_type),
  );
  const ids = await Promise.all(
    wanted.map((t) =>
      findTitle(t.title, t.year, t.media_type).catch(() => null),
    ),
  );
  const refs = wanted.flatMap((t, i) => {
    const id = ids[i];
    return id === null ? [] : [{ tmdb_id: id, media_type: t.media_type }];
  });
  const unique = [...new Map(refs.map((r) => [key(r), r])).values()].filter(
    (r) => !excluded.has(key(r)),
  );
  if (unique.length === 0) return [];

  const [rows, genres] = await Promise.all([
    getTitles(unique),
    getGenreNames(),
  ]);
  const mine = new Set(providerIds);
  const cards: Card[] = [];
  for (const ref of unique) {
    const row = rows.get(key(ref));
    if (!row) continue;
    if (!streamingProviders(row.providers_se).some((p) => mine.has(p.id)))
      continue;
    if (filters.maxCert !== null) {
      const cert = certNumber(row.certification_se);
      if (cert !== null && cert > filters.maxCert) continue;
    }
    // Genres the mood merely suggested ("any of") are left to Claude's
    // judgement; genres it requires ("all of") and rules out still apply.
    const f = { ...filters[row.media_type] };
    if (f.with_genres !== undefined && String(f.with_genres).includes("|"))
      delete f.with_genres;
    if (!matchesFilters(row, f)) continue;
    cards.push({ ...toCard(row, mine, genres), source: "mood" });
  }
  return cards;
}

/**
 * Titles in the style lead the deck when there are enough of them;
 * otherwise they take turns with it. Nothing twice.
 */
export function withStyle(style: Card[], deck: Card[]): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  const add = (c: Card | undefined) => {
    if (c && !seen.has(key(c))) {
      seen.add(key(c));
      out.push(c);
    }
  };
  if (style.length >= STYLE_LEAD) [...style, ...deck].forEach(add);
  else
    for (let i = 0; i < Math.max(style.length, deck.length); i++) {
      add(style[i]);
      add(deck[i]);
    }
  return out;
}
