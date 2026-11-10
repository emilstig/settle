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

/**
 * The detail view's bar from Att se, drawn like the deck's: a bin for Ta
 * bort, a star for Vill gärna (filled when on), the eye for Sett and two
 * people for Grupper.
 */
export function ListIcon({
  kind,
  on = false,
}: {
  kind: "remove" | "want" | "seen" | "groups";
  on?: boolean;
}) {
  if (kind === "seen") return <DecisionIcon dir="up" />;
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
      {kind === "remove" && (
        <>
          <path d="M4 7h16M10 11v6M14 11v6" />
          <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
        </>
      )}
      {kind === "want" && (
        <path
          fill={on ? "currentColor" : "none"}
          d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"
        />
      )}
      {kind === "groups" && (
        <>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
          <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
        </>
      )}
    </svg>
  );
}

/**
 * The detail view's bar from Historik, in the same line style: a star for
 * the rating (filled when rated), two arrows round for Se igen, the eye
 * struck through for Inte sett and a thumb down for Inte min grej.
 */
export function HistoryIcon({
  kind,
  on = false,
}: {
  kind: "rate" | "rewatch" | "unseen" | "notForMe";
  on?: boolean;
}) {
  if (kind === "rate") return <ListIcon kind="want" on={on} />;
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
      {kind === "rewatch" && (
        <>
          <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
          <path d="M4 3v5h5" />
          <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
          <path d="M20 21v-5h-5" />
        </>
      )}
      {kind === "unseen" && (
        <>
          <path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.5 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <path d="m3 3 18 18" />
        </>
      )}
      {kind === "notForMe" && (
        <>
          <path
            fill={on ? "currentColor" : "none"}
            d="M16 14V3H7.5a2 2 0 0 0-2 1.6l-1.5 7.6A2 2 0 0 0 6 14.6h4.5l-.8 3.9A2 2 0 0 0 11.6 21h.4z"
          />
          <path d="M16 3h3.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H16" />
        </>
      )}
    </svg>
  );
}
