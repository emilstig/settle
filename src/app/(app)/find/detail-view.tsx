"use client";

import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";
import type { Card } from "@/lib/deck";
import {
  DECISION_ORDER,
  DECISION_WORD,
  DecisionIcon,
} from "./decision-icons";
import type { Dir } from "./swipe-card";
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
  actions,
  chosen = false,
  onClose,
  onDecide,
  onChoose,
  list,
  groupsRow,
}: {
  card: Card;
  trailerKey: string | null;
  /** IMDb id (tt…) for a plain link out, no IMDb data is shown in the app. */
  imdbId: string | null;
  trailerLoading: boolean;
  /**
   * The decisions that fit where it was opened: the deck has them all,
   * Ikväll only "Välj den här" (it is saved already), Att se its list
   * actions (see `list`), the end view none.
   */
  actions: "deck" | "choose" | "list" | "none";
  /** It is tonight's choice already. */
  chosen?: boolean;
  onClose: () => void;
  onDecide: (dir: Dir) => void;
  /** "Välj den här": sets tonight's choice. */
  onChoose: () => void;
  /**
   * From Att se: take it off the list, toggle "Vill gärna", or put it in
   * Ikväll (or take it out) to compare with the evening's other candidates.
   */
  list?: {
    wanted: boolean;
    onRemove: () => void;
    onWant?: () => void;
    tonight: boolean;
    onTonight: () => void;
  };
  /**
   * A text link under "Välj den här" that opens the group sheet: "Med annan
   * grupp" in Att se, "Spara för en annan grupp" in the deck.
   */
  groupsRow?: { label: string; onClick: () => void };
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
        className={`${styles.overlay} ${
          actions === "deck" || actions === "list" ? styles.withBar : ""
        }`}
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
                    <span className={styles.dicon} aria-hidden="true">
                      ⌂
                    </span>
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
                icon={
                  <span className={styles.dicon} aria-hidden="true">
                    ▶
                  </span>
                }
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
                icon={
                  <span className={styles.dicon} aria-hidden="true">
                    ★
                  </span>
                }
                label="Betyg och rollista"
                source="IMDb"
              />
            )}
          </ul>
          {/* The choice rides above the bar while reading and rests after
              the links, so it is there after a look at IMDb too. The group
              link is a smaller second step under it. */}
          {actions !== "none" && (
            <>
              <div className={styles.dstick}>
                <button
                  type="button"
                  className="primary"
                  onClick={onChoose}
                  disabled={chosen}
                >
                  {chosen ? "Vald för ikväll" : "Välj den här"}
                </button>
              </div>
              {groupsRow && (
                <button
                  type="button"
                  className={styles.dgroupsLink}
                  onClick={groupsRow.onClick}
                >
                  {groupsRow.label}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {/* The decisions, with the deck's icons and a word. From Ikväll
          and the end view there is none to take here. */}
      {actions === "deck" && (
        <div className={`${styles.dbar} ${styles.decide}`}>
          {DECISION_ORDER.map((d) => (
            <button key={d} type="button" onClick={() => onDecide(d)}>
              <DecisionIcon dir={d} />
              <span>{DECISION_WORD[d]}</span>
            </button>
          ))}
        </div>
      )}
      {actions === "list" && list && (
        <div className={styles.dbar}>
          <button type="button" onClick={list.onRemove}>
            Ta bort
          </button>
          {list.onWant && (
            <button
              type="button"
              aria-pressed={list.wanted}
              onClick={list.onWant}
            >
              {list.wanted ? "✓ Vill gärna" : "Vill gärna"}
            </button>
          )}
          <button
            type="button"
            aria-pressed={list.tonight}
            aria-label="Ikväll"
            onClick={list.onTonight}
          >
            {list.tonight ? "✓ Ikväll" : "+ Ikväll"}
          </button>
        </div>
      )}
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
      <a
        className={styles.drow}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {icon}
        <span className={styles.drowText}>
          <span>{label}</span>
          <small>{source}</small>
        </span>
        <span className={styles.drowOut} aria-hidden="true">
          ↗
        </span>
      </a>
    </li>
  );
}
