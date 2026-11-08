"use client";

import { useState } from "react";
import type { GroupOption } from "./types";
import styles from "./find.module.css";

export const QUICK_PICKS = ["Lätt", "Spännande", "Kort", "Något tryggt", "Överraska mig"];
const AGES = Array.from({ length: 18 }, (_, i) => i);
/** Used when the question is skipped, per the domain rules. */
const DEFAULT_AGE = 7;

export function StartView({
  groups,
  groupId,
  onGroup,
  onAge,
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
  onAge: (groupId: string, age: number) => void;
  quickPicks: Set<string>;
  onToggleQuick: (pick: string) => void;
  mood: string;
  onMood: (text: string) => void;
  onStart: (useMood: boolean) => void;
  loading: boolean;
  error: string | null;
  footer: React.ReactNode;
}) {
  const [editingAge, setEditingAge] = useState(false);
  const selected = groups.find((g) => g.id === groupId);
  const family = selected?.kind === "family" ? selected : null;
  const askAge = family !== null && (family.youngest_age === null || editingAge);

  function pickAge(age: number) {
    if (!family) return;
    onAge(family.id, age);
    setEditingAge(false);
  }

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

      {askAge && family && (
        <div className={styles.age} role="group" aria-labelledby="age-q">
          <p id="age-q" className={styles.ageQ}>
            Hur gammal är den yngsta?
          </p>
          <p className={styles.ageLead}>Vi föreslår bara sådant som passar alla i soffan.</p>
          <div className={styles.ages}>
            {AGES.map((age) => (
              <button
                key={age}
                type="button"
                className="chip"
                aria-pressed={age === family.youngest_age}
                onClick={() => pickAge(age)}
              >
                {age}
              </button>
            ))}
          </div>
          {family.youngest_age === null && (
            <button type="button" className="link" onClick={() => pickAge(DEFAULT_AGE)}>
              Hoppa över (7 år)
            </button>
          )}
        </div>
      )}
      {family && !askAge && family.youngest_age !== null && (
        <p className={styles.ageNote}>
          Passar barn från {family.youngest_age} år.{" "}
          <button type="button" className="link" onClick={() => setEditingAge(true)}>
            Ändra
          </button>
        </p>
      )}

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
