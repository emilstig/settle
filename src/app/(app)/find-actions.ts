"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  buildFilters,
  deckFiltersSchema,
  getDeckContext,
  getExcluded,
  key,
  loadDeckPage,
  withoutGroupGenres,
  type Card,
  type CardSource,
} from "@/lib/deck";
import { getGroups } from "@/lib/groups";
import { blendAffinity, buildGroupTaste, buildProfile } from "@/lib/profile";
import { getSimilar } from "@/lib/similar";
import { withPicks } from "@/lib/suggest";
import { eveningStart, getTonight, type Tonight } from "@/lib/tonight";
import { applyParsed, parseMood, relax } from "@/lib/suggest/parse";
import { askStyleTitles, styleCards, withStyle } from "@/lib/suggest/style";
import { getUserProviderIds } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";
import { getExternalLinks } from "@/lib/tmdb/external";
import { getTrailerKey } from "@/lib/tmdb/videos";

// ---------------------------------------------------------------------------
// Shapes shared with the client
// ---------------------------------------------------------------------------

const ref = z.object({
  tmdb_id: z.number().int().positive(),
  media_type: z.enum(["movie", "tv"]),
});
type Ref = z.infer<typeof ref>;
const uuid = z.uuid();
/** Where the swiped card came from in the deck (see Card.source). */
const source = z.enum(["popular", "similar", "pick", "mood"]).nullish();

const interest = z.enum(["maybe", "want", "rewatch"]);
const ratingRow = z.object({
  rating: z.number().int(),
  group_id: z.uuid().nullable(),
});
const watchLogRow = z.object({
  times_seen: z.enum(["once", "few", "many"]).nullable(),
  last_seen: z.iso.date().nullable().optional(),
  last_seen_approx: z.enum(["recent", "this_year", "long_ago"]).nullable(),
});

/** Everything needed to put the database back as it was before a swipe. */
const undoSchema = z.object({
  ref,
  /** Null for Sett in Att se, which has no session. */
  sessionId: uuid.nullable(),
  interactionIds: z.array(z.number().int()),
  watchlist: z.array(z.object({ group_id: uuid, prev: interest.nullable() })),
  rating: z.object({ prev: ratingRow.nullable() }).optional(),
  watchLog: z.object({ prev: watchLogRow.nullable() }).optional(),
});
export type Undo = z.infer<typeof undoSchema>;

export type DeckResult = {
  sessionId: string;
  cards: Card[];
  page: number;
  hasMore: boolean;
  /** Prompt 1's heading for the deck, when there was a mood to read. */
  label?: string | null;
};

// ---------------------------------------------------------------------------
// Session and deck
// ---------------------------------------------------------------------------

const startSchema = z.object({
  groupId: uuid,
  quickPicks: z.array(z.string().max(30)).max(10),
  moodText: z.string().max(500),
});

