"use client";

import { useEffect, useState } from "react";
import type { Card } from "@/lib/deck";
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
  tonightChoice,
  tonightCount,
  onOpenTonight,
  onOpenChoice,
}: {
  groups: GroupOption[];
  groupId: string;
  onGroup: (id: string) => void;
  onAge: (groupId: string, age: number) => void;
  quickPicks: Set<string>;
  onToggleQuick: (pick: string) => void;
  mood: string;
  onMood: (text: string) => void;
  onStart: () => void;
  loading: boolean;
  error: string | null;
  footer: React.ReactNode;
  /** Tonight's choice for the selected group, if made. */
  tonightChoice: Card | null;
  /** Candidates saved tonight with the selected group. */
  tonightCount: number;
  onOpenTonight: () => void;
  onOpenChoice: () => void;
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

      {/* Back the same evening: what was found tonight, without a new session. */}
      {tonightChoice ? (
        <div className={styles.tonightCard}>
          <div>
            <strong>Ikväll blir det {tonightChoice.title}</strong>
            <span>Ditt val för ikväll</span>
          </div>
          <button type="button" onClick={onOpenChoice}>
            Visa
          </button>
        </div>
      ) : (
        tonightCount > 0 && (
          <div className={styles.tonightCard}>
            <div>
              <strong>
                Ikväll · {tonightCount}{" "}
                {tonightCount === 1 ? "kandidat" : "kandidater"}
              </strong>
              <span>Det du har sparat ikväll</span>
            </div>
            <button type="button" onClick={onOpenTonight}>
              Visa
            </button>
          </div>
        )
      )}

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
        placeholder="Valfritt, t.ex. något lätt, max en och en halv timme"
        autoComplete="off"
        maxLength={300}
        aria-label="Vad är du sugen på"
        onKeyDown={(e) => e.key === "Enter" && onStart()}
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
        onClick={onStart}
        disabled={loading}
      >
        {loading ? (
          <LoadingLabel />
        ) : // The button says what happens: taste only, or what was asked for.
        mood.trim() || quickPicks.size > 0 ? (
          "Visa förslag"
        ) : (
          "Föreslå utifrån min smak"
        )}
      </button>

      <div className={styles.startFooter}>{footer}</div>
    </div>
  );
}

/** What the wait is spent on, shown in turn so it feels like something happens. */
const LOADING_PHRASES = [
  "Läser din smak …",
  "Letar på dina tjänster …",
  "Jämför med det du älskar …",
  "Väljer tre åt dig …",
  "Skriver varför …",
];
const PHRASE_MS = 1600;

export function LoadingLabel() {
  // Start at a random phrase, then go round in order.
  const [start] = useState(() =>
    Math.floor(Math.random() * LOADING_PHRASES.length),
  );
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => s + 1), PHRASE_MS);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={styles.loadingLabel} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {LOADING_PHRASES[(start + step) % LOADING_PHRASES.length]}
    </span>
  );
}
