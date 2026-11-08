"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  buildFilters,
  deckFiltersSchema,
  loadDeckPage,
  type Card,
} from "@/lib/deck";
import { getGroups } from "@/lib/groups";
import { buildProfile } from "@/lib/profile";
import { withPicks } from "@/lib/suggest";
import { getUserProviderIds } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";
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

const interest = z.enum(["maybe", "want", "rewatch"]);
const ratingRow = z.object({
  rating: z.number().int(),
  group_id: z.uuid().nullable(),
});
const watchLogRow = z.object({
  times_seen: z.enum(["once", "few", "many"]).nullable(),
  last_seen_approx: z.enum(["recent", "this_year", "long_ago"]).nullable(),
});

/** Everything needed to put the database back as it was before a swipe. */
const undoSchema = z.object({
  ref,
  sessionId: uuid,
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

  const filters = buildFilters(group, quickPicks);
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

  const [providerIds, profile] = await Promise.all([
    getUserProviderIds(),
    buildProfile(user.id),
  ]);
  const { cards, hasMore } = await loadDeckPage({
    userId: user.id,
    groupId,
    providerIds,
    filters,
    page: 1,
    seed: data.id,
    affinity: profile.affinity,
  });
  // Claude's three picks first, with a reason each.
  const deck = await withPicks({
    sessionId: data.id,
    userId: user.id,
    group,
    groups,
    providerIds,
    filters,
    profile,
    moodText,
    quickPicks,
    deck: cards,
  });
  return { sessionId: data.id, cards: deck, page: 1, hasMore };
}

const moreSchema = z.object({
  sessionId: uuid,
  page: z.number().int().min(2).max(50),
  skip: z.array(z.string().max(20)).max(500),
});

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
  const { cards, hasMore } = await loadDeckPage({
    userId: user.id,
    groupId: session.group_id,
    providerIds,
    filters,
    page,
    skip,
    seed: sessionId,
    affinity: profile.affinity,
  });
  // Prompt 2 runs again on each new page, per the project doc.
  const group = groups.find((g) => g.id === session.group_id);
  const deck = group
    ? await withPicks({
        sessionId,
        userId: user.id,
        group,
        groups,
        providerIds,
        filters,
        profile,
        moodText: session.mood_text ?? "",
        quickPicks: session.quick_picks ?? [],
        deck: cards,
        shown: skip,
      })
    : cards;
  return { sessionId, cards: deck, page, hasMore };
}

// ---------------------------------------------------------------------------
// Swipes
// ---------------------------------------------------------------------------

async function logInteraction(
  userId: string,
  sessionId: string,
  r: Ref,
  action: "right" | "left" | "seen" | "open_detail" | "undo" | "unsure",
  reason: "not_now" | "not_for_me" | "seen" | null = null,
): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interactions")
    .insert({ user_id: userId, session_id: sessionId, ...r, action, reason })
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

const swipeSchema = z.object({ sessionId: uuid, groupId: uuid, ref });

/** Right: wants to see it. Lands on the group's list as "maybe". */
export async function swipeRight(
  input: z.infer<typeof swipeSchema>,
): Promise<Undo> {
  const user = await getCurrentUser();
  const { sessionId, groupId, ref: r } = swipeSchema.parse(input);
  const prev = await currentInterest(user.id, groupId, r);
  const id = await logInteraction(user.id, sessionId, r, "right");
  await upsertWatchlist(user.id, groupId, r, "maybe");
  return {
    ref: r,
    sessionId,
    interactionIds: [id],
    watchlist: [{ group_id: groupId, prev }],
  };
}

/** "Vill gärna" on the toast after a right swipe. */
export async function setInterest(
  input: z.infer<typeof swipeSchema> & { interest: "maybe" | "want" },
) {
  const user = await getCurrentUser();
  const { groupId, ref: r } = swipeSchema.parse(input);
  await upsertWatchlist(user.id, groupId, r, interest.parse(input.interest));
}

