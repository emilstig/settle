import type { Dir } from "./swipe-card";

/**
 * One icon per decision, the same in the deck (icon only) and the detail
 * view (icon and word): ✕ Inte nu, a clock for Kanske (another evening), an
 * eye for Sett and a heart for Vill se.
 */
export const DECISION_WORD: Record<Dir, string> = {
  left: "Inte nu",
  down: "Kanske",
  up: "Sett",
  right: "Vill se",
};

/** Left to right in the deck and the detail view alike. */
export const DECISION_ORDER: Dir[] = ["left", "down", "up", "right"];

export function DecisionIcon({ dir }: { dir: Dir }) {
  const common = {
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    focusable: false,
  } as const;
  if (dir === "right")
    return (
      <svg {...common}>
        <path
          fill="currentColor"
          d="M12 21s-7.5-4.6-9.5-9.3C1 8.1 3.3 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.7 0 6 3.6 4.5 7.2C19.5 16.4 12 21 12 21z"
        />
      </svg>
    );
  return (
    <svg
      {...common}
      fill="none"
      stroke="currentColor"
      strokeWidth={dir === "left" ? 2.4 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {dir === "left" && <path d="M18 6 6 18M6 6l12 12" />}
      {dir === "down" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )}
      {dir === "up" && (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
