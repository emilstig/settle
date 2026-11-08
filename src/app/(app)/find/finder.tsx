"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/deck";
import { setYoungestAge } from "../actions";
import {
  loadMore,
  openDetail,
  recordSeen,
  rewatchGroupsFor,
  setInterest,
  setLeftReason,
  setListGroups,
  startSession,
  swipeDown,
  swipeLeft,
  swipeRight,
  undoSwipe,
  type Undo,
} from "../find-actions";
import { DetailView } from "./detail-view";
import { GroupSheet } from "./group-sheet";
import { SeenSheet, type SeenAnswers } from "./seen-sheet";
import { LoadingLabel, StartView } from "./start-view";
import {
  CardFace,
  SwipeCard,
  type Dir,
  type SwipeCardHandle,
} from "./swipe-card";
import { Toast } from "./toast";
import type { GroupOption, ToastButton, ToastState } from "./types";
import styles from "./find.module.css";

type Session = {
  id: string;
  groupId: string;
  cards: Card[];
  page: number;
  hasMore: boolean;
  label: string;
};

/** One swipe that can be undone. `undo` settles once the database writes are done. */
type HistoryEntry = { index: number; undo: Promise<Undo | null> };

const keyOf = (c: Card) => `${c.media_type}:${c.tmdb_id}`;
const refOf = (c: Card) => ({ tmdb_id: c.tmdb_id, media_type: c.media_type });
/** Combines two undos for one swipe; per group the earliest snapshot wins. */
const merge = (a: Undo | null, b: Undo | null): Undo | null => {
  if (!a) return b;
  if (!b) return a;
  const known = new Set(a.watchlist.map((w) => w.group_id));
  return {
    ...b,
    ...(a.rating ? { rating: a.rating } : {}),
    ...(a.watchLog ? { watchLog: a.watchLog } : {}),
    interactionIds: [...a.interactionIds, ...b.interactionIds],
    watchlist: [
      ...a.watchlist,
      ...b.watchlist.filter((w) => !known.has(w.group_id)),
    ],
  };
};