/** Left: no. Starts as "inte nu"; the reason chips can change it. */
export async function swipeLeft(input: {
  sessionId: string;
  ref: Ref;
}): Promise<Undo> {
  const user = await getCurrentUser();
  const sessionId = uuid.parse(input.sessionId);
  const r = ref.parse(input.ref);
  const id = await logInteraction(user.id, sessionId, r, "left", "not_now");
  return { ref: r, sessionId, interactionIds: [id], watchlist: [] };
}

/** Down: "Vet inte". No opinion yet; hidden for 7 days like "inte nu". */
export async function swipeDown(input: {
  sessionId: string;
  ref: Ref;
}): Promise<Undo> {
  const user = await getCurrentUser();
  const sessionId = uuid.parse(input.sessionId);
  const r = ref.parse(input.ref);
  const id = await logInteraction(user.id, sessionId, r, "unsure");
  return { ref: r, sessionId, interactionIds: [id], watchlist: [] };
}

const groupsSchema = z.object({
  sessionId: uuid,
  ref,
  fromGroupId: uuid,
  groupIds: z.array(uuid).min(1).max(10),
});

/**
 * "Med annan grupp" on the toast after a right swipe: the title ends up on the
 * lists of the chosen groups instead. Returns the undo for the groups touched.
 */
export async function setListGroups(
  input: z.infer<typeof groupsSchema>,
): Promise<Undo> {
  const user = await getCurrentUser();
  const {
    sessionId,
    ref: r,
    fromGroupId,
    groupIds,
  } = groupsSchema.parse(input);
  const owned = new Set((await getGroups()).map((g) => g.id));
  const targets = [...new Set(groupIds)].filter((id) => owned.has(id));
  const touched = [...new Set([fromGroupId, ...targets])];

  const prev = await Promise.all(
    touched.map((g) => currentInterest(user.id, g, r)),
  );
  const supabase = await createClient();
  for (const g of touched) {
    if (targets.includes(g)) {
      await upsertWatchlist(user.id, g, r, prev[touched.indexOf(g)] ?? "maybe");
    } else {
      const { error } = await supabase.from("watchlist").delete().match({
        user_id: user.id,
        group_id: g,
        tmdb_id: r.tmdb_id,
        media_type: r.media_type,
      });
      if (error) throw error;
    }
  }
  return {
    ref: r,
    sessionId,
    interactionIds: [],
    watchlist: touched.map((g, i) => ({ group_id: g, prev: prev[i] })),
  };
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
  sessionId: uuid,
  groupId: uuid,
  ref,
  rating: z
    .union([z.literal(-1), z.literal(1), z.literal(2), z.literal(3)])
    .nullable(),
  rewatchGroupIds: z.array(uuid).max(10),
});

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
      .select("times_seen, last_seen_approx")
      .match(match)
      .maybeSingle(),
  ]);
  if (prevRating.error) throw prevRating.error;
  if (prevLog.error) throw prevLog.error;

  const id = await logInteraction(user.id, s.sessionId, s.ref, "seen");
  const undo: Undo = {
    ref: s.ref,
    sessionId: s.sessionId,
    interactionIds: [id],
    watchlist: [],
    watchLog: { prev: prevLog.data ?? null },
  };

  const { error: logError } = await supabase.from("watch_log").upsert(match, {
    onConflict: "user_id,tmdb_id,media_type",
    ignoreDuplicates: true,
  });
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

  const groups = new Set((await getGroups()).map((g) => g.id));
  for (const groupId of s.rewatchGroupIds.filter((g) => groups.has(g))) {
    undo.watchlist.push({
      group_id: groupId,
      prev: await currentInterest(user.id, groupId, s.ref),
    });
    await upsertWatchlist(user.id, groupId, s.ref, "rewatch");
  }

  return undo;
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

/** Logs that the card was opened and returns the trailer, fetched on demand. */
export async function openDetail(input: {
  sessionId: string;
  ref: Ref;
}): Promise<{ trailerKey: string | null }> {
  const user = await getCurrentUser();
  const sessionId = uuid.parse(input.sessionId);
  const r = ref.parse(input.ref);
  const [trailerKey] = await Promise.all([
    getTrailerKey(r.media_type, r.tmdb_id).catch(() => null),
    logInteraction(user.id, sessionId, r, "open_detail"),
  ]);
  return { trailerKey };
}
