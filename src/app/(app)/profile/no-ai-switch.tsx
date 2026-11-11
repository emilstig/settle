"use client";

import { useOptimistic, useTransition } from "react";
import { setNoAi } from "./actions";
import styles from "./profile.module.css";

/**
 * Temporary, for comparing in step 5: new sessions without the reading of
 * the mood, the titles in the style and Toppval. Only shown to the accounts
 * allowed to compare.
 */
export function NoAiSwitch({ off }: { off: boolean }) {
  const [shown, setShown] = useOptimistic(off);
  const [, start] = useTransition();
  return (
    <label className={styles.compare}>
      <span className={styles.rowText}>
        <strong>Jämför utan AI</strong>
        <span>
          Nya förslag utan Toppval och utan tolkning av humöret. Bara för
          dig, tillfälligt.
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
            await setNoAi(next);
          });
        }}
      />
    </label>
  );
}