export async function startSession(
  input: z.infer<typeof startSchema>,
): Promise<DeckResult> {
  const user = await getCurrentUser();
  const { groupId, quickPicks, moodText } = startSchema.parse(input);
  const groups = await getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group) throw new Error("Unknown group");

  let filters = buildFilters(group, quickPicks);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      group_id: groupId,
      mood_text: moodText.trim() || null,
      quick_picks: quickPicks,
      filters,
    })
    .select("id")
    .single();
  if (error) throw error;

  // Prompt 1 turns the mood into filters. Without a mood it is skipped, and
  // if it fails the rule-based filters stay.
  const hasMood = moodText.trim() !== "" || quickPicks.length > 0;
  // Titles in the style: only for free text, and next to prompt 1 so the
  // start button does not wait for both in turn.
  const askingStyle =
    moodText.trim() !== ""
      ? askStyleTitles({
          sessionId: data.id,
          userId: user.id,
          group,
          moodText,
          quickPicks,
        })
      : Promise.resolve([]);
  const [providerIds, profile, groupTaste, parsed] = await Promise.all([
    getUserProviderIds(),
    buildProfile(user.id),
    buildGroupTaste(user.id, group),
    hasMood
      ? parseMood({
          sessionId: data.id,
          userId: user.id,
          group,
          moodText,
          quickPicks,
        })
      : Promise.resolve(null),
  ]);
  if (parsed) filters = await applyParsed(filters, parsed, group);
  // Genres the group keeps turning down stay out of discover.
  filters = await withoutGroupGenres(filters, groupTaste.avoid);
  if (parsed || groupTaste.avoid.length) {
    const { error: updateError } = await supabase
      .from("sessions")
      .update({ filters })
      .eq("id", data.id);
    if (updateError) throw updateError;
  }
  const affinity = blendAffinity(profile.affinity, groupTaste, group.kind);
  // "Liknar det ni gillat": recommendations for what the group already liked.
  const similar = await getSimilar({
    userId: user.id,
    group,
    seed: data.id,
    avoid: groupTaste.avoid,
  });
  // Keep loading until there is something to show, so the start button
  // waits instead of opening an empty deck.
  let { cards, page, hasMore } = await loadEnough(
    {
      userId: user.id,
      groupId,
      providerIds,
      filters,
      seed: data.id,
      affinity,
      similar,
    },
    1,
    [],
    MIN_START_CARDS,
  );
  // Prompt 1's filters can be too narrow. Loosen them step by step until
  // there is enough to show, and keep what was used on the session.
  for (const level of [1, 2] as const) {
    if (!parsed || cards.length >= MIN_START_CARDS) break;
    filters = relax(filters, level);
    ({ cards, page, hasMore } = await loadEnough(
      {
        userId: user.id,
        groupId,
        providerIds,
        filters,
        seed: data.id,
        affinity,
        similar,
      },
      1,
      [],
      MIN_START_CARDS,
    ));
    const { error: relaxError } = await supabase
      .from("sessions")
      .update({ filters })
      .eq("id", data.id);
    if (relaxError) throw relaxError;
  }

  // Titles in the style lead when there are enough of them, within the same
  // limits as the deck (the filters as finally used).
  const [styleTitles, excluded] = await Promise.all([
    askingStyle,
    getExcluded(user.id, groupId),
  ]);
  const style = styleTitles.length
    ? await styleCards({ titles: styleTitles, filters, providerIds, excluded })
    : [];
  cards = withStyle(style, cards);

  // Claude's three picks first, with a reason each.
  const deck = await withPicks({
    sessionId: data.id,
    userId: user.id,
    group,
    groups,
    providerIds,
    filters,
    profile: { ...profile, affinity },
    groupTaste,
    moodText,
    quickPicks,
    deck: cards,
  });
  return {
    sessionId: data.id,
    cards: deck,
    page,
    hasMore,
    label: filters.parsed?.label || null,
  };
}

const moreSchema = z.object({
  sessionId: uuid,
  // TMDB's discover stops at page 500.
  page: z.number().int().min(2).max(500),
  skip: z.array(z.string().max(20)).max(2000),
});

/** Cards to have before showing the deck, and before a refill counts. */
const MIN_START_CARDS = 10;
const MIN_MORE_CARDS = 6;
/**
 * TMDB pages to look through in one go. Every session starts on page 1, and
 * everything answered is left out, so after a hundred or so swipes the first
 * pages come back nearly empty and the deck has to look further down.
 */
const MAX_PAGES_AT_ONCE = 16;
/** Pages fetched side by side once a page came back short. */
const PAGES_PER_BATCH = 3;

/**
 * Loads deck pages from `firstPage` until there are enough cards. The first
 * page is loaded alone; if it is short, the next ones come in parallel
 * batches. The lane "Liknar det ni gillat" and the rested seen titles go
 * with the first page of each batch only, so parallel pages do not get the
 * same ones. A page that fails ends the scan: what was loaded before it is returned, and the
 * next call starts on that page again. Only a failure with nothing to show
 * is thrown.
 */
