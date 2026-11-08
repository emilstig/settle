import "server-only";
import { key, type Card, type DeckFilters } from "@/lib/deck";
import type { Group } from "@/lib/groups";
import { buildGroupHistory, type TasteProfile } from "@/lib/profile";
import { extraCandidates, listCandidates } from "./candidates";
import { pickThree, recentPicks } from "./pick";

/** About 20 candidates for prompt 2, per the project doc. */
const FROM_DECK = 12;
const EXTRAS = 6;
const MAX_CANDIDATES = 22;

/**
 * Puts Claude's three picks first in a deck page. Candidates are the top of
 * the page, acclaimed and newer titles in the user's genres, and titles from
 * the user's lists (saved, se igen, and loved ones when the mood is safe).
 * If anything fails, the page is returned unchanged.
 */
export async function withPicks({
  sessionId,
  userId,
  group,
  groups,
  providerIds,
  filters,
  profile,
  moodText,
  quickPicks,
  deck,
  shown = [],
}: {
  sessionId: string;
  userId: string;
  group: Group;
  groups: Group[];
  providerIds: number[];
  filters: DeckFilters;
  profile: TasteProfile;
  moodText: string;
  quickPicks: string[];
  deck: Card[];
  /** Keys already shown earlier in the session. */
  shown?: string[];
}): Promise<Card[]> {
  try {
    // Prompt 1's reading when there is one, otherwise the quick picks.
    const comfort =
      filters.parsed?.comfort ?? quickPicks.includes("Något tryggt");
    const novelty =
      filters.parsed?.novelty ??
      (quickPicks.includes("Överraska mig")
        ? "high"
        : comfort
          ? "low"
          : "medium");
    const ctx = {
      userId,
      groupId: group.id,
      providerIds,
      filters,
      affinity: profile.affinity,
      skip: new Set([...shown, ...deck.map(key)]),
    };
    const [extras, fromLists, groupHistory, rested] = await Promise.all([
      extraCandidates(ctx, EXTRAS),
      // Rotated per session and page.
      // Seen titles stay out when the mood asks for something new.
      listCandidates(
        { ...ctx, seed: `${sessionId}:${shown.length}` },
        comfort,
        novelty !== "high",
      ),
      buildGroupHistory(userId, group),
      recentPicks(userId),
    ]);

    const byKey = new Map<string, Card>();
    // List titles only once per session, not on every page.
    const freshFromLists = fromLists.filter((c) => !shown.includes(key(c)));
    // Top 3 picks from the last 3 days rest, so each evening starts anew.
    const pool = [
      ...freshFromLists,
      ...deck.slice(0, FROM_DECK + rested.size),
      ...extras,
    ];
    for (const c of pool) {
      if (rested.has(key(c))) continue;
      if (!byKey.has(key(c)) && byKey.size < MAX_CANDIDATES)
        byKey.set(key(c), c);
    }
    const candidates = [...byKey.values()];

    const picks = await pickThree(
      {
        sessionId,
        userId,
        group,
        profile: profile.text,
        groupHistory,
        moodText,
        quickPicks,
        filters: { comfort, novelty, vibe: filters.parsed?.vibe ?? null },
        candidates,
      },
      new Map(groups.map((g) => [g.id, g.name])),
    );

    const picked = picks.flatMap((p) => {
      const card = byKey.get(p.key);
      return card ? [{ ...card, reason: p.reason, slot: p.slot }] : [];
    });
    const pickedKeys = new Set(picked.map(key));
    return [...picked, ...deck.filter((c) => !pickedKeys.has(key(c)))];
  } catch (e) {
    console.error("withPicks failed, showing the deck as it is", e);
    return deck;
  }
}
