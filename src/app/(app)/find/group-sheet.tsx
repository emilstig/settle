"use client";

import { useState } from "react";
import type { GroupOption } from "./types";
import styles from "./find.module.css";

/** "Med annan grupp": choose whose lists a saved title belongs on. */
export function GroupSheet({
  title,
  groups,
  currentGroupId,
  onDone,
}: {
  title: string;
  groups: GroupOption[];
  currentGroupId: string;
  /** Null when closed without saving. */
  onDone: (groupIds: string[] | null) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set([currentGroupId]),
  );

  return (
    <>
      <div className={styles.scrim} onClick={() => onDone(null)} />
      <div
        className={`${styles.sheet} ${styles.sheetOpen}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-title"
      >
        <div className={styles.sheetHead}>
          <h3 id="group-title">{title}</h3>
          <button
            type="button"
            className={styles.sheetClose}
            aria-label="Stäng"
            onClick={() => onDone(null)}
          >
            ✕
          </button>
        </div>
        <p>Vill se med vem?</p>
        <div className={styles.sheetRow}>
          {groups.map((g) => {
            const on = chosen.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                className={on ? styles.on : undefined}
                aria-pressed={on}
                onClick={() =>
                  setChosen((s) => {
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
            disabled={chosen.size === 0}
            onClick={() => onDone([...chosen])}
          >
            Spara
          </button>
        </div>
      </div>
    </>
  );
}