async function loadEnough(
  base: Omit<Parameters<typeof loadDeckPage>[0], "page" | "skip" | "context">,
  firstPage: number,
  skip: string[],
  min: number,
): Promise<{ cards: Card[]; page: number; hasMore: boolean }> {
  const context = await getDeckContext(base.userId, base.groupId);
  const cards: Card[] = [];
  const seen = new Set(skip);
  let last = firstPage - 1;
  let hasMore = true;
  while (
    hasMore &&
    cards.length < min &&
    last - firstPage + 1 < MAX_PAGES_AT_ONCE
  ) {
    const size = Math.min(
      last < firstPage ? 1 : PAGES_PER_BATCH,
      firstPage + MAX_PAGES_AT_ONCE - 1 - last,
    );
    const pages = Array.from({ length: size }, (_, i) => last + 1 + i);
    const skipNow = [...seen];
    const results = await Promise.allSettled(
      pages.map((page, i) =>
        loadDeckPage({
          ...base,
          similar: i === 0 ? base.similar : [],
          addRested: i === 0,
          page,
          skip: skipNow,
          context,
        }),
      ),
    );
    for (const [i, r] of results.entries()) {
      if (r.status === "rejected") {
        if (cards.length === 0) throw r.reason;
        console.warn(`Deck page ${pages[i]} failed`, r.reason);
        return { cards, page: last, hasMore: true };
      }
      for (const c of r.value.cards) {
        const k = key(c);
        if (seen.has(k)) continue;
        seen.add(k);
        cards.push(c);
      }
      last = pages[i];
      hasMore = r.value.hasMore;
      if (!hasMore) break;
    }
  }
  return { cards, page: last, hasMore };
}

/** Swipes needed before a new page gets Claude's picks again. */
const SWIPES_BETWEEN_PICKS = 15;

async function swipedSinceLastPicks(sessionId: string): Promise<number> {
  const supabase = await createClient();
  const { data: last, error } = await supabase
    .from("suggest_runs")
    .select("created_at")
    .eq("session_id", sessionId)
    .eq("prompt", "pick")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!last) return Infinity;
  const { count, error: countError } = await supabase
    .from("interactions")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .in("action", ["right", "left", "unsure", "maybe", "seen"])
    .gte("created_at", last.created_at);
  if (countError) throw countError;
  return count ?? 0;
}

export async function loadMore(
  input: z.infer<typeof moreSchema>,
): Promise<DeckResult> {
  const user = await getCurrentUser();
  const { sessionId, page, skip } = moreSchema.parse(input);
  const supabase = await createClient();
  const { data: session, error } = await supabase
    .from("sessions")
    .select("id, group_id, filters, mood_text, quick_picks")
    .eq("id", sessionId)
    .single();
  if (error) throw error;

  const filters = deckFiltersSchema.parse(session.filters);
  const [providerIds, profile, groups] = await Promise.all([
    getUserProviderIds(),
    buildProfile(user.id),
    getGroups(),
  ]);
  const group = groups.find((g) => g.id === session.group_id);
  if (!group) throw new Error("Unknown group");
  const groupTaste = await buildGroupTaste(user.id, group);
  const affinity = blendAffinity(profile.affinity, groupTaste, group.kind);
  const similar = await getSimilar({
    userId: user.id,
    group,
    seed: sessionId,
    avoid: groupTaste.avoid,
  });
  const loaded = await loadEnough(
    {
      userId: user.id,
      groupId: session.group_id,
      providerIds,
      filters,
      seed: sessionId,
      affinity,
      similar,
    },
    page,
    skip,
    MIN_MORE_CARDS,
  );
  const { cards, hasMore } = loaded;
  // Prompt 2 runs again on a new page only once the user has swiped through
  // enough of the last picks. A page fetched ahead of time right after the
  // start would otherwise run Claude for cards nobody reaches.
  const deck =
    (await swipedSinceLastPicks(sessionId)) >= SWIPES_BETWEEN_PICKS
      ? await withPicks({
          sessionId,
          userId: user.id,
          group,
          groups,
          providerIds,
          filters,
          profile: { ...profile, affinity },
          groupTaste,
          moodText: session.mood_text ?? "",
          quickPicks: session.quick_picks ?? [],
          deck: cards,
          shown: skip,
        })
      : cards;
  return { sessionId, cards: deck, page: loaded.page, hasMore };
}

