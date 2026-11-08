"use client";

import { useEffect, useRef, useState } from "react";
import type { GroupOption } from "./types";
import styles from "./find.module.css";

export type SeenAnswers = {
  rating: -1 | 1 | 2 | 3 | null;
  timesSeen: "once" | "few" | "many" | null;
  lastSeen: "recent" | "this_year" | "long_ago" | null;
  rewatchGroupIds: string[];
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
  {
    q: "Hur många gånger?",
    key: "timesSeen",
    options: [
      ["En gång", "once"],
      ["Några", "few"],
      ["Många", "many"],
    ],
  },
  {
    q: "När senast?",
    key: "lastSeen",
    options: [
      ["Nyligen", "recent"],
      ["I år", "this_year"],
      ["Länge sen", "long_ago"],
    ],
  },
] as const;

/** Four short steps after "Sett": rating, how many times, when, and see again with whom. */
export function SeenSheet({
  title,
  groups,
  currentGroupId,
  onDone,
}: {
  title: string;
  groups: GroupOption[];
  currentGroupId: string;
  onDone: (answers: SeenAnswers) => void;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<SeenAnswers>({
    rating: null,
    timesSeen: null,
    lastSeen: null,
    rewatchGroupIds: [],
  });
  const [again, setAgain] = useState<Set<string>>(() => new Set([currentGroupId]));
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (rowRef.current?.querySelector("button") as HTMLButtonElement | null)?.focus();
  }, [step]);

  const finish = (rewatch: string[]) => onDone({ ...answers, rewatchGroupIds: rewatch });
  const current = STEPS[step];

  return (
    <>
      <div className={styles.scrim} onClick={() => finish([])} />
      <div className={`${styles.sheet} ${styles.sheetOpen}`} role="dialog" aria-modal="true" aria-labelledby="seen-title">
        <div className={styles.sheetHead}>
          <div className={styles.dots}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i <= step ? styles.dotOn : undefined} />
            ))}
            <small>Steg {step + 1} av 4</small>
          </div>
          <button type="button" className={styles.sheetClose} aria-label="Stäng" onClick={() => finish([])}>
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
                  onClick={() => {
                    setAnswers((a) => ({ ...a, [current.key]: value }));
                    setStep((s) => s + 1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className={styles.sheetSkip} onClick={() => setStep((s) => s + 1)}>
              Hoppa över steget
            </button>
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
              <button type="button" className={styles.ok} onClick={() => finish([...again])}>
                Klar
              </button>
            </div>
            <button type="button" className={styles.sheetSkip} onClick={() => finish([])}>
              Nej, inte igen
            </button>
          </>
        )}
      </div>
    </>
  );
}
