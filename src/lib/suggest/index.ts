import "server-only";
import { key, type Card, type DeckFilters } from "@/lib/deck";
import type { Group } from "@/lib/groups";
import { buildGroupHistory, type TasteProfile } from "@/lib/profile";
import { extraCandidates, seenCandidates } from "./candidates";
import { pickThree } from "./pick";

/** About 20 candidates for prompt 2, per the project doc. */
const FROM_DECK = 12;
const EXTRAS = 6;
const MAX_CANDIDATES = 22;

/**
 * Puts Claude's three picks first in a deck page. Candidates are the top of
 * the page, acclaimed and newer titles in the user's genres, and seen titles
 * that may come back. If anything fails, the page is returned unchanged.
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
    const comfort = quickPicks.includes("Något tryggt");
    const novelty = quickPicks.includes("Överraska mig")
      ? "high"
      : comfort
        ? "low"
        : "medium";
    const ctx = {
      userId,
      groupId: group.id,
      providerIds,
      filters,
      affinity: profile.affinity,
      skip: new Set([...shown, ...deck.map(key)]),
    };
    const [extras, seen, groupHistory] = await Promise.all([
      extraCandidates(ctx, EXTRAS),
      seenCandidates(ctx, comfort),
      buildGroupHistory(userId, group),
    ]);

    const byKey = new Map<string, Card>();
    // Seen titles only once per session, not on every page.
    const freshSeen = seen.filter((c) => !shown.includes(key(c)));
    for (const c of [...freshSeen, ...deck.slice(0, FROM_DECK), ...extras]) {
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
        filters: { comfort, novelty },
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
