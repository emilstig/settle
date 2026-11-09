"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./tab-bar.module.css";

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
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
