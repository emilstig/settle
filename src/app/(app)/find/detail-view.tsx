"use client";

import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";
import type { Card } from "@/lib/deck";
import {
  DECISION_ORDER,
  DECISION_WORD,
  DecisionIcon,
  HistoryIcon,
  ListIcon,
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
  rtPath,
  trailerLoading,
  actions,
  chosen = false,
  onClose,
  onDecide,
  onChoose,
  list,
  history,
  groupsRow,
}: {
  card: Card;
  trailerKey: string | null;
  /** IMDb id (tt…) for a plain link out, no IMDb data is shown in the app. */
  imdbId: string | null;
  /** Rotten Tomatoes path (m/… or tv/…) for a plain link out to its reviews. */
  rtPath: string | null;
  trailerLoading: boolean;
  /**
   * The decisions that fit where it was opened: the deck its four, Ikväll
   * only "Välj den här" (it is saved already), Att se its list actions (see
   * `list`), the end view none.
   */
  actions: "deck" | "choose" | "list" | "history" | "none";
  /** It is tonight's choice already. */
  chosen?: boolean;
  onClose: () => void;
  onDecide: (dir: Dir) => void;
  /** "Välj den här": sets tonight's choice. */
  onChoose: () => void;
  /**
   * From Att se. Ta bort and Sett take it out of the view; Vill gärna and
   * Grupper change a state and leave the view open. The primary button is
   * the evening's next step: "Spara till ikväll", then "Välj den här".
   */
  list?: {
    wanted: boolean;
    onRemove: () => void;
    onWant?: () => void;
    onSeen: () => void;
    /** Absent with Själv as the only group. */
    onGroups?: () => void;
    tonight: boolean;
    onTonight: () => void;
  };
  /**
   * From Historik in Profil. A new rating is a state: the view stays. Se
   * igen, Inte sett and lifting "Inte min grej" take the title out of
   * Historik and close the view. No primary button: nothing here is a step
   * towards tonight.
   */
  history?:
    | {
        kind: "seen";
        /** The word on the rating button: "Älskar", or "Betyg" when unrated. */
        ratingWord: string;
        rated: boolean;
        /** The group the rating was made with, when it is not Själv. */
        ratedWith?: string | null;
        onRate: () => void;
        onRewatch: () => void;
        onUnseen: () => void;
      }
    | { kind: "notForMe"; label: string; onLift: () => void };
  /**
   * The deck's "Spara för en annan grupp": a text link where the primary
   * button would be, since ♥ Vill se is the deck's step towards tonight.
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
          actions === "deck" || actions === "list" || actions === "history"
            ? styles.withBar
            : ""
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
            {rtPath && (
              <LinkRow
                href={`https://www.rottentomatoes.com/${rtPath}`}
                icon={
                  <span className={styles.dicon} aria-hidden="true">
                    ❝
                  </span>
                }
                label="Recensioner"
                source="Rotten Tomatoes"
              />
            )}
          </ul>
          {/* The evening's next step rides above the bar while reading and
              rests after the links, so it is there after a look at IMDb
              too. "Välj den här" only for a title in Ikväll: choosing is the
              last step, after the shortlist. */}
          {actions === "choose" && (
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
          )}
          {actions === "list" && list && (
            <div className={styles.dstick}>
              {list.tonight && !chosen && (
                <p className={styles.dstate}>Sparad till ikväll</p>
              )}
              <button
                type="button"
                className="primary"
                onClick={list.tonight ? onChoose : list.onTonight}
                disabled={chosen}
              >
                {chosen
                  ? "Vald för ikväll"
                  : list.tonight
                    ? "Välj den här"
                    : "Spara till ikväll"}
              </button>
            </div>
          )}
          {actions === "history" &&
            history?.kind === "seen" &&
            history.ratedWith && (
              <p className={`${styles.dstate} ${styles.dnote}`}>
                Betyg gjort med {history.ratedWith}
              </p>
            )}
          {actions === "deck" && groupsRow && (
            <button
              type="button"
              className={styles.dgroupsLink}
              onClick={groupsRow.onClick}
            >
              {groupsRow.label}
            </button>
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
        <div className={`${styles.dbar} ${styles.decide}`}>
          <button type="button" onClick={list.onRemove}>
            <ListIcon kind="remove" />
            <span>Ta bort</span>
          </button>
          {list.onWant && (
            <button
              type="button"
              aria-pressed={list.wanted}
              className={list.wanted ? styles.don : undefined}
              onClick={list.onWant}
            >
              <ListIcon kind="want" on={list.wanted} />
              <span>Vill gärna</span>
            </button>
          )}
          <button type="button" onClick={list.onSeen}>
            <ListIcon kind="seen" />
            <span>Sett</span>
          </button>
          {list.onGroups && (
            <button type="button" onClick={list.onGroups}>
              <ListIcon kind="groups" />
              <span>Grupper</span>
            </button>
          )}
        </div>
      )}
      {actions === "history" && history?.kind === "seen" && (
        <div className={`${styles.dbar} ${styles.decide}`}>
          <button
            type="button"
            className={history.rated ? styles.don : undefined}
            onClick={history.onRate}
          >
            <HistoryIcon kind="rate" on={history.rated} />
            <span>{history.ratingWord}</span>
          </button>
          <button type="button" onClick={history.onRewatch}>
            <HistoryIcon kind="rewatch" />
            <span>Se igen</span>
          </button>
          <button type="button" onClick={history.onUnseen}>
            <HistoryIcon kind="unseen" />
            <span>Inte sett</span>
          </button>
        </div>
      )}
      {actions === "history" && history?.kind === "notForMe" && (
        <div className={`${styles.dbar} ${styles.decide}`}>
          <button
            type="button"
            aria-pressed="true"
            className={styles.don}
            onClick={history.onLift}
          >
            <HistoryIcon kind="notForMe" on />
            <span>{history.label}</span>
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
