"use client";

import Image from "next/image";
import { useState } from "react";
import { formatRuntime } from "@/lib/format";
import type { Card } from "@/lib/deck";
import styles from "./find.module.css";

const SORTS = [
  ["latest", "Senast"],
  ["rating", "Betyg"],
  ["short", "Kortast"],
] as const;
type Sort = (typeof SORTS)[number][0];

const thumb = (p: string | null) =>
  p ? `https://image.tmdb.org/t/p/w92${p}` : null;
const vote = (v: number | null) => (v ? v.toFixed(1).replace(".", ",") : null);
const length = (c: Card) =>
  c.runtime === null
    ? null
    : c.media_type === "movie"
      ? formatRuntime(c.runtime)
      : `${c.runtime} min/avsnitt`;

/** Tonight's shortlist: what was saved tonight, latest first, each with "Välj". */
export function TonightSheet({
  items,
  chosen,
  busy,
  onChoose,
  onRemove,
  onClose,
  together = false,
}: {
  items: Card[];
  /** Tonight's choice, if made. */
  chosen: Card | null;
  busy: boolean;
  onChoose: (card: Card) => void;
  /** Takes it off tonight; it stays on the group's list. */
  onRemove: (card: Card) => void;
  onClose: () => void;
  /** The group is not Själv, so the text says "ni". */
  together?: boolean;
}) {
  const keyOf = (c: Card) => `${c.media_type}:${c.tmdb_id}`;
  const chosenKey = chosen ? keyOf(chosen) : null;
  const [sort, setSort] = useState<Sort>("latest");
  const sorted =
    sort === "latest"
      ? items
      : [...items].sort((a, b) =>
          sort === "rating"
            ? (b.vote_average ?? 0) - (a.vote_average ?? 0)
            : (a.runtime ?? Infinity) - (b.runtime ?? Infinity),
        );

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div
        className={`${styles.sheet} ${styles.sheetOpen}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tonight-title"
      >
        <div className={styles.sheetHead}>
          <h3 id="tonight-title">Ikväll</h3>
          <button
            type="button"
            className={styles.sheetClose}
            aria-label="Stäng"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <p>
          Det {together ? "ni" : "du"} har sparat ikväll. Det du tar bort
          ligger kvar i Lista.
        </p>
        {items.length === 0 && (
          <p className={styles.tonightEmpty}>Inget sparat ikväll.</p>
        )}
        <div className="chips" role="group" aria-label="Sortera">
          {SORTS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={sort === value}
              onClick={() => setSort(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <ul className={styles.tonightList}>
          {sorted.map((card) => {
            const img = thumb(card.poster_path);
            const info = [
              card.media_type === "movie" ? "Film" : "Serie",
              length(card),
              vote(card.vote_average) ? `★ ${vote(card.vote_average)}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const isChosen = keyOf(card) === chosenKey;
            return (
              <li key={keyOf(card)} className={styles.tonightRow}>
                <div className={styles.tonightThumb}>
                  {img && <Image src={img} alt="" fill sizes="44px" />}
                </div>
                <div className={styles.tonightText}>
                  <strong>{card.title}</strong>
                  <span>{info}</span>
                </div>
                <button
                  type="button"
                  disabled={busy || isChosen}
                  onClick={() => onChoose(card)}
                >
                  {isChosen ? "Vald" : "Välj"}
                </button>
                <button
                  type="button"
                  className={styles.tonightRemove}
                  aria-label={`Ta bort ${card.title} från ikväll`}
                  disabled={busy}
                  onClick={() => onRemove(card)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className={styles.sheetSkip} onClick={onClose}>
          Fortsätt leta
        </button>
      </div>
    </>
  );
}

/** After "Välj": what tonight will be, where to watch it, and a way back. */
export function ChosenView({
  card,
  busy,
  onChange,
  onDone,
}: {
  card: Card;
  busy: boolean;
  onChange: () => void;
  onDone: () => void;
}) {
  const img = card.poster_path
    ? `https://image.tmdb.org/t/p/w500${card.poster_path}`
    : null;
  return (
    <div className={styles.chosen}>
      <p className={styles.chosenLead}>Ikväll blir det</p>
      <div className={styles.chosenPoster}>
        {img && (
          <Image
            src={img}
            alt=""
            fill
            sizes="240px"
            className={styles.cardImg}
          />
        )}
      </div>
      <h1 className="q">{card.title}</h1>
      <p className={styles.chosenMeta}>{card.meta}</p>
      {card.services.length > 0 && (
        <p className={styles.chosenMeta}>På {card.services.join(", ")}</p>
      )}
      {card.providers_link && (
        <a
          className="primary"
          href={card.providers_link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Se var den finns
        </a>
      )}
      <div className={styles.chosenActions}>
        <button
          type="button"
          className="link"
          onClick={onChange}
          disabled={busy}
        >
          Ändra
        </button>
        <button type="button" className="link" onClick={onDone}>
          Till startsidan
        </button>
      </div>
    </div>
  );
}
