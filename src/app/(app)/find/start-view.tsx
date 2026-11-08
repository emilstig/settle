"use client";

import { useState } from "react";
import type { GroupOption } from "./types";
import styles from "./find.module.css";

export const QUICK_PICKS = [
  "Lätt",
  "Spännande",
  "Kort",
  "Något tryggt",
  "Överraska mig",
];
const AGES = Array.from({ length: 18 }, (_, i) => i);
/** Used when the question is skipped, per the domain rules. */
const DEFAULT_AGE = 7;

/** The line under a group's name: the family age limit, or what is saved. */
function tileSub(g: GroupOption, on: boolean): string {
  if (g.kind === "family") {
    if (g.youngest_age === null) return "Ange ålder";
    return on
      ? `Från ${g.youngest_age} år · ändra`
      : `Från ${g.youngest_age} år`;
  }
  if (g.savedCount === 0) return "Inget sparat än";
  return g.savedCount === 1 ? "1 sparad" : `${g.savedCount} sparade`;
}

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
  const askAge =
    family !== null && (family.youngest_age === null || editingAge);

  function pickAge(age: number) {
    if (!family) return;
    onAge(family.id, age);
    setEditingAge(false);
  }

  return (
    <div className={styles.start}>
      <h1 className="q" id="who-q">
        Vem tittar ikväll?
      </h1>
      {/* One choice, so tiles and a radio group rather than pills like the mood. */}
      <div
        className={styles.who}
        role="radiogroup"
        aria-labelledby="who-q"
        onKeyDown={(e) => {
          const step = {
            ArrowRight: 1,
            ArrowDown: 1,
            ArrowLeft: -1,
            ArrowUp: -1,
          }[e.key];
          if (!step) return;
          e.preventDefault();
          const i = groups.findIndex((g) => g.id === groupId);
          const next = groups[(i + step + groups.length) % groups.length];
          onGroup(next.id);
          (
            e.currentTarget.querySelector(
              `[data-id="${next.id}"]`,
            ) as HTMLElement | null
          )?.focus();
        }}
      >
        {groups.map((g) => {
          const on = g.id === groupId;
          return (
            <button
              key={g.id}
              data-id={g.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={styles.tile}
              onClick={() => {
                // Tapping Familj again opens the age question.
                if (on && g.kind === "family") setEditingAge((v) => !v);
                else onGroup(g.id);
              }}
            >
              <span className={styles.tileName}>{g.name}</span>
              <span className={styles.tileSub}>{tileSub(g, on)}</span>
            </button>
          );
        })}
      </div>

      {askAge && family && (
        <div className={styles.age} role="group" aria-labelledby="age-q">
          <p id="age-q" className={styles.ageQ}>
            Hur gammal är den yngsta?
          </p>
          <p className={styles.ageLead}>
            Vi föreslår bara sådant som passar alla i soffan.
          </p>
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
            <button
              type="button"
              className="link"
              onClick={() => pickAge(DEFAULT_AGE)}
            >
              Hoppa över (7 år)
            </button>
          )}
        </div>
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
            {/* The tick says several can be picked. */}
            {quickPicks.has(q) && <span aria-hidden="true">✓ </span>}
            {q}
          </button>
        ))}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={`primary ${styles.go}`}
        onClick={() => onStart(true)}
        disabled={loading}
      >
        {loading ? "Letar …" : "Visa förslag"}
      </button>
      <button
        type="button"
        className="link"
        onClick={() => onStart(false)}
        disabled={loading}
      >
        Bara swipea
      </button>

      <div className={styles.startFooter}>{footer}</div>
    </div>
  );
}
