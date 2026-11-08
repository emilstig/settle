"use client";

import type { GroupOption } from "./types";
import styles from "./find.module.css";

export const QUICK_PICKS = ["Lätt", "Spännande", "Kort", "Något tryggt", "Överraska mig"];

export function StartView({
  groups,
  groupId,
  onGroup,
  quickPicks,
  onToggleQuick,
  mood,
  onMood,
  onStart,
  loading,
  error,
  footer,
}: {
  groups: GroupOption[];
  groupId: string;
  onGroup: (id: string) => void;
  quickPicks: Set<string>;
  onToggleQuick: (pick: string) => void;
  mood: string;
  onMood: (text: string) => void;
  onStart: (useMood: boolean) => void;
  loading: boolean;
  error: string | null;
  footer: React.ReactNode;
}) {
  return (
    <div className={styles.start}>
      <h1 className="q">Vem tittar ikväll?</h1>
      <div className="chips" role="group" aria-label="Vem tittar">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className="chip"
            aria-pressed={g.id === groupId}
            onClick={() => onGroup(g.id)}
          >
            {g.name}
          </button>
        ))}
      </div>

      <h1 className="q">Vad är du sugen på?</h1>
      <input
        className="field"
        value={mood}
        onChange={(e) => onMood(e.target.value)}
        placeholder="T.ex. något lätt, max en och en halv timme"
        autoComplete="off"
        maxLength={300}
        aria-label="Vad är du sugen på"
        onKeyDown={(e) => e.key === "Enter" && onStart(true)}
      />
      <div className="chips" role="group" aria-label="Snabbval">
        {QUICK_PICKS.map((q) => (
          <button
            key={q}
            type="button"
            className="chip"
            aria-pressed={quickPicks.has(q)}
            onClick={() => onToggleQuick(q)}
          >
            {q}
          </button>
        ))}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className={`primary ${styles.go}`} onClick={() => onStart(true)} disabled={loading}>
        {loading ? "Letar …" : "Visa förslag"}
      </button>
      <button type="button" className="link" onClick={() => onStart(false)} disabled={loading}>
        Bara swipea
      </button>

      <div className={styles.startFooter}>{footer}</div>
    </div>
  );
}
