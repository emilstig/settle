"use client";

import { useEffect, useState } from "react";
import type { Card } from "@/lib/deck";
import styles from "./find.module.css";

export const QUICK_PICKS = [
  "Lätt",
  "Spännande",
  "Kort",
  "Något tryggt",
  "Överraska mig",
];

export function StartView({
  together,
  quickPicks,
  onToggleQuick,
  mood,
  onMood,
  onStart,
  loading,
  error,
  belowStart,
  tonightChoice,
  onOpenChoice,
}: {
  /** Not Själv: "ni" and "vår" instead of "du" and "min". */
  together: boolean;
  quickPicks: Set<string>;
  onToggleQuick: (pick: string) => void;
  mood: string;
  onMood: (text: string) => void;
  onStart: () => void;
  loading: boolean;
  error: string | null;
  /** Shown right under the start button, such as ”Fortsätt kalibrera”. */
  belowStart?: React.ReactNode;
  /** Tonight's choice for the selected group, if made. */
  tonightChoice: Card | null;
  onOpenChoice: () => void;
}) {
  const sugen = together ? "Vad är ni sugna på" : "Vad är du sugen på";

  // Who is watching is chosen in the header; the page starts with the mood.
  return (
    <div className={styles.start}>
      {/* Back the same evening: what was chosen tonight. Candidates are
          behind "Ikväll · N" in the header. */}
      {tonightChoice && (
        <div className={styles.tonightCard}>
          <div>
            <strong>Ikväll blir det {tonightChoice.title}</strong>
            <span>{together ? "Ert" : "Ditt"} val för ikväll</span>
          </div>
          <button type="button" onClick={onOpenChoice}>
            Visa
          </button>
        </div>
      )}

      <h1 className="q">{sugen}?</h1>
      <input
        className="field"
        value={mood}
        onChange={(e) => onMood(e.target.value)}
        placeholder="Valfritt, t.ex. något lätt, max en och en halv timme"
        autoComplete="off"
        maxLength={300}
        aria-label={sugen}
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
          <LoadingLabel together={together} />
        ) : // The button says what happens: taste only, or what was asked for.
        mood.trim() || quickPicks.size > 0 ? (
          "Visa förslag"
        ) : (
          `Föreslå utifrån ${together ? "vår" : "min"} smak`
        )}
      </button>
      {belowStart}
    </div>
  );
}

/** What the wait is spent on, shown in turn so it feels like something happens. */
const LOADING_PHRASES = {
  solo: [
    "Läser din smak …",
    "Letar på dina tjänster …",
    "Jämför med det du älskar …",
    "Väljer tre åt dig …",
    "Skriver varför …",
  ],
  // With a group the taste is the group's, and the services still the user's.
  together: [
    "Läser er smak …",
    "Letar på dina tjänster …",
    "Jämför med det ni har gillat …",
    "Väljer tre åt er …",
    "Skriver varför …",
  ],
};
const PHRASE_MS = 1600;

/** `together` when the group is not Själv: the phrases say "ni" and "er". */
export function LoadingLabel({ together = false }: { together?: boolean }) {
  const phrases = LOADING_PHRASES[together ? "together" : "solo"];
  // Start at a random phrase, then go round in order.
  const [start] = useState(() =>
    Math.floor(Math.random() * phrases.length),
  );
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => s + 1), PHRASE_MS);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={styles.loadingLabel} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {phrases[(start + step) % phrases.length]}
    </span>
  );
}
