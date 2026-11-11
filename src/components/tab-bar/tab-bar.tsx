"use client";

import { useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  lastIn,
  restoreIfPending,
  restoreOnArrival,
  saveScroll,
  tabOf,
  visit,
  type TabRoot,
} from "./tab-memory";
import styles from "./tab-bar.module.css";

/** Sent when Hitta is tapped while already in Hitta. */
export const FIND_AGAIN = "settle:find-again";

const TABS: { href: TabRoot; label: string }[] = [
  { href: "/", label: "Hitta" },
  { href: "/list", label: "Att se" },
  { href: "/profile", label: "Profil" },
];

/**
 * The three tabs. Like a native tab bar, each tab keeps its page and scroll:
 * switching back opens it where the user left it. Tapping the tab you are in
 * goes to its first page, and there scrolls to the top.
 * Hidden in calibration, which is a task of its own.
 */
export function TabBar() {
  const path = usePathname();

  // Before paint, so the page never shows at the top first.
  useLayoutEffect(() => {
    visit(path);
    restoreIfPending(path);
  }, [path]);

  useEffect(() => {
    window.addEventListener("scroll", saveScroll, { passive: true });
    return () => window.removeEventListener("scroll", saveScroll);
  }, []);

  if (path.startsWith("/calibrate")) return null;
  return (
    <nav className={styles.tabs} aria-label="Huvudmeny">
      {TABS.map((t) => {
        const on = tabOf(path) === t.href;
        const href = on ? t.href : lastIn(t.href);
        return (
          <Link
            key={t.href}
            href={href}
            scroll={false}
            className={styles.tab}
            aria-current={on ? "page" : undefined}
            onClick={(e) => {
              saveScroll();
              if (on && path === t.href) {
                // Already on the tab's first page: back to the top.
                e.preventDefault();
                if (t.href === "/") window.dispatchEvent(new Event(FIND_AGAIN));
                const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
                window.scrollTo({ top: 0, behavior: still ? "instant" : "smooth" });
                return;
              }
              restoreOnArrival(href);
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

