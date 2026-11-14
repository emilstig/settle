"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/deck";
import { setYoungestAge } from "../actions";
import {
  addToTonight,
  chooseTonight,
  clearTonight,
  removeFromTonight,
  restoreToTonight,
  loadMore,
  openDetail,
  recordSeen,
  saveForGroups,
  rewatchGroupsFor,
  setLeftReason,
  startSession,
  swipeDown,
  swipeLeft,
  swipeRight,
  tonight,
  undoSwipe,
  type Undo,
} from "../find-actions";
import { ChosenView, TonightSheet } from "./tonight-sheet";
import { DetailView } from "./detail-view";
import { GroupSheet } from "./group-sheet";
import { FlyToTonight } from "./fly-to-tonight";
import { SeenSheet, type SeenAnswers } from "./seen-sheet";
import { LoadingLabel, StartView } from "./start-view";
import {
  CardFace,
  SwipeCard,
  type Dir,
  type SwipeCardHandle,
} from "./swipe-card";
import { Toast } from "./toast";
import { useBackClose } from "./use-back-close";
import {
  useDeckMemory,
  type DeckSession as Session,
  type HistoryEntry,
} from "./deck-memory";
import {
  BackIcon,
  DECISION_ORDER,
  DECISION_WORD,
  DecisionIcon,
  UndoIcon,
} from "./decision-icons";
import { AppHeader, GroupName, GroupPicker } from "./group-picker";
import { CheckInBell } from "../check-in-bell";
import { FIND_AGAIN } from "@/components/tab-bar/tab-bar";
import { readGroup, rememberGroup } from "@/lib/group-cookie";
import { eveningStart } from "@/lib/evening";
import type { GroupOption, ToastButton, ToastState } from "./types";
import styles from "./find.module.css";

const keyOf = (c: Card) => `${c.media_type}:${c.tmdb_id}`;
const refOf = (c: Card) => ({ tmdb_id: c.tmdb_id, media_type: c.media_type });

