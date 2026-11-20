"use client";

import { useOptimistic, useTransition } from "react";
import { setTasteOnly } from "./actions";
import styles from "./profile.module.css";

/**
 * Temporary, for trying where the engine is heading: decks without a mood
 * from the taste alone. Only shown to the accounts allowed to compare.
 */
export function TasteOnlySwitch({ on }: { on: boolean }) {
  const [shown, setShown] = useOptimistic(on);
  const [, start] = useTransition();
  return (
    <label className={styles.compare}>
      <span className={styles.rowText}>
        <strong>Bara smak</strong>
        <span>
          Utan humör visas bara Toppval, Smak och Liknar. Populärt kommer
          först när det tar slut. Bara för dig, tillfälligt.
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className={styles.switch}
        checked={shown}
        onChange={(e) => {
          const next = e.target.checked;
          start(async () => {
            setShown(next);
            await setTasteOnly(next);
          });
        }}
      />
    </label>
  );
}
