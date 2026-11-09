"use client";

import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";
import type { Card } from "@/lib/deck";
import styles from "./find.module.css";

const poster = (p: string | null) =>
  p ? `https://image.tmdb.org/t/p/w500${p}` : null;
const listSv = new Intl.ListFormat("sv", { type: "conjunction" });
const vote = (v: number | null) => (v ? v.toFixed(1).replace(".", ",") : null);

export function DetailView({
  card,
  trailerKey,
  imdbId,
  trailerLoading,
  fromDeck,
  onClose,
  onDecide,
  onChoose,
}: {
  card: Card;
  trailerKey: string | null;
  /** IMDb id (tt…) for a plain link out, no IMDb data is shown in the app. */
  imdbId: string | null;
  trailerLoading: boolean;
  fromDeck: boolean;
  onClose: () => void;
  onDecide: (dir: "left" | "up" | "right") => void;
  /** "Välj den här": sets tonight's choice. */
  onChoose: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const img = poster(card.poster_path);
  const facts = [
    vote(card.vote_average) ? `★ ${vote(card.vote_average)} på TMDB` : null,
    card.certification,
  ].filter(Boolean) as string[];

  return (
    <>
      <div
        className={styles.overlay}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
      >
        <div className={styles.dwrap}>
          <button
            ref={backRef}
            type="button"
            className={styles.dback}
            onClick={onClose}
          >
            ‹ Tillbaka
          </button>
          <div className={styles.dhero}>
            {img && (
              <Image
                src={img}
                alt=""
                fill
                sizes="420px"
                className={styles.heroImg}
              />
            )}
            <div className={styles.heroText}>
              {card.year && <span>{card.year}</span>}
              <h2 id="detail-title">{card.title}</h2>
              <div>{card.meta}</div>
            </div>
          </div>
          {card.reason && <p className={styles.dwhy}>{card.reason}</p>}
          <p className={styles.dplot}>
            {card.overview || "Ingen beskrivning på svenska än."}
          </p>
          {facts.length > 0 && (
            <div className={styles.dfacts}>
              {facts.map((f) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          )}
          <ul className={styles.dlist}>
            {card.providers_link && (
              <LinkRow
                href={card.providers_link}
                icon={
                  card.service_logos.length > 0 ? (
                    <span className={styles.dlogos}>
                      {card.service_logos.slice(0, 3).map((l) => (
                        <Image
                          key={l}
                          src={`https://image.tmdb.org/t/p/w92${l}`}
                          alt=""
                          width={32}
                          height={32}
                        />
                      ))}
                    </span>
                  ) : (
                    <span className={styles.dicon} aria-hidden="true">⌂</span>
                  )
                }
                label={
                  card.services.length
                    ? `Finns på ${listSv.format(card.services)}`
                    : "Var den finns"
                }
                source="via JustWatch"
              />
            )}
            {trailerKey ? (
              <LinkRow
                href={`https://www.youtube.com/watch?v=${trailerKey}`}
                icon={<span className={styles.dicon} aria-hidden="true">▶</span>}
                label="Se trailer"
                source="YouTube"
              />
            ) : (
              trailerLoading && (
                <li className={styles.dmuted}>Letar efter trailer …</li>
              )
            )}
            {imdbId && (
              <LinkRow
                href={`https://www.imdb.com/title/${imdbId}/`}
                icon={<span className={styles.dicon} aria-hidden="true">★</span>}
                label="Betyg och rollista"
                source="IMDb"
              />
            )}
          </ul>
        </div>
      </div>
      <div className={styles.dbar}>
        {fromDeck && (
          <>
            <button type="button" onClick={() => onDecide("left")}>
              ✕ Inte nu
            </button>
            <button type="button" onClick={() => onDecide("up")}>
              Sett
            </button>
            <button type="button" onClick={() => onDecide("right")}>
              ♥ Vill se
            </button>
          </>
        )}
        <button type="button" className={styles.dchoose} onClick={onChoose}>
          Välj den här
        </button>
      </div>
    </>
  );
}

function LinkRow({
  href,
  icon,
  label,
  source,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  source: string;
}) {
  return (
    <li>
      <a className={styles.drow} href={href} target="_blank" rel="noopener noreferrer">
        {icon}
        <span className={styles.drowText}>
          <span>{label}</span>
          <small>{source}</small>
        </span>
        <span className={styles.drowOut} aria-hidden="true">↗</span>
      </a>
    </li>
  );
}
