import type { ReactNode } from "react";

/** Line icons for Profil, in the deck's style: 24 px grid, 2 px stroke. */
function Line({ children }: { children: ReactNode }) {
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
      {children}
    </svg>
  );
}

/** The rows in Profil: Din smak, Historik and Tjänster. */
export function MenuIcon({
  kind,
}: {
  kind: "taste" | "history" | "groups" | "services";
}) {
  return (
    <Line>
      {kind === "taste" && (
        <>
          <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
          <circle cx="15" cy="6" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="17" cy="18" r="2" />
        </>
      )}
      {kind === "history" && (
        <>
          <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
          <path d="M3 4v4h4" />
          <path d="M12 8v4l3 2" />
        </>
      )}
      {kind === "groups" && (
        <>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
          <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
        </>
      )}
      {kind === "services" && (
        <>
          <rect x="3" y="5" width="18" height="12" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </>
      )}
    </Line>
  );
}

export function Chevron() {
  return (
    <Line>
      <path d="m9 6 6 6-6 6" />
    </Line>
  );
}

/**
 * One icon per film genre (series genres are counted as film genres, see
 * genresOf). Genres without one of their own get a film frame.
 */
const GENRE: Record<number, ReactNode> = {
  // Action: a bolt
  28: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  // Äventyr: a compass
  12: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  // Animerat: a pencil
  16: (
    <>
      <path d="M16 3.5a2.1 2.1 0 0 1 3 3L8 17.5l-4 1 1-4z" />
      <path d="m14.5 5 3 3" />
    </>
  ),
  // Komedi: a smile
  35: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  // Kriminal: a badge
  80: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z" />
      <path d="m12 8.5 1.1 2.3 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" />
    </>
  ),
  // Dokumentär: a camera
  99: (
    <>
      <rect x="2.5" y="7" width="13" height="10" rx="2" />
      <path d="m15.5 11 6-3.5v9l-6-3.5" />
    </>
  ),
  // Drama: a tear
  18: <path d="M12 3s-6 6.7-6 11a6 6 0 0 0 12 0c0-4.3-6-11-6-11z" />,
  // Familj: a house
  10751: (
    <>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5M10 20v-5h4v5" />
    </>
  ),
  // Fantasy: a wand
  14: (
    <>
      <path d="m4 20 11-11" />
      <path d="M15 3v2M15 9v2M11 7h2M17 7h2M19.5 13.5v2M18.5 14.5h2" />
    </>
  ),
  // Historia: a column
  36: (
    <>
      <path d="M4 20h16M5 8h14M12 3 5 7h14z" />
      <path d="M7 8v9M12 8v9M17 8v9M5 17h14" />
    </>
  ),
  // Skräck: a ghost
  27: (
    <>
      <path d="M5 21V11a7 7 0 0 1 14 0v10l-2.3-1.8L14.3 21 12 19.2 9.7 21l-2.4-1.8z" />
      <path d="M9.5 10.5h.01M14.5 10.5h.01" />
    </>
  ),
  // Musik: a note
  10402: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  // Mysterium: a magnifying glass
  9648: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  // Romantik: a heart
  10749: (
    <path d="M12 20s-7-4.4-8.6-8.6C2.2 8 4.4 5 7.5 5c1.9 0 3.3 1 4.5 2.7C13.2 6 14.6 5 16.5 5c3.1 0 5.3 3 4.1 6.4C19 15.6 12 20 12 20z" />
  ),
  // Science fiction: a planet
  878: (
    <>
      <circle cx="12" cy="12" r="5.5" />
      <path d="M16.8 9.3C20 8 22.2 8 22.6 9c.6 1.6-3.8 4.6-9.8 6.9S2 18.6 1.4 17c-.4-1 1.1-2.6 3.8-4.2" />
    </>
  ),
  // Tv-film: a screen
  10770: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="m8 2 4 4 4-4" />
    </>
  ),
  // Thriller: a pulse
  53: <path d="M2 12h4l2.5-6 4 13 3-9 1.5 2H22" />,
  // Krig: a shield
  10752: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z" />
      <path d="M12 3v18" />
    </>
  ),
  // Western: a cactus
  37: (
    <>
      <path d="M10 21V5a2 2 0 0 1 4 0v16M7 21h10" />
      <path d="M10 13H8a2 2 0 0 1-2-2V8M14 11h2a2 2 0 0 0 2-2V6.5" />
    </>
  ),
  // Nyheter: a paper
  10763: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h5" />
    </>
  ),
  // Reality: a camera on a person
  10764: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
  // Såpa: two speech bubbles
  10766: (
    <>
      <path d="M3 5h11v7H8l-3 3v-3H3z" />
      <path d="M17 9h4v7h-2v3l-3-3h-5v-2" />
    </>
  ),
  // Talkshow: a microphone
  10767: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
};

const FRAME = (
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </>
);

export function GenreIcon({ id }: { id: number }) {
  return <Line>{GENRE[id] ?? FRAME}</Line>;
}
