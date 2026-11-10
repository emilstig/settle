"use client";

import { useState } from "react";
import type { GroupOption } from "./types";
import styles from "./find.module.css";

/**
 * Grupper in Att se, and "Spara för en annan grupp" in the deck: choose
 * whose lists a title belongs on.
 */
export function GroupSheet({
  title,
  groups,
  savedFor,
  locked,
  onDone,
}: {
  title: string;
  groups: Pick<GroupOption, "id" | "name">[];
  /** The groups whose lists it is on now, chosen from the start. */
  savedFor: string[];
  /**
   * The group whose list it is opened from, in Att se: it stays chosen,
   * since taking it off this list is Ta bort's job, and Grupper never
   * closes the view.
   */
  locked?: string;
  /** Null when closed without saving. */
  onDone: (groupIds: string[] | null) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(savedFor));

  return (
    <>
      <div
        className={`${styles.scrim} ${styles.overDetail}`}
        onClick={() => onDone(null)}
      />
      <div
        className={`${styles.sheet} ${styles.sheetOpen} ${styles.overDetail}`}
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
        <p>
          Spara för vilka grupper?
          {savedFor.length > 0 &&
            ` Nu sparad för ${groups
              .filter((g) => savedFor.includes(g.id))
              .map((g) => g.name)
              .join(" och ")}.`}
        </p>
        <div className={styles.sheetRow}>
          {groups.map((g) => {
            const on = chosen.has(g.id) || g.id === locked;
            return (
              <button
                key={g.id}
                type="button"
                className={`${on ? styles.on : ""} ${
                  g.id === locked ? styles.locked : ""
                }`}
                aria-pressed={on}
                aria-disabled={g.id === locked || undefined}
                onClick={() =>
                  g.id !== locked &&
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
            disabled={chosen.size === 0 && !locked}
            onClick={() =>
              onDone([...new Set([...chosen, ...(locked ? [locked] : [])])])
            }
          >
            Spara
          </button>
        </div>
      </div>
    </>
  );
}
