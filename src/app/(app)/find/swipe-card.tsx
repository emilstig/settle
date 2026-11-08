"use client";

import Image from "next/image";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { Card } from "@/lib/deck";
import styles from "./find.module.css";

export type Dir = "left" | "right" | "up" | "down";
export type SwipeCardHandle = { fly: (dir: Dir) => Promise<void> };
/** Label and colour shown while dragging. Directions without a stamp are not allowed. */
export type Stamps = Partial<Record<Dir, [string, string]>>;

const FIND_STAMPS: Stamps = {
  right: ["Vill se", "var(--yes)"],
  left: ["Inte nu", "var(--no)"],
  up: ["Sett", "var(--seen)"],
};
const FLY: Record<Dir, string> = {
  right: "translate(600px,0) rotate(24deg)",
  left: "translate(-600px,0) rotate(-24deg)",
  up: "translate(0,-800px)",
  down: "translate(0,800px)",
};
const THRESHOLD = 90;
const vote = (v: number | null) => (v ? v.toFixed(1).replace(".", ",") : null);

function dirOf(dx: number, dy: number, stamps: Stamps): Dir | null {
  let dir: Dir | null = null;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > THRESHOLD) dir = "right";
    else if (dx < -THRESHOLD) dir = "left";
  } else if (dy < -THRESHOLD) dir = "up";
  else if (dy > THRESHOLD) dir = "down";
  return dir && stamps[dir] ? dir : null;
}

export function CardFace({ card, note = "Tryck för mer" }: { card: Card; note?: string | null }) {
  const img = card.poster_path ? `https://image.tmdb.org/t/p/w500${card.poster_path}` : null;
  const extra = [card.certification, vote(card.vote_average) ? `★ ${vote(card.vote_average)}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {img && <Image src={img} alt="" fill sizes="420px" className={styles.cardImg} draggable={false} priority />}
      <div className={styles.cardShade} />
      {card.year && <span className={styles.yr}>{card.year}</span>}
      <div className={styles.cardText}>
        <h2>{card.title}</h2>
        <div className={styles.meta}>{card.meta}</div>
        <div className={styles.meta}>
          {card.services.join(", ")}
          {extra ? ` · ${extra}` : ""}
        </div>
        {note && <div className={styles.flipnote}>{note}</div>}
      </div>
    </>
  );
}

type SwipeCardProps = {
  card: Card;
  onSwipe: (dir: Dir) => void;
  /** Without onTap the card only swipes (calibration). */
  onTap?: () => void;
  stamps?: Stamps;
};

/** The top card: drag to decide, tap to open. */
export const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(
  function SwipeCard({ card, onSwipe, onTap, stamps = FIND_STAMPS }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const start = useRef<{ x: number; y: number } | null>(null);
    const delta = useRef({ x: 0, y: 0 });
    const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
    const [flying, setFlying] = useState<Dir | null>(null);

    const fly = (dir: Dir) =>
      new Promise<void>((resolve) => {
        setDrag(null);
        setFlying(dir);
        setTimeout(resolve, 220);
      });
    useImperativeHandle(ref, () => ({ fly }));

    const current = flying ?? (drag ? dirOf(drag.x, drag.y, stamps) : null);
    const stamp = current ? stamps[current] : undefined;
    const transform = flying
      ? FLY[flying]
      : drag
        ? `translate(${drag.x}px,${drag.y}px) rotate(${drag.x / 18}deg)`
        : undefined;

    return (
      <div
        ref={el}
        className={`${styles.card} ${drag ? styles.dragging : ""}`}
        style={{ transform }}
        role={onTap ? "button" : undefined}
        tabIndex={onTap ? 0 : undefined}
        aria-label={onTap ? `${card.title}. Tryck för mer.` : card.title}
        onKeyDown={(e) => {
          if (onTap && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onTap();
          }
        }}
        onPointerDown={(e) => {
          if (flying) return;
          start.current = { x: e.clientX, y: e.clientY };
          delta.current = { x: 0, y: 0 };
          el.current?.setPointerCapture(e.pointerId);
          setDrag({ x: 0, y: 0 });
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          delta.current = { x: e.clientX - start.current.x, y: e.clientY - start.current.y };
          setDrag(delta.current);
        }}
        onPointerUp={() => {
          if (!start.current) return;
          start.current = null;
          const { x, y } = delta.current;
          const dir = dirOf(x, y, stamps);
          if (dir) {
            fly(dir).then(() => onSwipe(dir));
          } else {
            setDrag(null);
            if (onTap && Math.abs(x) < 6 && Math.abs(y) < 6) onTap();
          }
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}
      >
        <span
          className={styles.stamp}
          style={stamp ? { opacity: 1, background: stamp[1] } : undefined}
          aria-hidden="true"
        >
          {stamp ? stamp[0] : ""}
        </span>
        <CardFace card={card} note={onTap ? undefined : null} />
      </div>
    );
  },
);
