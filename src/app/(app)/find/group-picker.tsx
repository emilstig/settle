"use client";

import { useEffect, useState } from "react";
import type { GroupOption } from "./types";
import { useBackClose } from "./use-back-close";
import styles from "./find.module.css";

const AGES = Array.from({ length: 18 }, (_, i) => i);
/** Used when the question is skipped, per the domain rules. */
export const DEFAULT_AGE = 7;

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

/**
 * Who is watching, as the left of the header in Hitta and Att se: the
 * group's name and a chevron. A tap opens a sheet with the groups as tiles,
 * one choice. The first time Familj is chosen it asks for the youngest's
 * age, and tapping Familj again changes it.
 */
export function GroupPicker({
  groups,
  groupId,
  onGroup,
  onAge,
  title,
  note,
}: {
  groups: GroupOption[];
  groupId: string;
  onGroup: (id: string) => void;
  onAge?: (groupId: string, age: number) => void;
  /** "Vem tittar ikväll?" in Hitta, "Vem tittar?" in Att se. */
  title: string;
  /** Said in the sheet, such as that the deck starts over. */
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editingAge, setEditingAge] = useState(false);
  const selected = groups.find((g) => g.id === groupId);
  const family = selected?.kind === "family" ? selected : null;
  const askAge =
    onAge !== undefined &&
    family !== null &&
    (family.youngest_age === null || editingAge);

  const close = () => {
    setOpen(false);
    setEditingAge(false);
  };
  useBackClose(open, close);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function pick(g: GroupOption) {
    if (g.id === groupId) {
      // Tapping Familj again opens the age question.
      if (g.kind === "family" && onAge) setEditingAge((v) => !v);
      else close();
      return;
    }
    onGroup(g.id);
    // Familj without an age stays open for the question.
    if (!(g.kind === "family" && g.youngest_age === null && onAge)) close();
  }

  function pickAge(age: number) {
    if (!family || !onAge) return;
    onAge(family.id, age);
    close();
  }

  return (
    <>
      <button
        type="button"
        className={styles.picker}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Vem tittar: ${selected?.name ?? ""}. Byt`}
        onClick={() => setOpen(true)}
      >
        <span className={styles.pickerName}>{selected?.name}</span>
        {family?.youngest_age != null && (
          <span className={styles.pickerAge}>{family.youngest_age}+</span>
        )}
        <span className={styles.pickerChev} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && (
        <>
          <div className={styles.scrim} onClick={close} />
          <div
            className={`${styles.sheet} ${styles.sheetOpen}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="picker-title"
          >
            <div className={styles.sheetHead}>
              <h3 id="picker-title">{title}</h3>
              <button
                type="button"
                className={styles.sheetClose}
                aria-label="Stäng"
                onClick={close}
              >
                ✕
              </button>
            </div>
            {note && <p>{note}</p>}
            {/* One choice, so tiles and a radio group rather than pills. */}
            <div
              className={styles.who}
              role="radiogroup"
              aria-labelledby="picker-title"
            >
              {groups.map((g) => {
                const on = g.id === groupId;
                return (
                  <button
                    key={g.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={styles.tile}
                    onClick={() => pick(g)}
                  >
                    <span className={styles.tileName}>{g.name}</span>
                    <span className={styles.tileSub}>{tileSub(g, on)}</span>
                  </button>
                );
              })}
            </div>
            {askAge && family && (
              <div
                className={`${styles.age} ${styles.pickerAgeQ}`}
                role="group"
                aria-labelledby="age-q"
              >
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
          </div>
        </>
      )}
    </>
  );
}

/** The top of Hitta, Att se and Profil: no logo, the left and right sides. */
export function AppHeader({
  children,
  right,
  under,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  /** A line under the header, such as the mood in the deck. */
  under?: React.ReactNode;
}) {
  return (
    <header className={styles.appHeader}>
      <div className={styles.appHeaderRow}>
        <div className={styles.appHeaderLeft}>{children}</div>
        {right && <div className={styles.appHeaderRight}>{right}</div>}
      </div>
      {under}
    </header>
  );
}