// ---------------------------------------------------------------------------
// Swipes
// ---------------------------------------------------------------------------

async function logInteraction(
  userId: string,
  sessionId: string | null,
  r: Ref,
  action:
    "right" | "left" | "seen" | "open_detail" | "undo" | "unsure" | "maybe",
  reason: "not_now" | "not_for_me" | "seen" | "other_group" | null = null,
  from: CardSource | null = null,
): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interactions")
    .insert({
      user_id: userId,
      session_id: sessionId,
      ...r,
      action,
      reason,
      source: from,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

async function currentInterest(userId: string, groupId: string, r: Ref) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watchlist")
    .select("interest")
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .eq("tmdb_id", r.tmdb_id)
    .eq("media_type", r.media_type)
    .maybeSingle();
  if (error) throw error;
  return (data?.interest as z.infer<typeof interest> | undefined) ?? null;
}

/** Whether the user has seen the title (calibration, Sett or a check-in). */
async function hasSeen(userId: string, r: Ref): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watch_log")
    .select("tmdb_id")
    .match({ user_id: userId, ...r })
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * What saving a title from the deck puts on a list: a seen title is
 * "se igen", anything else "vill se".
 */
async function savedInterest(
  userId: string,
  r: Ref,
): Promise<z.infer<typeof interest>> {
  return (await hasSeen(userId, r)) ? "rewatch" : "maybe";
}

async function upsertWatchlist(
  userId: string,
  groupId: string,
  r: Ref,
  value: z.infer<typeof interest>,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("watchlist")
    .upsert(
      { user_id: userId, group_id: groupId, ...r, interest: value },
      { onConflict: "user_id,tmdb_id,media_type,group_id" },
    );
  if (error) throw error;
}

const swipeSchema = z.object({ sessionId: uuid, groupId: uuid, ref, source });

/** Right: wants to see it. Lands on the group's list as "maybe". */
export async function swipeRight(
  input: z.infer<typeof swipeSchema>,
): Promise<Undo> {
  const user = await getCurrentUser();
  const { sessionId, groupId, ref: r, source: from } = swipeSchema.parse(input);
  const prev = await currentInterest(user.id, groupId, r);
  const id = await logInteraction(
    user.id,
    sessionId,
    r,
    "right",
    null,
    from ?? null,
  );
  // A title already on the list as "vill gärna" or "se igen" keeps that. A
  // seen title wanted again is "se igen" for the group.
  await upsertWatchlist(
    user.id,
    groupId,
    r,
    prev === "want" || prev === "rewatch"
      ? prev
      : await savedInterest(user.id, r),
  );
  return {
    ref: r,
    sessionId,
    interactionIds: [id],
    watchlist: [{ group_id: groupId, prev }],
  };
}

/** Left: no. Starts as "inte nu"; the reason chips can change it. */
export async function swipeLeft(input: {
  sessionId: string;
  ref: Ref;
  source?: CardSource | null;
}): Promise<Undo> {
  const user = await getCurrentUser();
  const sessionId = uuid.parse(input.sessionId);
  const r = ref.parse(input.ref);
  const id = await logInteraction(
    user.id,
    sessionId,
    r,
    "left",
    "not_now",
    source.parse(input.source) ?? null,
  );
  return { ref: r, sessionId, interactionIds: [id], watchlist: [] };
}

/**
 * Down: "Kanske". Interesting, but not tonight: lands on the group's list as
 * "maybe" ("rewatch" when seen) without joining Ikväll, and rests in the
 * deck for 7 days.
 */
export async function swipeDown(
  input: z.infer<typeof swipeSchema>,
): Promise<Undo> {
  const user = await getCurrentUser();
  const { sessionId, groupId, ref: r, source: from } = swipeSchema.parse(input);
  const prev = await currentInterest(user.id, groupId, r);
  const id = await logInteraction(
    user.id,
    sessionId,
    r,
    "maybe",
    null,
    from ?? null,
  );
  // A seen title lands on "se igen", like a right swipe.
  if (!prev)
    await upsertWatchlist(user.id, groupId, r, await savedInterest(user.id, r));
  return {
    ref: r,
    sessionId,
    interactionIds: [id],
    watchlist: prev ? [] : [{ group_id: groupId, prev }],
  };
}

const groupsSchema = z.object({
  sessionId: uuid,
  groupId: uuid,
  ref,
  source,
  groupIds: z.array(uuid).min(1).max(10),
});

/**
 * "Spara för annan grupp" in the deck's detail view: the title goes on the
 * chosen groups' lists as "maybe", or "rewatch" when seen (a title already
 * there keeps its interest), and leaves the deck. With the group swiped with among them it is a right
 * swipe and joins Ikväll; without it, it is logged as left with the reason
 * "other_group", which rests it in this group's deck and says nothing about
 * the group's taste.
 */
export async function saveForGroups(
  input: z.infer<typeof groupsSchema>,
): Promise<Undo> {
  const user = await getCurrentUser();
  const {
    sessionId,
    groupId,
    ref: r,
    source: from,
    groupIds,
  } = groupsSchema.parse(input);
  const owned = new Set((await getGroups()).map((g) => g.id));
  const chosen = [...new Set(groupIds)].filter((id) => owned.has(id));
  if (chosen.length === 0) throw new Error("No groups");
  const withThis = chosen.includes(groupId);
  const id = await logInteraction(
    user.id,
    sessionId,
    r,
    withThis ? "right" : "left",
    withThis ? null : "other_group",
    from ?? null,
  );
  const watchlist: Undo["watchlist"] = [];
  const value = await savedInterest(user.id, r);
  for (const g of chosen) {
    const prev = await currentInterest(user.id, g, r);
    if (prev) continue;
    watchlist.push({ group_id: g, prev });
    await upsertWatchlist(user.id, g, r, value);
  }
  return { ref: r, sessionId, interactionIds: [id], watchlist };
}

export async function setLeftReason(input: {
  interactionId: number;
  reason: "not_now" | "not_for_me" | "seen";
}) {
  await getCurrentUser();
  const id = z.number().int().parse(input.interactionId);
  const reason = z.enum(["not_now", "not_for_me", "seen"]).parse(input.reason);
  const supabase = await createClient();
  const { error } = await supabase
    .from("interactions")
    .update({ reason })
    .eq("id", id);
  if (error) throw error;
}

const seenSchema = z.object({
  /** Null from Att se, outside the deck. */
  sessionId: uuid.nullable(),
  groupId: uuid,
  ref,
  rating: z
    .union([z.literal(-1), z.literal(1), z.literal(2), z.literal(3)])
    .nullable(),
  /** Null leaves se igen as it was (the sheet was closed). */
  rewatchGroupIds: z.array(uuid).max(10).nullable(),
  source,
});

/** Groups where the title is already on the se igen list, for the sheet. */
export async function rewatchGroupsFor(input: Ref): Promise<string[]> {
  const user = await getCurrentUser();
  const r = ref.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watchlist")
    .select("group_id")
    .eq("user_id", user.id)
    .eq("tmdb_id", r.tmdb_id)
    .eq("media_type", r.media_type)
    .eq("interest", "rewatch");
  if (error) throw error;
  return data.map((row) => row.group_id as string);
}

/**
 * Up, or "Sett den": marks it seen in the watch log, writes the rating and any
 * "se igen med" rows. How many times and when are not asked in the MVP.
 */
export async function recordSeen(
  input: z.infer<typeof seenSchema>,
): Promise<Undo> {
  const user = await getCurrentUser();
  const s = seenSchema.parse(input);
  const supabase = await createClient();
  const match = {
    user_id: user.id,
    tmdb_id: s.ref.tmdb_id,
    media_type: s.ref.media_type,
  };

  const [prevRating, prevLog] = await Promise.all([
    supabase
      .from("ratings")
      .select("rating, group_id")
      .match(match)
      .maybeSingle(),
    supabase
      .from("watch_log")
      .select("times_seen, last_seen, last_seen_approx")
      .match(match)
      .maybeSingle(),
  ]);
  if (prevRating.error) throw prevRating.error;
  if (prevLog.error) throw prevLog.error;

  const id = await logInteraction(
    user.id,
    s.sessionId,
    s.ref,
    "seen",
    null,
    s.source ?? null,
  );
  const undo: Undo = {
    ref: s.ref,
    sessionId: s.sessionId,
    interactionIds: [id],
    watchlist: [],
    watchLog: { prev: prevLog.data ?? null },
  };

  // Seen before (a title on Att se om, say): this is one more time.
  const { error: logError } = prevLog.data
    ? await supabase
        .from("watch_log")
        .update({
          times_seen:
            prevLog.data.times_seen === null ||
            prevLog.data.times_seen === "once"
              ? "few"
              : "many",
          last_seen: stockholmDate(),
        })
        .match(match)
    : await supabase.from("watch_log").insert(match);
  if (logError) throw logError;

  if (s.rating !== null) {
    undo.rating = { prev: prevRating.data ?? null };
    const { error } = await supabase
      .from("ratings")
      .upsert(
        { ...match, rating: s.rating, group_id: s.groupId },
        { onConflict: "user_id,tmdb_id,media_type" },
      );
    if (error) throw error;
  }

  // The answer is the full set of groups: chosen ones get se igen, and
  // groups that had it but were deselected lose it.
  if (s.rewatchGroupIds !== null) {
    const owned = new Set((await getGroups()).map((g) => g.id));
    const chosen = new Set(s.rewatchGroupIds.filter((g) => owned.has(g)));
    const before = await rewatchGroupsFor(s.ref);
    for (const groupId of new Set([...chosen, ...before])) {
      const prev = await currentInterest(user.id, groupId, s.ref);
      if (chosen.has(groupId)) {
        if (prev === "rewatch") continue;
        undo.watchlist.push({ group_id: groupId, prev });
        await upsertWatchlist(user.id, groupId, s.ref, "rewatch");
      } else {
        undo.watchlist.push({ group_id: groupId, prev });
        const { error } = await supabase
          .from("watchlist")
          .delete()
          .match({ ...match, group_id: groupId });
        if (error) throw error;
      }
    }
  }

  // Seen is a fact about the user: it is not something to see any more in
  // any group, so Vill se and Vill gärna go. Se igen stays where it is.
  const { data: wishes, error: wishError } = await supabase
    .from("watchlist")
    .select("group_id, interest")
    .match(match)
    .in("interest", ["maybe", "want"]);
  if (wishError) throw wishError;
  if (wishes.length) {
    for (const w of wishes)
      undo.watchlist.push({
        group_id: w.group_id as string,
        prev: w.interest as z.infer<typeof interest>,
      });
    const { error } = await supabase
      .from("watchlist")
      .delete()
      .match(match)
      .in("interest", ["maybe", "want"]);
    if (error) throw error;
  }

  return undo;
}

/** Today's date in Sweden, for last_seen. */
function stockholmDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
  }).format(now);
}

