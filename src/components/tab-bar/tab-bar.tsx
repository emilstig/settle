"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./tab-bar.module.css";

/** Sent when Hitta is tapped while already in Hitta. */
export const FIND_AGAIN = "settle:find-again";

const TABS = [
  { href: "/", label: "Hitta" },
  { href: "/list", label: "Att se" },
  { href: "/profile", label: "Profil" },
] as const;

/** The three tabs. Hidden in calibration, which is a task of its own. */
export function TabBar() {
  const path = usePathname();
  if (path.startsWith("/calibrate")) return null;
  return (
    <nav className={styles.tabs} aria-label="Huvudmeny">
      {TABS.map((t) => {
        const on = t.href === "/" ? path === "/" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={styles.tab}
            aria-current={on ? "page" : undefined}
            // Hitta again while in Hitta goes back to its start view.
            onClick={() => {
              if (on && t.href === "/")
                window.dispatchEvent(new Event(FIND_AGAIN));
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
