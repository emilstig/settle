"use client";

import { useLayoutEffect, useRef } from "react";
import type { Card } from "@/lib/deck";
import styles from "./find.module.css";

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The chip gives a small bump when something lands in it. */
export function bump(chip: HTMLElement | null) {
  chip?.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }],
    { duration: 260, easing: "ease-out" },
  );
}

/**
 * A small poster that flies from the deck to "Ikväll · N", so that saving
 * shows where the title went. With reduced motion only the chip bumps.
 */
export function FlyToTonight({
  card,
  from,
  to,
  onDone,
}: {
  card: Card;
  from: React.RefObject<HTMLElement | null>;
  to: React.RefObject<HTMLElement | null>;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const start = from.current?.getBoundingClientRect();
    const end = to.current?.getBoundingClientRect();
    if (!el || !start || !end || reduced()) {
      bump(to.current);
      onDone();
      return;
    }
    const w0 = Math.min(140, start.width * 0.45);
    const w1 = 22;
    const x0 = start.left + start.width / 2 - w0 / 2;
    const y0 = start.top + start.height * 0.35 - (w0 * 1.5) / 2;
    const x1 = end.left + end.width / 2 - w1 / 2;
    const y1 = end.top + end.height / 2 - (w1 * 1.5) / 2;
    const anim = el.animate(
      [
        { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 0 },
        { opacity: 1, offset: 0.15 },
        {
          transform: `translate(${x1}px, ${y1}px) scale(${w1 / w0})`,
          opacity: 0.7,
        },
      ],
      { duration: 450, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
    );
    el.style.width = `${w0}px`;
    anim.onfinish = () => {
      bump(to.current);
      onDone();
    };
    return () => anim.cancel();
    // Runs once per flight; the parent keys it by flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const src = card.poster_path
    ? `https://image.tmdb.org/t/p/w185${card.poster_path}`
    : null;
  return (
    <div ref={ref} className={styles.fly} aria-hidden="true">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" />
      )}
    </div>
  );
}
