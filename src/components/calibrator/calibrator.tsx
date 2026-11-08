"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Card } from "@/lib/deck";
import { CardFace, SwipeCard, type Dir, type Stamps, type SwipeCardHandle } from "@/app/(app)/find/swipe-card";
import find from "@/app/(app)/find/find.module.css";
import { finishCalibration, markNotSeen, rateCalibration, undoCalibration, type CalibrationUndo } from "./actions";
import styles from "./calibrator.module.css";

const STAMPS: Stamps = {
  right: ["Gillar", "var(--yes)"],
  up: ["Älskar", "var(--cal)"],
  left: ["Ogillade", "var(--no)"],
  down: ["Inte sett", "#555"],
};
const RATING: Partial<Record<Dir, -1 | 1 | 3>> = { left: -1, right: 1, up: 3 };
const KEYS: Record<string, Dir> = { ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down" };

/** One swipe. `write` settles with what to undo once the database write is done. */
type Step = { index: number; rated: boolean; write: Promise<CalibrationUndo | null> };

const refOf = (c: Card) => ({ tmdb_id: c.tmdb_id, media_type: c.media_type });

/** Rate well-known titles with swipes: right likes, up loves, left disliked, down not seen. */
export function Calibrator({ cards, mode }: { cards: Card[]; mode: "onboarding" | "app" }) {
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<Step[]>([]);
  const [rated, setRated] = useState(0);
  const [finishing, startFinish] = useTransition();
  const cardRef = useRef<SwipeCardHandle>(null);

  const card = cards[index];
  const next = cards[index + 1];
  const total = cards.length;

  function handleSwipe(dir: Dir) {
    if (!card) return;
    const rating = RATING[dir];
    const ref = refOf(card);
    const write: Promise<CalibrationUndo | null> = (
      rating
        ? rateCalibration({ ref, rating }).then((): CalibrationUndo => ({ kind: "rating", ref }))
        : markNotSeen(ref).then((interactionId): CalibrationUndo => ({ kind: "not_seen", interactionId }))
    ).catch((e) => {
      console.error(e);
      return null;
    });
    if (rating) setRated((n) => n + 1);
    setHistory((h) => [...h.slice(-19), { index, rated: Boolean(rating), write }]);
    setIndex((i) => i + 1);
  }

  async function decide(dir: Dir) {
    if (!card) return;
    await cardRef.current?.fly(dir);
    handleSwipe(dir);
  }

  async function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setIndex(last.index);
    if (last.rated) setRated((n) => n - 1);
    const undo = await last.write;
    if (undo) await undoCalibration(undo).catch((e) => console.error(e));
  }

  function finish() {
    startFinish(async () => {
      // Let pending ratings land before leaving.
      await Promise.all(history.map((h) => h.write));
      await finishCalibration(mode);
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = KEYS[e.key];
      if (dir) {
        e.preventDefault();
        void decide(dir);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const doneLabel = mode === "onboarding" ? "Börja hitta" : "Klar";

  return (
    <div className={find.swipe}>
      <div className={styles.head}>
        <h1 className={styles.title}>Vad tyckte du om de här?</h1>
        <p className={styles.lead}>Svep på det du har sett, så lär sig Settle din smak. Inte sett? Svep nedåt.</p>
      </div>

      <div className={find.bar}>
        <span className={`${find.ctx} ${styles.ctx}`}>
          Kalibrerar · {Math.min(index + 1, total)} av {total}
        </span>
        <button type="button" className={`link ${styles.skip}`} onClick={finish} disabled={finishing}>
          {rated === 0 ? "Hoppa över" : "Klar"}
        </button>
      </div>

      <div className={`${find.deck} ${styles.deck}`}>
        {card ? (
          <>
            {next && (
              <div className={`${find.card} ${find.under}`} aria-hidden="true">
                <CardFace card={next} note={null} />
              </div>
            )}
            <SwipeCard key={`${card.media_type}:${card.tmdb_id}`} ref={cardRef} card={card} stamps={STAMPS} onSwipe={handleSwipe} />
          </>
        ) : (
          <div className={find.empty}>
            <p>
              {rated === 0
                ? "Inga betyg den här gången. Du kan kalibrera senare."
                : `Tack! ${rated} betyg är sparade, och förslagen blir mer dina.`}
            </p>
            <button type="button" className="primary" onClick={finish} disabled={finishing}>
              {finishing ? "Sparar …" : doneLabel}
            </button>
          </div>
        )}
      </div>

      <p className={find.hint}>Höger: gillar · Upp: älskar · Vänster: ogillade · Ner: inte sett</p>
      <div className={find.actions}>
        {history.length > 0 && (
          <button type="button" className={find.undo} aria-label="Ångra" onClick={undo}>
            ↶
          </button>
        )}
        <button type="button" aria-label="Ogillade" onClick={() => decide("left")} disabled={!card}>
          ✕
        </button>
        <button type="button" aria-label="Inte sett" onClick={() => decide("down")} disabled={!card}>
          Inte sett
        </button>
        <button type="button" aria-label="Älskar" onClick={() => decide("up")} disabled={!card}>
          ★
        </button>
        <button type="button" aria-label="Gillar" onClick={() => decide("right")} disabled={!card}>
          ♥
        </button>
      </div>
    </div>
  );
}