/** The gesture hint under the deck shows until this many swipes in Hitta. */
const HINT_SWIPES = 10;
const HINT_KEY = "settle_swipes";
function readSwipes(): number {
  try {
    return Number(window.localStorage.getItem(HINT_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** The line under the header when prompt 1 gave no heading. */
function moodLabel(picks: string[], text: string): string | null {
  const t = text.trim();
  const p = picks.map((x) => x.toLowerCase());
  const parts = t ? [`”${t}”`, ...p] : p;
  if (!parts.length) return null;
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function Finder({
  groups: initialGroups,
  initialGroupId,
  belowStart,
}: {
  groups: GroupOption[];
  /** The group chosen last, in Hitta or Att se. */
  initialGroupId?: string;
  belowStart?: React.ReactNode;
}) {
  const [groups, setGroups] = useState(initialGroups);
  const router = useRouter();
  // Fresh counts from the server after returning to the start view.
  const [lastInitial, setLastInitial] = useState(initialGroups);
  if (lastInitial !== initialGroups) {
    setLastInitial(initialGroups);
    setGroups(initialGroups);
  }
  const backToStart = () => {
    setPhase("start");
    setTonightVersion((v) => v + 1);
    router.refresh();
  };
  // The back arrow, the back gesture and Hitta tapped again: the start view
  // with the mood cleared.
  const leaveDeck = () => {
    setMood("");
    setQuickPicks(new Set());
    setToast(null);
    backToStart();
  };

  // Hitta as it was left this evening, after a look at another tab.
  const memory = useDeckMemory();
  const [restored] = useState(() => {
    const deck = memory.read();
    // Group ids are the account's own: a deck with other groups was left by
    // another account in this browser and is dropped.
    const mine = (id: string) => initialGroups.some((g) => g.id === id);
    return deck &&
      deck.evening === eveningStart() &&
      mine(deck.groupId) &&
      (!deck.session || mine(deck.session.groupId))
      ? deck
      : null;
  });
  const [phase, setPhase] = useState<"start" | "deck" | "chosen">(
    restored?.phase ?? "start",
  );
  // The cookie first: Att se may have changed the group since this page
  // was rendered.
  const [arrivedWith] = useState(() => {
    const id = readGroup();
    return id && initialGroups.some((g) => g.id === id) ? id : initialGroupId;
  });
  const [groupId, setGroupIdState] = useState(
    arrivedWith ?? restored?.groupId ?? groups[0]?.id ?? "",
  );
  // The group is shared with Att se, so it is remembered for that tab too.
  const setGroupId = (id: string) => {
    setGroupIdState(id);
    rememberGroup(id);
  };
  const [quickPicks, setQuickPicks] = useState<Set<string>>(
    () => new Set(restored?.quickPicks ?? []),
  );
  const [mood, setMood] = useState(restored?.mood ?? "");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [session, setSession] = useState<Session | null>(
    restored?.session ?? null,
  );
  const [index, setIndex] = useState(restored?.index ?? 0);
  const [history, setHistory] = useState<HistoryEntry[]>(
    restored?.history ?? [],
  );
  const [swipes, setSwipes] = useState(() =>
    typeof window === "undefined" ? 0 : readSwipes(),
  );
  const [toast, setToast] = useState<ToastState | null>(null);
  const [seen, setSeen] = useState<{
    card: Card;
    resolve: (u: Undo | null) => void;
    rewatch: string[];
  } | null>(null);
  // "Spara för annan grupp" from the deck's detail view.
  const [moving, setMoving] = useState<Card | null>(null);
  const [detail, setDetail] = useState<{
    card: Card;
    /** Where it was opened, which decides the button bar. */
    from: "deck" | "tonight" | "chosen";
    trailer: string | null;
    imdbId: string | null;
    rtPath: string | null;
    loading: boolean;
  } | null>(null);
  // Tonight belongs to the evening and the group: saved titles and the choice
  // survive starting over.
  const [tonightSaved, setTonightSaved] = useState<Card[]>([]);
  const [tonightChoice, setTonightChoice] = useState<Card | null>(null);
  // "Ikväll · N" in Att se lands here with the sheet open.
  const [tonightOpen, setTonightOpen] = useState(false);
  // Bumped to read tonight from the server again, e.g. when starting over.
  const [tonightVersion, setTonightVersion] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const loadingMore = useRef(false);
  const cardRef = useRef<SwipeCardHandle>(null);
  // A poster flying to "Ikväll · N" after a save.
  const [flight, setFlight] = useState<{ card: Card; id: number } | null>(
    null,
  );
  const deckRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const flightId = useRef(0);
  const flyToTonight = (c: Card) =>
    setFlight({ card: c, id: ++flightId.current });
  const toastId = useRef(0);

  const showToast = useCallback(
    (
      text: string,
      buttons: ToastButton[] = [],
      ms = 2200,
      onTimeout?: () => void,
    ) => {
      setToast({ id: ++toastId.current, text, buttons, ms, onTimeout });
    },
    [],
  );
  const closeToast = useCallback(() => setToast(null), []);

  // ---- tonight -------------------------------------------------------------

  useEffect(() => {
    let alive = true;
    tonight({ groupId })
      .then((t) => {
        if (!alive) return;
        setTonightSaved(t.saved);
        setTonightChoice(t.choice);
      })
      .catch((e) => console.error(e));
    return () => {
      alive = false;
    };
  }, [groupId, tonightVersion]);

  // Tonight is the user's own shortlist: what was saved tonight, latest
  // first. Top picks join it when swiped right. A choice made from the
  // detail view without a right swipe is on it too, so it can be found
  // again after starting over.
  const tonightItems =
    tonightChoice &&
    !tonightSaved.some((x) => keyOf(x) === keyOf(tonightChoice))
      ? [tonightChoice, ...tonightSaved]
      : tonightSaved;

  async function removeTonight(c: Card) {
    const k = keyOf(c);
    const was = { saved: tonightSaved, choice: tonightChoice };
    const group = session?.groupId ?? groupId;
    const restoreLocal = () => {
      setTonightSaved(was.saved);
      setTonightChoice(was.choice);
    };
    setTonightSaved((saved) => saved.filter((x) => keyOf(x) !== k));
    if (tonightChoice && keyOf(tonightChoice) === k) setTonightChoice(null);
    try {
      const removal = await removeFromTonight({
        groupId: group,
        ref: refOf(c),
      });
      if (!removal) return;
      // Gone until tomorrow with the group, so a slip needs a way back.
      showToast(
        "Borttagen från ikväll",
        [
          {
            label: "Ångra",
            onClick: () => {
              restoreLocal();
              restoreToTonight({
                groupId: group,
                ref: refOf(c),
                ...removal,
              }).catch((e) => {
                console.error(e);
                setTonightVersion((v) => v + 1);
              });
            },
          },
        ],
        4000,
      );
    } catch (e) {
      console.error(e);
      restoreLocal();
      showToast("Det gick inte att ta bort", [], 2200);
    }
  }

  async function choose(c: Card) {
    setChoosing(true);
    try {
      await chooseTonight({
        groupId: session?.groupId ?? groupId,
        sessionId: session?.id,
        ref: refOf(c),
      });
      setTonightChoice(c);
      setTonightOpen(false);
      setDetail(null);
      setToast(null);
      setPhase("chosen");
    } catch (e) {
      console.error(e);
      showToast("Det gick inte att spara valet", [], 2200);
    } finally {
      setChoosing(false);
    }
  }

  async function changeChoice() {
    setChoosing(true);
    try {
      await clearTonight({ groupId: session?.groupId ?? groupId });
      setTonightChoice(null);
      setPhase(session ? "deck" : "start");
    } catch (e) {
      console.error(e);
    } finally {
      setChoosing(false);
    }
  }

  // ---- session ------------------------------------------------------------

  // One button: the mood is optional. Without it, prompt 2 picks from the
  // taste profile alone.
  /**
   * `forGroup` starts a new deck for another group with the same mood, when
   * the group is changed in the deck or in Att se.
   */
  async function start(forGroup?: string) {
    const group = forGroup ?? groupId;
    setStarting(true);
    setError(null);
    try {
      const picks = [...quickPicks];
      const text = mood;
      const res = await startSession({
        groupId: group,
        quickPicks: picks,
        moodText: text,
      });
      setSession({
        id: res.sessionId,
        groupId: group,
        cards: res.cards,
        page: res.page,
        hasMore: res.hasMore,
        loadFailedAt: null,
        label: res.label || moodLabel(picks, text),
      });
      setIndex(0);
      setHistory([]);
      setPhase("deck");
    } catch (e) {
      console.error(e);
      setError("Det gick inte att hämta förslag. Prova igen.");
      if (forGroup) setPhase("start");
    } finally {
      setStarting(false);
    }
  }

  // Keep Hitta for when the user comes back from another tab.
  useEffect(() => {
    memory.save({
      evening: eveningStart(),
      phase,
      groupId,
      session,
      index,
      history,
      quickPicks: [...quickPicks],
      mood,
    });
  }, [memory, phase, groupId, session, index, history, quickPicks, mood]);

  // Back from Att se with another group: a new deck for it, same mood.
  // Runs on arrival and each time Hitta is shown again, since the router
  // keeps the page alive (hidden) while another tab is open.
  useEffect(() => {
    const t = setTimeout(() => {
      // "Ikväll · N" in Att se lands here with the sheet open.
      if (memory.wantsTonight()) {
        memory.clearTonight();
        setTonightOpen(true);
      }
      const id = readGroup();
      if (!id || !groups.some((g) => g.id === id)) return;
      if (id !== groupId) setGroupIdState(id);
      if (phase === "deck" && session && session.groupId !== id) {
        const name = groups.find((g) => g.id === id)?.name;
        void start(id);
        if (name) showToast(`Nya förslag för ${name}`, [], 2200);
      }
    }, 0);
    return () => clearTimeout(t);
    // On arrival and on being shown again, not on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hitta tapped again while in Hitta.
  useEffect(() => {
    const onAgain = () => leaveDeck();
    window.addEventListener(FIND_AGAIN, onAgain);
    return () => window.removeEventListener(FIND_AGAIN, onAgain);
  });

  // Fetch the next page when the deck runs low. A failure (often TMDB having
  // a bad minute) does not end the deck: it is tried again after the next
  // swipe, or with the button when the deck is empty.
  useEffect(() => {
    if (!session || starting || loadingMore.current || !session.hasMore)
      return;
    if (session.cards.length - index > 5) return;
    if (session.loadFailedAt !== null && index <= session.loadFailedAt) return;
    loadingMore.current = true;
    const at = index;
    loadMore({
      sessionId: session.id,
      page: session.page + 1,
      skip: session.cards.map(keyOf),
    })
      .then((res) =>
        setSession((s) =>
          s && s.id === res.sessionId
            ? {
                ...s,
                cards: [...s.cards, ...res.cards],
                page: res.page,
                hasMore: res.hasMore,
                loadFailedAt: null,
              }
            : s,
        ),
      )
      .catch((e) => {
        console.error(e);
        setSession((s) =>
          s && s.id === session.id ? { ...s, loadFailedAt: at } : s,
        );
      })
      .finally(() => {
        loadingMore.current = false;
      });
  }, [session, index, starting]);

  const retryLoad = () =>
    setSession((s) => (s ? { ...s, loadFailedAt: null } : s));

  const card = session?.cards[index];
  const next = session?.cards[index + 1];

  // ---- swipes ---------------------------------------------------------------

  function push(entry: Omit<HistoryEntry, "dir" | "key">, dir: Dir, c: Card) {
    setHistory((h) => [...h.slice(-19), { ...entry, dir, key: keyOf(c) }]);
    if (dir === "right") {
      setTonightSaved((saved) => [
        c,
        ...saved.filter((x) => keyOf(x) !== keyOf(c)),
      ]);
      flyToTonight(c);
    }
  }

  function replaceTop(
    update: (u: Promise<Undo | null>) => Promise<Undo | null>,
  ) {
    setHistory((h) =>
      h.length
        ? [
            ...h.slice(0, -1),
            { ...h[h.length - 1], undo: update(h[h.length - 1].undo) },
          ]
        : h,
    );
  }

  function openSeen(c: Card): Promise<Undo | null> {
    return new Promise((resolve) => {
      // Show where it is already on the se igen list before asking.
      rewatchGroupsFor(refOf(c))
        .catch(() => [] as string[])
        .then((rewatch) =>
          setSeen({
            card: c,
            resolve,
            rewatch,
          }),
        );
    });
  }

  function handleSwipe(dir: Dir) {
    if (!session || !card) return;
    const c = card;
    const at = index;
    setIndex((i) => i + 1);
    // The gesture hint goes once the user has swiped a few cards.
    setSwipes((n) => {
      const next = n + 1;
      try {
        window.localStorage.setItem(HINT_KEY, String(next));
      } catch {
        // Private mode: the hint just stays.
      }
      return next;
    });
    const base = {
      sessionId: session.id,
      groupId: session.groupId,
      ref: refOf(c),
      source: c.source,
    };
    const group = groups.find((g) => g.id === session.groupId);

    if (dir === "right") {
      const undo = swipeRight(base).catch(() => null);
      push({ index: at, undo }, dir, c);
      // One chip only: the rest is not a decision for now, and can be done
      // later in Att se.
      showToast(
        group?.kind === "solo"
          ? "Sparad till ikväll"
          : `Sparad till ikväll med ${group?.name}`,
        [{ label: "Välj den här", onClick: () => void choose(c) }],
        2500,
      );
    } else if (dir === "left") {
      const undo = swipeLeft({
        sessionId: session.id,
        ref: refOf(c),
        source: c.source,
      }).catch(() => null);
      push({ index: at, undo }, dir, c);
      // "Inte nu" is the default. The chip applies in this group only, so the
      // words follow the company. "Sett" is the up swipe, so it has no chip.
      showToast("Inte nu", [
        {
          label: group?.kind === "solo" ? "Inte min grej" : "Inte vår grej",
          onClick: () =>
            void undo.then(
              (u) =>
                u &&
                setLeftReason({
                  interactionId: u.interactionIds[0],
                  reason: "not_for_me",
                }),
            ),
        },
      ]);
    } else if (dir === "down") {
      // "Kanske": on the group's list, but not in Ikväll.
      const undo = swipeDown(base).catch(() => null);
      push({ index: at, undo }, dir, c);
      showToast(
        group?.kind === "solo"
          ? "Sparad till en annan kväll"
          : `Sparad till en annan kväll med ${group?.name}`,
        [],
        2000,
      );
    } else {
      push({ index: at, undo: openSeen(c) }, dir, c);
    }
  }

  async function finishSeen(answers: SeenAnswers) {
    if (!seen || !session) return;
    const { card: c, resolve } = seen;
    setSeen(null);
    try {
      resolve(
        await recordSeen({
          sessionId: session.id,
          groupId: session.groupId,
          ref: refOf(c),
          source: c.source,
          ...answers,
        }),
      );
      // Seen and wanted again with this group: on the list as "se igen",
      // which is about some evening, not tonight. "Vill se" adds it to
      // Ikväll, like the right swipe, and "Ångra" takes that back too.
      if (answers.rewatchGroupIds?.includes(session.groupId)) {
        const group = groups.find((g) => g.id === session.groupId);
        const groupId = session.groupId;
        showToast(
          group?.kind === "solo"
            ? "Sparad att se om"
            : `Sparad att se om med ${group?.name}`,
          [
            {
              label: "Vill se",
              onClick: () => {
                setTonightSaved((saved) => [
                  c,
                  ...saved.filter((x) => keyOf(x) !== keyOf(c)),
                ]);
                flyToTonight(c);
                const added = addToTonight({ groupId, ref: refOf(c) });
                replaceTop((prev) =>
                  Promise.all([prev, added]).then(([u, id]) =>
                    u ? { ...u, interactionIds: [...u.interactionIds, id] } : u,
                  ),
                );
                added.catch((e) => {
                  console.error(e);
                  setTonightSaved((saved) =>
                    saved.filter((x) => keyOf(x) !== keyOf(c)),
                  );
                  showToast("Det gick inte att spara", [], 2200);
                });
              },
            },
          ],
          2500,
        );
        return;
      }
      showToast(
        answers.rating !== null ? "Betyget är sparat" : "Markerad som sett",
        [],
        1600,
      );
    } catch (e) {
      console.error(e);
      resolve(null);
      showToast("Det gick inte att spara", [], 2200);
    }
  }

  async function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setToast(null);
    setSeen((s) => {
      s?.resolve(null);
      return null;
    });
    setIndex(last.index);
    if (last.dir === "right" || last.dir === "up") {
      setTonightSaved((saved) => saved.filter((x) => keyOf(x) !== last.key));
    }
    const u = await last.undo;
    if (u) await undoSwipe(u).catch((e) => console.error(e));
  }

  /**
   * "Spara för annan grupp": the card leaves the deck as if swiped, onto the
   * chosen groups' lists. With this group among them it is a right swipe and
   * joins Ikväll.
   */
  function finishGroups(groupIds: string[] | null) {
    const c = moving;
    setMoving(null);
    if (!groupIds || !c || !session || card !== c) return;
    setDetail(null);
    const at = index;
    setIndex((i) => i + 1);
    const withThis = groupIds.includes(session.groupId);
    const undo = saveForGroups({
      sessionId: session.id,
      groupId: session.groupId,
      ref: refOf(c),
      source: c.source,
      groupIds,
    }).catch((e) => {
      console.error(e);
      showToast("Det gick inte att spara", [], 2200);
      return null;
    });
    push({ index: at, undo }, withThis ? "right" : "left", c);
    const names = groups
      .filter((g) => groupIds.includes(g.id))
      .map((g) => g.name)
      .join(" och ");
    showToast(
      `Sparad för ${names}`,
      withThis ? [{ label: "Välj den här", onClick: () => void choose(c) }] : [],
      2500,
    );
  }

  async function decide(dir: Dir) {
    if (!card) return;
    await cardRef.current?.fly(dir);
    handleSwipe(dir);
  }

  // Arrow keys on the deck.
  useEffect(() => {
    if (phase !== "deck") return;
    const onKey = (e: KeyboardEvent) => {
      if (
        detail ||
        seen ||
        moving ||
        (e.target as HTMLElement).tagName === "INPUT"
      )
        return;
      const dir = (
        {
          ArrowRight: "right",
          ArrowLeft: "left",
          ArrowUp: "up",
          ArrowDown: "down",
        } as const
      )[e.key as "ArrowRight"];
      if (dir) {
        e.preventDefault();
        void decide(dir);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- detail ---------------------------------------------------------------

  function showDetail(c: Card, from: "deck" | "tonight" | "chosen" = "deck") {
    if (from === "deck" && !session) return;
    setDetail({
      card: c,
      from,
      trailer: null,
      imdbId: null,
      rtPath: null,
      loading: true,
    });
    // Only cards in the deck have a source; opening it from Ikväll is not
    // a reaction to where the card came from. The session is the current
    // one for the group, if any.
    const sessionId =
      session && session.groupId === groupId ? session.id : null;
    openDetail({
      sessionId,
      ref: refOf(c),
      source: from === "deck" ? c.source : null,
    })
      .then((r) =>
        setDetail((d) =>
          d && d.card === c
            ? {
                ...d,
                trailer: r.trailerKey,
                imdbId: r.imdbId,
                rtPath: r.rtPath,
                loading: false,
              }
            : d,
        ),
      )
      .catch(() =>
        setDetail((d) => (d && d.card === c ? { ...d, loading: false } : d)),
      );
  }

  // ---- render ---------------------------------------------------------------

  // Själv says "du"; any other group watches together and says "ni".
  const together =
    groups.find((g) => g.id === (session?.groupId ?? groupId))?.kind !== "solo";
  // The phone's back gesture closes the top layer, not the page.
  useBackClose(tonightOpen, () => setTonightOpen(false));
  useBackClose(detail !== null, () => setDetail(null));
  useBackClose(moving !== null, () => setMoving(null));
  // The deck is a layer over the start view: back goes to the start view.
  useBackClose(phase === "deck", leaveDeck, { keepOnUnmount: true });

  const detailView = detail && (
    <DetailView
      card={detail.card}
      trailerKey={detail.trailer}
      imdbId={detail.imdbId}
      rtPath={detail.rtPath}
      trailerLoading={detail.loading}
      actions={
        detail.from === "deck"
          ? detail.card === card
            ? "deck"
            : "choose"
          : detail.from === "tonight"
            ? "choose"
            : "none"
      }
      chosen={
        tonightChoice !== null && keyOf(tonightChoice) === keyOf(detail.card)
      }
      onClose={() => setDetail(null)}
      onDecide={(dir) => {
        setDetail(null);
        void decide(dir);
      }}
      onChoose={() => void choose(detail.card)}
      groupsRow={
        detail.from === "deck" && detail.card === card && groups.length > 1
          ? {
              label: "Spara för en annan grupp",
              onClick: () => setMoving(detail.card),
            }
          : undefined
      }
    />
  );

  const sheet = tonightOpen && (
    <TonightSheet
      items={tonightItems}
      chosen={tonightChoice}
      busy={choosing}
      onChoose={(c) => void choose(c)}
      onRemove={(c) => void removeTonight(c)}
      onOpen={(c) => showDetail(c, "tonight")}
      onClose={() => setTonightOpen(false)}
      together={together}
    />
  );

  const tonightButton = tonightItems.length > 0 && (
    <button
      ref={chipRef}
      type="button"
      className={styles.tonightChip}
      onClick={() => setTonightOpen(true)}
    >
      Ikväll · {tonightItems.length}
    </button>
  );
  // The tab's header has the clock too; the deck's only Ikväll.
  const tabRight = (
    <>
      {tonightButton}
      <CheckInBell />
    </>
  );
  const picker = (
    <GroupPicker
      groups={groups}
      groupId={groupId}
      onGroup={setGroupId}
      onAge={(id, age) => {
        setGroups((gs) =>
          gs.map((g) => (g.id === id ? { ...g, youngest_age: age } : g)),
        );
        setYoungestAge({ groupId: id, age }).catch((e) => {
          console.error(e);
          setError("Det gick inte att spara åldern. Prova igen.");
        });
      }}
      title="Vem tittar ikväll?"
      soloTitle="Hitta"
    />
  );

  if (phase === "chosen" && tonightChoice) {
    return (
      <>
        <AppHeader right={tabRight}>{picker}</AppHeader>
        <ChosenView
          card={tonightChoice}
          busy={choosing}
          onChange={() => void changeChoice()}
          onDone={backToStart}
          onOpen={() => showDetail(tonightChoice, "chosen")}
        />
        {sheet}
        {detailView}
      </>
    );
  }

  if (phase === "start" || !session) {
    return (
      <>
        <AppHeader right={tabRight}>{picker}</AppHeader>
        <StartView
          tonightChoice={tonightChoice}
          onOpenChoice={() => setPhase("chosen")}
          together={together}
          quickPicks={quickPicks}
          onToggleQuick={(q) =>
            setQuickPicks((s) => {
              const n = new Set(s);
              if (n.has(q)) n.delete(q);
              else n.add(q);
              return n;
            })
          }
          mood={mood}
          onMood={setMood}
          onStart={() => void start()}
          loading={starting}
          error={error}
          belowStart={belowStart}
        />
        {sheet}
        {detailView}
        <Toast key={toast?.id} toast={toast} onClose={closeToast} />
      </>
    );
  }

  return (
    <div className={styles.swipe}>
      <AppHeader
        right={tonightButton}
        under={
          session.label && (
            <p className={styles.moodLine}>{session.label}</p>
          )
        }
      >
        {/* The arrow and the group are one back button: the deck is for
            one group, and switching is done from the start view. */}
        <button
          type="button"
          className={styles.headBackGroup}
          aria-label="Tillbaka till start"
          onClick={leaveDeck}
        >
          <span className={styles.headBackIcon}>
            <BackIcon />
          </span>
          <GroupName
            group={groups.find((g) => g.id === groupId)}
            alone={groups.length > 1 ? undefined : "Hitta"}
          />
        </button>
      </AppHeader>

      <div ref={deckRef} className={styles.deck}>
        {card && !starting ? (
          <>
            {next && (
              <div
                className={`${styles.card} ${styles.under}`}
                aria-hidden="true"
              >
                <CardFace card={next} />
              </div>
            )}
            <SwipeCard
              key={keyOf(card)}
              ref={cardRef}
              card={card}
              onSwipe={handleSwipe}
              onTap={() => showDetail(card)}
            />
          </>
        ) : (
          <div className={styles.empty}>
            {starting ? (
              <p>
                <LoadingLabel together={together} />
              </p>
            ) : session.hasMore && session.loadFailedAt !== null ? (
              <>
                <p>Det gick inte att hämta fler förslag.</p>
                <button type="button" className="primary" onClick={retryLoad}>
                  Försök igen
                </button>
              </>
            ) : session.hasMore ? (
              <p>
                <LoadingLabel together={together} />
              </p>
            ) : (
              <>
                <p>Slut på förslag för det här.</p>
                <button type="button" className="primary" onClick={backToStart}>
                  Ändra och börja om
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {swipes < HINT_SWIPES && (
        <p className={styles.hint}>
          Höger: vill se · Vänster: inte nu · Upp: sett · Ner: kanske
        </p>
      )}
      <div className={styles.actions}>
        {history.length > 0 ? (
          <button
            type="button"
            className={styles.undo}
            aria-label="Ångra"
            onClick={undo}
          >
            <UndoIcon />
          </button>
        ) : (
          <span className={styles.undo} aria-hidden="true" />
        )}
        {DECISION_ORDER.map((d) => (
          <button
            key={d}
            type="button"
            className={d === "left" || d === "right" ? styles.big : undefined}
            aria-label={DECISION_WORD[d]}
            onClick={() => decide(d)}
            disabled={!card || starting}
          >
            <DecisionIcon dir={d} />
          </button>
        ))}
        <span className={styles.undo} aria-hidden="true" />
      </div>

      <Toast key={toast?.id} toast={toast} onClose={closeToast} />

      {flight && (
        <FlyToTonight
          key={`fly-${flight.id}`}
          card={flight.card}
          from={deckRef}
          to={chipRef}
          onDone={() =>
            setFlight((f) => (f?.id === flight.id ? null : f))
          }
        />
      )}

      {seen && (
        <SeenSheet
          title={seen.card.title}
          groups={groups}
          onDone={finishSeen}
          rewatchGroupIds={seen.rewatch}
        />
      )}

      {sheet}
      {detailView}
      {moving && (
        <GroupSheet
          title={moving.title}
          groups={groups}
          savedFor={[]}
          onDone={finishGroups}
        />
      )}
    </div>
  );
}