export function Finder({
  groups: initialGroups,
  footer,
}: {
  groups: GroupOption[];
  footer: React.ReactNode;
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
    router.refresh();
  };
  const [phase, setPhase] = useState<"start" | "deck">("start");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [quickPicks, setQuickPicks] = useState<Set<string>>(new Set());
  const [mood, setMood] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [seen, setSeen] = useState<{
    card: Card;
    resolve: (u: Undo | null) => void;
    rewatch: string[];
  } | null>(null);
  const [moving, setMoving] = useState<{
    card: Card;
    resolve: (u: Undo | null) => void;
  } | null>(null);
  const [detail, setDetail] = useState<{
    card: Card;
    fromDeck: boolean;
    trailer: string | null;
    loading: boolean;
  } | null>(null);
  const loadingMore = useRef(false);
  const cardRef = useRef<SwipeCardHandle>(null);
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

  // ---- session ------------------------------------------------------------

  // One button: the mood is optional. Without it, prompt 2 picks from the
  // taste profile alone.
  async function start() {
    setStarting(true);
    setError(null);
    try {
      const picks = [...quickPicks];
      const text = mood;
      const res = await startSession({
        groupId,
        quickPicks: picks,
        moodText: text,
      });
      const group = groups.find((g) => g.id === groupId);
      setSession({
        id: res.sessionId,
        groupId,
        cards: res.cards,
        page: res.page,
        hasMore: res.hasMore,
        label: [group?.name, ...picks.map((p) => p.toLowerCase())]
          .filter(Boolean)
          .join(" · "),
      });
      setIndex(0);
      setHistory([]);
      setPhase("deck");
    } catch (e) {
      console.error(e);
      setError("Det gick inte att hämta förslag. Prova igen.");
    } finally {
      setStarting(false);
    }
  }

  // Fetch the next page when the deck runs low.
  useEffect(() => {
    if (!session || loadingMore.current || !session.hasMore) return;
    if (session.cards.length - index > 5) return;
    loadingMore.current = true;
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
                hasMore: res.hasMore && res.cards.length >= 0,
              }
            : s,
        ),
      )
      .catch((e) => {
        console.error(e);
        setSession((s) => (s ? { ...s, hasMore: false } : s));
      })
      .finally(() => {
        loadingMore.current = false;
      });
  }, [session, index]);

  const card = session?.cards[index];
  const next = session?.cards[index + 1];

  // ---- swipes ---------------------------------------------------------------

  function push(entry: HistoryEntry) {
    setHistory((h) => [...h.slice(-19), entry]);
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

  function openGroups(c: Card): Promise<Undo | null> {
    return new Promise((resolve) => setMoving({ card: c, resolve }));
  }

  async function finishGroups(groupIds: string[] | null) {
    if (!moving || !session) return;
    const { card: c, resolve } = moving;
    setMoving(null);
    if (!groupIds) return resolve(null);
    try {
      resolve(
        await setListGroups({
          sessionId: session.id,
          ref: refOf(c),
          fromGroupId: session.groupId,
          groupIds,
        }),
      );
      const names = groups
        .filter((g) => groupIds.includes(g.id))
        .map((g) => g.name);
      showToast(`Sparad för ${names.join(" och ")}`, [], 1600);
    } catch (e) {
      console.error(e);
      resolve(null);
      showToast("Det gick inte att spara", [], 2200);
    }
  }

  function openSeen(c: Card): Promise<Undo | null> {
    return new Promise((resolve) => {
      // Show where it is already on the se igen list before asking.
      rewatchGroupsFor(refOf(c))
        .catch(() => [] as string[])
        .then((rewatch) => setSeen({ card: c, resolve, rewatch }));
    });
  }

  function handleSwipe(dir: Dir) {
    if (!session || !card) return;
    const c = card;
    const at = index;
    setIndex((i) => i + 1);
    const base = {
      sessionId: session.id,
      groupId: session.groupId,
      ref: refOf(c),
    };
    const group = groups.find((g) => g.id === session.groupId);

    if (dir === "right") {
      const undo = swipeRight(base).catch(() => null);
      push({ index: at, undo });
      showToast(
        group?.kind === "solo"
          ? "Sparad i din lista"
          : `Sparad för ${group?.name}`,
        [
          {
            label: "Vill gärna",
            onClick: () =>
              void undo.then(() => setInterest({ ...base, interest: "want" })),
          },
          {
            label: "Med annan grupp",
            onClick: () =>
              replaceTop((prev) =>
                prev.then((a) => openGroups(c).then((b) => merge(a, b))),
              ),
          },
        ],
      );
    } else if (dir === "left") {
      const undo = swipeLeft({ sessionId: session.id, ref: refOf(c) }).catch(
        () => null,
      );
      push({ index: at, undo });
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
      const undo = swipeDown({ sessionId: session.id, ref: refOf(c) }).catch(
        () => null,
      );
      push({ index: at, undo });
      showToast("Vet inte · visas igen om en vecka", [], 1400);
    } else {
      push({ index: at, undo: openSeen(c) });
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
          ...answers,
        }),
      );
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
    setMoving((m) => {
      m?.resolve(null);
      return null;
    });
    setIndex(last.index);
    const u = await last.undo;
    if (u) await undoSwipe(u).catch((e) => console.error(e));
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

  function showDetail(c: Card) {
    if (!session) return;
    setDetail({ card: c, fromDeck: true, trailer: null, loading: true });
    openDetail({ sessionId: session.id, ref: refOf(c) })
      .then((r) =>
        setDetail((d) =>
          d && d.card === c
            ? { ...d, trailer: r.trailerKey, loading: false }
            : d,
        ),
      )
      .catch(() =>
        setDetail((d) => (d && d.card === c ? { ...d, loading: false } : d)),
      );
  }

  // ---- render ---------------------------------------------------------------

  if (phase === "start" || !session) {
    return (
      <StartView
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
        onStart={start}
        loading={starting}
        error={error}
        footer={footer}
      />
    );
  }

  return (
    <div className={styles.swipe}>
      <div className={styles.bar}>
        <button type="button" className={styles.ctx} onClick={backToStart}>
          {session.label} ✎
        </button>
      </div>

      <div className={styles.deck}>
        {card ? (
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
            {session.hasMore ? (
              <p>
                <LoadingLabel />
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

      <p className={styles.hint}>
        Höger: vill se · Vänster: inte nu · Upp: sett · Ner: vet inte
      </p>
      <div className={styles.actions}>
        {history.length > 0 && (
          <button
            type="button"
            className={styles.undo}
            aria-label="Ångra"
            onClick={undo}
          >
            ↶
          </button>
        )}
        <button
          type="button"
          aria-label="Inte nu"
          onClick={() => decide("left")}
          disabled={!card}
        >
          ✕
        </button>
        <button
          type="button"
          aria-label="Vet inte"
          onClick={() => decide("down")}
          disabled={!card}
        >
          ?
        </button>
        <button
          type="button"
          aria-label="Sett den"
          onClick={() => decide("up")}
          disabled={!card}
        >
          Sett
        </button>
        <button
          type="button"
          aria-label="Vill se"
          onClick={() => decide("right")}
          disabled={!card}
        >
          ♥
        </button>
      </div>

      <Toast key={toast?.id} toast={toast} onClose={closeToast} />

      {seen && (
        <SeenSheet
          title={seen.card.title}
          groups={groups}
          onDone={finishSeen}
          rewatchGroupIds={seen.rewatch}
        />
      )}

      {moving && (
        <GroupSheet
          title={moving.card.title}
          groups={groups}
          currentGroupId={session.groupId}
          onDone={finishGroups}
        />
      )}

      {detail && (
        <DetailView
          card={detail.card}
          trailerKey={detail.trailer}
          trailerLoading={detail.loading}
          fromDeck={detail.fromDeck && detail.card === card}
          onClose={() => setDetail(null)}
          onDecide={(dir) => {
            setDetail(null);
            void decide(dir);
          }}
        />
      )}
    </div>
  );
}
