"use client";

import { createContext, useContext, useState } from "react";
import type { Card } from "@/lib/deck";
import type { Undo } from "../find-actions";
import type { Dir } from "./swipe-card";

export type DeckSession = {
  id: string;
  groupId: string;
  cards: Card[];
  page: number;
  hasMore: boolean;
  /** The line under the header: prompt 1's heading, or the mood as given. */
  label: string | null;
  /** Set when loading more failed: the index it failed at. */
  loadFailedAt: number | null;
};

/** One swipe that can be undone. `undo` settles once the database writes are done. */
export type HistoryEntry = {
  index: number;
  undo: Promise<Undo | null>;
  dir: Dir;
  key: string;
};

/**
 * Hitta as the user left it, so the deck is still there after a look at Att
 * se or Profil. Kept in memory only: a reload starts over.
 */
export type DeckSnapshot = {
  /** eveningStart() when it was saved: a deck from another evening is dropped. */
  evening: string;
  phase: "start" | "deck" | "chosen";
  groupId: string;
  session: DeckSession | null;
  index: number;
  history: HistoryEntry[];
  quickPicks: string[];
  mood: string;
};

type Memory = {
  /** Hitta as last left, or null. */
  read: () => DeckSnapshot | null;
  save: (deck: DeckSnapshot) => void;
  /** "Ikväll · N" in Att se: open the Ikväll sheet when Hitta is reached. */
  askForTonight: () => void;
  /** Whether askForTonight was called; read on arrival, then cleared. */
  wantsTonight: () => boolean;
  clearTonight: () => void;
};

const DeckMemory = createContext<Memory | null>(null);

/** Lives in the app layout, which stays mounted when the tabs change. */
export function DeckMemoryProvider({ children }: { children: React.ReactNode }) {
  const [memory] = useState<Memory>(() => {
    let deck: DeckSnapshot | null = null;
    let tonight = false;
    return {
      read: () => deck,
      save: (d) => {
        deck = d;
      },
      askForTonight: () => {
        tonight = true;
      },
      wantsTonight: () => tonight,
      clearTonight: () => {
        tonight = false;
      },
    };
  });
  return <DeckMemory.Provider value={memory}>{children}</DeckMemory.Provider>;
}

export function useDeckMemory(): Memory {
  const memory = useContext(DeckMemory);
  if (!memory) throw new Error("useDeckMemory outside DeckMemoryProvider");
  return memory;
}
