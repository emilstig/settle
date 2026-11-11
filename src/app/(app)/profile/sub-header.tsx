"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  cameFrom,
  parentOf,
  restoreOnArrival,
} from "@/components/tab-bar/tab-memory";
import { BackIcon } from "../find/decision-icons";
import { AppHeader } from "../find/group-picker";
import find from "../find/find.module.css";

/**
 * The header of a page under Profil: a back arrow before the title, like
 * the deck's. Back goes to the page under this one in the tab (Profil, or
 * Din smak for Historik), where the user left it, even after a visit to
 * another tab in between.
 */
export function SubHeader({ title }: { title: string }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <AppHeader>
      <button
        type="button"
        className={find.headBack}
        aria-label="Tillbaka"
        onClick={() => {
          const parent = parentOf(path) ?? "/profile";
          // Straight from the page below: the same as the back gesture.
          if (cameFrom(parent)) {
            router.back();
            return;
          }
          // Back here from another tab, or opened directly.
          restoreOnArrival(parent);
          router.push(parent, { scroll: false });
        }}
      >
        <BackIcon />
      </button>
      <h1 className="logo">{title}</h1>
    </AppHeader>
  );
}
