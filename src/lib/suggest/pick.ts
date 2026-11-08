import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { key, type Card } from "@/lib/deck";
import { PICK_PROMPT } from "./prompts";

/** Prompt 2 runs on Sonnet, per the project doc. */
export const PICK_MODEL = "claude-sonnet-5-5";
const SLOTS = ["safe", "watchlist", "wildcard", "rewatch"] as const;
const OVERVIEW_CHARS = 240;

const pickSchema = z.strictObject({
  picks: z.array(
    z.strictObject({
      id: z.number(),
      slot: z.enum(SLOTS),
      reason: z.string(),
    }),
  ),
});
type PickOutput = z.infer<typeof pickSchema>;

export type Pick = {
  key: string;
  slot: (typeof SLOTS)[number];
  reason: string | null;
};

export type PickInput = {
  sessionId: string;
  userId: string;
  group: {
    id: string;
    name: string;
    kind: string;
    youngest_age: number | null;
  };
  profile: string;
  groupHistory: string;
  moodText: string;
  quickPicks: string[];
  /** Rule-based reading of the quick picks until prompt 1 exists. */
  filters: { comfort: boolean; novelty: "low" | "medium" | "high" };
  candidates: Card[];
};

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

/** What the user already did with each candidate, for the prompt. */
async function userState(
  userId: string,
  cards: Card[],
  groupNames: Map<string, string>,
) {
  const supabase = await createClient();
  const ids = [...new Set(cards.map((c) => c.tmdb_id))];
  const [ratings, log, list] = await Promise.all([
    supabase
      .from("ratings")
      .select("tmdb_id, media_type, rating")
      .eq("user_id", userId)
      .in("tmdb_id", ids),
    supabase
      .from("watch_log")
      .select("tmdb_id, media_type, times_seen, last_seen, status")
      .eq("user_id", userId)
      .in("tmdb_id", ids),
    supabase
      .from("watchlist")
      .select("tmdb_id, media_type, group_id, interest")
      .eq("user_id", userId)
      .in("tmdb_id", ids),
  ]);
  for (const r of [ratings, log, list]) if (r.error) throw r.error;

  const rating = new Map(
    ratings.data!.map((r) => [key(r), r.rating as number]),
  );
  const seen = new Map(log.data!.map((r) => [key(r), r]));
  const lists = new Map<string, { group: string; interest: string }[]>();
  for (const w of list.data!) {
    const entry = {
      group: groupNames.get(w.group_id) ?? "okänd",
      interest: w.interest,
    };
    lists.set(key(w), [...(lists.get(key(w)) ?? []), entry]);
  }
  return { rating, seen, lists };
}

function renderPrompt(input: PickInput, rows: object[]): string {
  const group = {
    name: input.group.name,
    kind: input.group.kind,
    ...(input.group.kind === "family"
      ? { youngest_age: input.group.youngest_age ?? 7 }
      : {}),
  };
  const mood = [input.moodText.trim(), input.quickPicks.join(", ")]
    .filter(Boolean)
    .join(" · ");
  const vars: Record<string, string> = {
    PROFILE: input.profile,
    GROUP: JSON.stringify(group),
    GROUP_HISTORY: input.groupHistory,
    MOOD_TEXT: mood || "Inget angivet",
    FILTERS: JSON.stringify({
      ...input.filters,
      quick_picks: input.quickPicks,
    }),
    CANDIDATES: rows.map((r) => JSON.stringify(r)).join("\n"),
  };
  return PICK_PROMPT.replace(
    /\{\{(\w+)\}\}/g,
    (m, name: string) => vars[name] ?? m,
  );
}

/** Checks the answer against the candidates: known ids, no repeats, at most three. */
function validate(out: PickOutput, count: number): PickOutput | null {
  const ids = out.picks.map((p) => p.id);
  if (ids.length === 0 || ids.length > 3) return null;
  if (new Set(ids).size !== ids.length) return null;
  if (ids.some((id) => !Number.isInteger(id) || id < 1 || id > count)) return null;
  if (ids.length < Math.min(3, count)) return null;
  return out;
}

async function logRun(
  input: PickInput,
  payload: object,
  output: object,
  latency: number,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("suggest_runs").insert({
    session_id: input.sessionId,
    user_id: input.userId,
    prompt: "pick",
    input: payload,
    output,
    model: PICK_MODEL,
    latency_ms: latency,
  });
  if (error) console.error("suggest_runs insert failed", error);
}

/**
 * Prompt 2: Claude picks three of the candidates with a reason each. Strict
 * JSON validated with zod; one retry on an invalid answer, then the candidates
 * sorted by TMDB rating, without reasons. Every attempt is logged.
 */
export async function pickThree(
  input: PickInput,
  groupNames: Map<string, string>,
): Promise<Pick[]> {
  const cards = input.candidates;
  if (cards.length === 0) return [];

  const state = await userState(input.userId, cards, groupNames);
  const rows = cards.map((c, i) => {
    const k = key(c);
    const log = state.seen.get(k);
    return {
      id: i + 1,
      titel: c.title,
      år: c.year,
      typ: c.media_type === "movie" ? "film" : "serie",
      info: c.meta,
      tmdb_betyg: c.vote_average,
      åldersgräns: c.certification,
      beskrivning: c.overview ? c.overview.slice(0, OVERVIEW_CHARS) : null,
      my_rating: state.rating.get(k) ?? null,
      times_seen: log?.times_seen ?? (log ? "once" : null),
      last_seen: log?.last_seen ?? null,
      status: log?.status ?? null,
      watchlist: state.lists.get(k) ?? [],
    };
  });
  const prompt = renderPrompt(input, rows);
  const payload = { prompt, candidates: rows.length };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const response = await anthropic().beta.messages.create({
        model: PICK_MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: "medium",
          format: {
            type: "json_schema",
            schema: z.toJSONSchema(pickSchema) as Record<string, unknown>,
          },
        },
        messages: [{ role: "user", content: prompt }],
      });
      const latency = Date.now() - started;
      const text = response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("");

      if (
        response.stop_reason === "refusal" ||
        response.stop_reason === "max_tokens"
      ) {
        await logRun(
          input,
          payload,
          { attempt, error: response.stop_reason, raw: text },
          latency,
        );
        continue;
      }
      const parsed = pickSchema.safeParse(JSON.parse(text));
      const valid = parsed.success ? validate(parsed.data, cards.length) : null;
      await logRun(
        input,
        payload,
        valid
          ? { attempt, ...valid }
          : { attempt, error: "invalid", raw: text },
        latency,
      );
      if (valid) {
        return valid.picks.map((p) => ({
          key: key(cards[p.id - 1]),
          slot: p.slot,
          reason: p.reason.trim(),
        }));
      }
    } catch (e) {
      const latency = Date.now() - started;
      console.error("prompt 2 failed", e);
      await logRun(
        input,
        payload,
        { attempt, error: e instanceof Error ? e.message : String(e) },
        latency,
      );
    }
  }

  // Fallback: the best rated candidates, without reasons.
  return [...cards]
    .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
    .slice(0, 3)
    .map((c) => ({ key: key(c), slot: "safe" as const, reason: null }));
}
