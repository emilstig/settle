"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/deck";
import {
  loadMore,
  openDetail,
  recordSeen,
  setInterest,
  setLeftReason,
  startSession,
  swipeLeft,
  swipeRight,
  undoSwipe,
  type Undo,
} from "../find-actions";
import { DetailView } from "./detail-view";
import { SeenSheet, type SeenAnswers } from "./seen-sheet";
import { StartView } from "./start-view";
import { CardFace, SwipeCard, type Dir, type SwipeCardHandle } from "./swipe-card";
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
const merge = (a: Undo | null, b: Undo | null): Undo | null =>
  !a ? b : !b ? a : { ...b, interactionIds: [...a.interactionIds, ...b.interactionIds], watchlist: [...a.watchlist, ...b.watchlist] };

export function Finder({ groups, footer }: { groups: GroupOption[]; footer: React.ReactNode }) {
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
  const [seen, setSeen] = useState<{ card: Card; resolve: (u: Undo | null) => void } | null>(null);
  const [detail, setDetail] = useState<{ card: Card; fromDeck: boolean; trailer: string | null; loading: boolean } | null>(null);
  const loadingMore = useRef(false);
  const cardRef = useRef<SwipeCardHandle>(null);
  const toastId = useRef(0);

  const showToast = useCallback((text: string, buttons: ToastButton[] = [], ms = 2200, onTimeout?: () => void) => {
    setToast({ id: ++toastId.current, text, buttons, ms, onTimeout });
  }, []);
  const closeToast = useCallback(() => setToast(null), []);

  // ---- session ------------------------------------------------------------

  async function start(useMood: boolean) {
    setStarting(true);
    setError(null);
    try {
      const picks = useMood ? [...quickPicks] : [];
      const text = useMood ? mood : "";
      const res = await startSession({ groupId, quickPicks: picks, moodText: text });
      const group = groups.find((g) => g.id === groupId);
      setSession({
        id: res.sessionId,
        groupId,
        cards: res.cards,
        page: res.page,
        hasMore: res.hasMore,
        label: [group?.name, ...picks.map((p) => p.toLowerCase())].filter(Boolean).join(" · "),
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
    loadMore({ sessionId: session.id, page: session.page + 1, skip: session.cards.map(keyOf) })
      .then((res) =>
        setSession((s) =>
          s && s.id === res.sessionId
            ? { ...s, cards: [...s.cards, ...res.cards], page: res.page, hasMore: res.hasMore && res.cards.length >= 0 }
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

  function replaceTop(update: (u: Promise<Undo | null>) => Promise<Undo | null>) {
    setHistory((h) => (h.length ? [...h.slice(0, -1), { ...h[h.length - 1], undo: update(h[h.length - 1].undo) }] : h));
  }

  function openSeen(c: Card): Promise<Undo | null> {
    return new Promise((resolve) => setSeen({ card: c, resolve }));
  }

  function handleSwipe(dir: Dir) {
    if (!session || !card) return;
    const c = card;
    const at = index;
    setIndex((i) => i + 1);
    const base = { sessionId: session.id, groupId: session.groupId, ref: refOf(c) };

    if (dir === "right") {
      const undo = swipeRight(base).catch(() => null);
      push({ index: at, undo });
      showToast("Sparad i listan", [
        { label: "Vill gärna", onClick: () => void undo.then(() => setInterest({ ...base, interest: "want" })) },
      ]);
    } else if (dir === "left") {
      const undo = swipeLeft({ sessionId: session.id, ref: refOf(c) }).catch(() => null);
      push({ index: at, undo });
      const reason = (r: "not_for_me" | "seen") =>
        undo.then((u) => u && setLeftReason({ interactionId: u.interactionIds[0], reason: r }));
      showToast("Varför inte?", [
        { label: "Inte nu", onClick: () => {} },
        { label: "Inte min grej", onClick: () => void reason("not_for_me") },
        {
          label: "Sett den",
          onClick: () => {
            void reason("seen");
            replaceTop((prev) => Promise.all([prev, openSeen(c)]).then(([a, b]) => merge(a, b)));
          },
        },
      ]);
    } else {
      push({ index: at, undo: openSeen(c) });
    }
  }

  async function finishSeen(answers: SeenAnswers) {
    if (!seen || !session) return;
    const { card: c, resolve } = seen;
    setSeen(null);
    try {
      resolve(await recordSeen({ sessionId: session.id, groupId: session.groupId, ref: refOf(c), ...answers }));
      showToast(answers.rating !== null ? "Betyget är sparat" : "Markerad som sett", [], 1600);
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
      if (detail || seen || (e.target as HTMLElement).tagName === "INPUT") return;
      const dir = ({ ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up" } as const)[e.key as "ArrowRight"];
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
      .then((r) => setDetail((d) => (d && d.card === c ? { ...d, trailer: r.trailerKey, loading: false } : d)))
      .catch(() => setDetail((d) => (d && d.card === c ? { ...d, loading: false } : d)));
  }

  // ---- render ---------------------------------------------------------------

  if (phase === "start" || !session) {
    return (
      <StartView
        groups={groups}
        groupId={groupId}
        onGroup={setGroupId}
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
        <button type="button" className={styles.ctx} onClick={() => setPhase("start")}>
          {session.label} ✎
        </button>
      </div>

      <div className={styles.deck}>
        {card ? (
          <>
            {next && (
              <div className={`${styles.card} ${styles.under}`} aria-hidden="true">
                <CardFace card={next} />
              </div>
            )}
            <SwipeCard key={keyOf(card)} ref={cardRef} card={card} onSwipe={handleSwipe} onTap={() => showDetail(card)} />
          </>
        ) : (
          <div className={styles.empty}>
            {session.hasMore ? (
              <p>Hämtar fler …</p>
            ) : (
              <>
                <p>Slut på förslag för det här.</p>
                <button type="button" className="primary" onClick={() => setPhase("start")}>
                  Ändra och börja om
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <p className={styles.hint}>Tryck: läs mer · Höger: vill se · Vänster: nej · Upp: sett</p>
      <div className={styles.actions}>
        {history.length > 0 && (
          <button type="button" className={styles.undo} aria-label="Ångra" onClick={undo}>
            ↶
          </button>
        )}
        <button type="button" aria-label="Nej" onClick={() => decide("left")} disabled={!card}>
          ✕
        </button>
        <button type="button" aria-label="Sett den" onClick={() => decide("up")} disabled={!card}>
          Sett
        </button>
        <button type="button" aria-label="Vill se" onClick={() => decide("right")} disabled={!card}>
          ♥
        </button>
      </div>

      <Toast key={toast?.id} toast={toast} onClose={closeToast} />

      {seen && (
        <SeenSheet
          title={seen.card.title}
          groups={groups}
          currentGroupId={session.groupId}
          onDone={finishSeen}
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