/** Puts back everything the last swipe wrote, and logs the undo. */
export async function undoSwipe(input: Undo) {
  const user = await getCurrentUser();
  const u = undoSchema.parse(input);
  const supabase = await createClient();
  const match = {
    user_id: user.id,
    tmdb_id: u.ref.tmdb_id,
    media_type: u.ref.media_type,
  };

  for (const w of u.watchlist) {
    if (w.prev === null) {
      const { error } = await supabase
        .from("watchlist")
        .delete()
        .match({ ...match, group_id: w.group_id });
      if (error) throw error;
    } else {
      await upsertWatchlist(user.id, w.group_id, u.ref, w.prev);
    }
  }

  if (u.rating) {
    const { error } = u.rating.prev
      ? await supabase
          .from("ratings")
          .upsert(
            { ...match, ...u.rating.prev },
            { onConflict: "user_id,tmdb_id,media_type" },
          )
      : await supabase.from("ratings").delete().match(match);
    if (error) throw error;
  }

  if (u.watchLog) {
    const { error } = u.watchLog.prev
      ? await supabase
          .from("watch_log")
          .upsert(
            { ...match, ...u.watchLog.prev },
            { onConflict: "user_id,tmdb_id,media_type" },
          )
      : await supabase.from("watch_log").delete().match(match);
    if (error) throw error;
  }

  if (u.interactionIds.length) {
    const { error } = await supabase
      .from("interactions")
      .delete()
      .in("id", u.interactionIds);
    if (error) throw error;
  }
  await logInteraction(user.id, u.sessionId, u.ref, "undo");
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tonight
// ---------------------------------------------------------------------------

/** Tonight's choice and saved candidates for a group. */
export async function tonight(input: { groupId: string }): Promise<Tonight> {
  const user = await getCurrentUser();
  const groupId = uuid.parse(input.groupId);
  return getTonight(user.id, groupId, await getUserProviderIds());
}

const chooseSchema = z.object({
  groupId: uuid,
  ref,
  /** The current session; without it, tonight's latest session for the group. */
  sessionId: uuid.optional(),
});

/**
 * "Välj": sets tonight's choice on the session. One choice per evening and
 * group, so any earlier choice tonight is cleared.
 */
export async function chooseTonight(input: z.infer<typeof chooseSchema>) {
  const user = await getCurrentUser();
  const { groupId, ref: r, sessionId } = chooseSchema.parse(input);
  const supabase = await createClient();
  const target = await tonightSession(user.id, groupId, sessionId);

  await clearTonightChoice(user.id, groupId);
  const { error: pickError } = await supabase
    .from("sessions")
    .update({
      picked_tmdb_id: r.tmdb_id,
      picked_media_type: r.media_type,
      picked_at: new Date().toISOString(),
    })
    .eq("id", target);
  if (pickError) throw pickError;
}

/**
 * The session tonight's choices and additions live on: the given one when it
 * is tonight's, else tonight's latest for the group. Without a session tonight
 * (from Att se) one is made, marked by its origin so that it is not counted as
 * a session started without a mood.
 */
async function tonightSession(
  userId: string,
  groupId: string,
  sessionId?: string,
): Promise<string> {
  const supabase = await createClient();
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .gte("started_at", eveningStart())
    .order("started_at", { ascending: false });
  if (error) throw error;
  if (sessionId && sessions.some((s) => s.id === sessionId)) return sessionId;
  if (sessions[0]) return sessions[0].id as string;
  const { data: created, error: createError } = await supabase
    .from("sessions")
    .insert({ user_id: userId, group_id: groupId, filters: { origin: "list" } })
    .select("id")
    .single();
  if (createError) throw createError;
  return created.id as string;
}

const addSchema = z.object({ groupId: uuid, ref });

/**
 * "+ Ikväll" from Att se, or after "se igen" in Hitta: the title is on the
 * group's list already,
 * so it is logged as a right swipe in tonight's session and joins Ikväll.
 * Profiles and seeds count the latest reaction per title, so it is not
 * counted twice. Taken off again with removeFromTonight, like a row in Ikväll.
 */
export async function addToTonight(input: z.infer<typeof addSchema>) {
  const user = await getCurrentUser();
  const { groupId, ref: r } = addSchema.parse(input);
  const supabase = await createClient();
  const { data: onList, error } = await supabase
    .from("watchlist")
    .select("tmdb_id")
    .match({ user_id: user.id, group_id: groupId, ...r })
    .maybeSingle();
  if (error) throw error;
  if (!onList) throw new Error("Not on the group's list");
  const sessionId = await tonightSession(user.id, groupId);
  return logInteraction(user.id, sessionId, r, "right");
}

async function clearTonightChoice(userId: string, groupId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sessions")
    .update({ picked_tmdb_id: null, picked_media_type: null, picked_at: null })
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .gte("started_at", eveningStart())
    .not("picked_tmdb_id", "is", null);
  if (error) throw error;
}

const removeSchema = z.object({ groupId: uuid, ref });

/** What "Ångra" after "Ta bort" in Ikväll needs to put back. */
export type TonightRemoval = {
  interactionId: number;
  /** Set when the title was tonight's choice; the choice is put back too. */
  choiceSessionId: string | null;
};

/**
 * "Ta bort" in Ikväll: the title leaves tonight's shortlist but stays on the
 * group's list. Logged as an undo in tonight's latest session, which outranks
 * the earlier right swipe. It does not come back with the group until the
 * next evening (see getDeclined), so "Ångra" is the way back. If it was
 * tonight's choice, the choice goes too.
 */
export async function removeFromTonight(
  input: z.infer<typeof removeSchema>,
): Promise<TonightRemoval | null> {
  const user = await getCurrentUser();
  const { groupId, ref: r } = removeSchema.parse(input);
  const supabase = await createClient();
  const since = eveningStart();
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, picked_tmdb_id, picked_media_type")
    .eq("user_id", user.id)
    .eq("group_id", groupId)
    .gte("started_at", since)
    .order("started_at", { ascending: false });
  if (error) throw error;
  if (sessions.length === 0) return null;
  const interactionId = await logInteraction(
    user.id,
    sessions[0].id,
    r,
    "undo",
  );
  const chosen = sessions.find(
    (s) =>
      s.picked_tmdb_id === r.tmdb_id && s.picked_media_type === r.media_type,
  );
  if (chosen) await clearTonightChoice(user.id, groupId);
  return { interactionId, choiceSessionId: chosen?.id ?? null };
}

const restoreSchema = z.object({
  groupId: uuid,
  ref,
  interactionId: z.number().int(),
  choiceSessionId: uuid.nullable(),
});

/** "Ångra" after "Ta bort": back in Ikväll, and back as the choice if it was. */
export async function restoreToTonight(input: z.infer<typeof restoreSchema>) {
  const user = await getCurrentUser();
  const {
    groupId,
    ref: r,
    interactionId,
    choiceSessionId,
  } = restoreSchema.parse(input);
  const supabase = await createClient();
  const { error } = await supabase
    .from("interactions")
    .delete()
    .eq("id", interactionId)
    .eq("user_id", user.id)
    .eq("action", "undo");
  if (error) throw error;
  if (choiceSessionId)
    await chooseTonight({ groupId, ref: r, sessionId: choiceSessionId });
}

/** "Ändra": tonight has no choice again. */
export async function clearTonight(input: { groupId: string }) {
  const user = await getCurrentUser();
  await clearTonightChoice(user.id, uuid.parse(input.groupId));
}

/**
 * Logs that the card was opened and returns the trailer and the ids for the
 * IMDb and Rotten Tomatoes links, fetched on demand. From Ikväll on the start view there may be no session yet.
 */
export async function openDetail(input: {
  sessionId: string | null;
  ref: Ref;
  source?: CardSource | null;
}): Promise<{ trailerKey: string | null; imdbId: string | null; rtPath: string | null }> {
  const user = await getCurrentUser();
  const sessionId = uuid.nullable().parse(input.sessionId);
  const r = ref.parse(input.ref);
  const from = source.parse(input.source) ?? null;
  const [trailerKey, links] = await Promise.all([
    getTrailerKey(r.media_type, r.tmdb_id).catch(() => null),
    getExternalLinks(r.media_type, r.tmdb_id).catch(() => ({ imdbId: null, rtPath: null })),
    logInteraction(user.id, sessionId, r, "open_detail", null, from),
  ]);
  return { trailerKey, ...links };
}
