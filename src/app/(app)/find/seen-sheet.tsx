"use client";

import { useEffect, useRef, useState } from "react";
import type { GroupOption } from "./types";
import styles from "./find.module.css";

export type SeenAnswers = {
  rating: -1 | 1 | 2 | 3 | null;
  /** Null when closed: se igen stays as it was. */
  rewatchGroupIds: string[] | null;
};

const STEPS = [
  {
    q: "Hur var den?",
    key: "rating",
    options: [
      ["Ogillade", -1],
      ["Gillar", 1],
      ["Gillar mycket", 2],
      ["Älskar", 3],
    ],
  },
] as const;
const TOTAL_STEPS = STEPS.length + 1;

/**
 * Two steps after "Sett" in the MVP: rating, then see again with whom (no
 * group chosen from the start).
 * "Hur många gånger?" and "När senast?" are out of MVP (project doc).
 */
export function SeenSheet({
  title,
  groups,
  onDone,
  rewatchGroupIds = [],
  only,
  rating,
}: {
  title: string;
  groups: GroupOption[];
  onDone: (answers: SeenAnswers) => void;
  /** Groups where it is already on the se igen list: shown as chosen. */
  rewatchGroupIds?: string[];
  /**
   * One of the steps on its own, for a title already seen (Historik): the
   * rating, or se igen with whom. Done after that step.
   */
  only?: "rating" | "rewatch";
  /** The rating it has now, shown as chosen when `only` is "rating". */
  rating?: number | null;
}) {
  const [step, setStep] = useState(only === "rewatch" ? STEPS.length : 0);
  const [answers, setAnswers] = useState<SeenAnswers>({
    rating: null,
    rewatchGroupIds: [],
  });
  // Nothing chosen from the start: "se igen" is a wish that weighs heavily
  // later, so it must not be saved by tapping past the question.
  // A preselection only shows what is already saved, never a new wish.
  const [again, setAgain] = useState<Set<string>>(
    () => new Set(rewatchGroupIds),
  );
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (
      rowRef.current?.querySelector("button") as HTMLButtonElement | null
    )?.focus();
  }, [step]);

  const finish = (rewatch: string[] | null) =>
    onDone({ ...answers, rewatchGroupIds: rewatch });
  const current = STEPS[step];

  return (
    <>
      {/* Above every layer it can open from: the deck, and "Visa alla" in
          Att se, which covers the page. */}
      <div
        className={`${styles.scrim} ${styles.overDetail}`}
        onClick={() => finish(null)}
      />
      <div
        className={`${styles.sheet} ${styles.sheetOpen} ${styles.overDetail}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="seen-title"
      >
        <div className={styles.sheetHead}>
          {only ? (
            <span />
          ) : (
            <div className={styles.dots}>
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <span
                  key={i}
                  className={i <= step ? styles.dotOn : undefined}
                />
              ))}
              <small>
                Steg {step + 1} av {TOTAL_STEPS}
              </small>
            </div>
          )}
          <button
            type="button"
            className={styles.sheetClose}
            aria-label="Stäng"
            onClick={() => finish(null)}
          >
            ✕
          </button>
        </div>
        <h3 id="seen-title">{title}</h3>

        {current ? (
          <>
            <p>{current.q}</p>
            <div className={styles.sheetRow} ref={rowRef}>
              {current.options.map(([label, value]) => (
                <button
                  key={label}
                  type="button"
                  className={
                    only === "rating" && rating === value
                      ? styles.on
                      : undefined
                  }
                  aria-pressed={
                    only === "rating" ? rating === value : undefined
                  }
                  onClick={() => {
                    if (only === "rating") {
                      onDone({ rating: value, rewatchGroupIds: null });
                      return;
                    }
                    setAnswers((a) => ({ ...a, [current.key]: value }));
                    setStep((s) => s + 1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {!only && (
              <button
                type="button"
                className={styles.sheetSkip}
                onClick={() => setStep((s) => s + 1)}
              >
                Hoppa över steget
              </button>
            )}
          </>
        ) : (
          <>
            <p>Vill du se den igen? Med vem?</p>
            <div className={styles.sheetRow} ref={rowRef}>
              {groups.map((g) => {
                const on = again.has(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={on ? styles.on : undefined}
                    aria-pressed={on}
                    onClick={() =>
                      setAgain((s) => {
                        const n = new Set(s);
                        if (n.has(g.id)) n.delete(g.id);
                        else n.add(g.id);
                        return n;
                      })
                    }
                  >
                    {g.name}
                  </button>
                );
              })}
              <button
                type="button"
                className={styles.ok}
                disabled={again.size === 0}
                onClick={() => finish([...again])}
              >
                Klar
              </button>
            </div>
            <button
              type="button"
              className={styles.sheetSkip}
              onClick={() => finish([])}
            >
              Nej, inte igen
            </button>
          </>
        )}
      </div>
    </>
  );
}
