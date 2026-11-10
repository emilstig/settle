"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { HistoryItem, HistoryShelf } from "@/lib/history";
import { openDetail } from "../../find-actions";
import { DetailView } from "../../find/detail-view";
import { SeenSheet, type SeenAnswers } from "../../find/seen-sheet";
import { Toast } from "../../find/toast";
import type { GroupOption, ToastButton, ToastState } from "../../find/types";
import { useBackClose } from "../../find/use-back-close";
import find from "../../find/find.module.css";
import list from "../../list/list.module.css";
import {
  forgetSeen,
  liftNotForMe,
  restoreNotForMe,
  restoreSeen,
  setHistoryRating,
  setHistoryRewatch,
  undoHistoryRewatch,
} from "../actions";
import styles from "./history.module.css";

type Rating = HistoryItem["rating"];

/** Cards shown on a shelf before "Visa alla". */
const ON_SHELF = 12;
/**
 * Every shelf has small cards: Historik is a record to look things up in,
 * not a shelf to tempt, so no shelf weighs more than another.
 */
const SHELVES: { key: HistoryShelf; title: string }[] = [
  { key: "love", title: "Älskar" },
  { key: "like", title: "Gillar" },
  { key: "seen", title: "Sett utan betyg" },
  { key: "disliked", title: "Ogillade" },
  { key: "notForMe", title: "Inte min grej" },
];
const SHELF_TITLE = Object.fromEntries(
  SHELVES.map((s) => [s.key, s.title]),
) as Record<HistoryShelf, string>;

const RATING_WORD: Record<number, string> = {
  3: "Älskar",
  2: "Gillar mycket",
  1: "Gillar",
  [-1]: "Ogillade",
};

/** The same rule as on the server (shelfOf in lib/history). */
function shelfOf(rating: Rating, dropped: boolean): HistoryShelf {
  if (dropped || rating === -1) return "disliked";
  if (rating === 3) return "love";
  if (rating === 1 || rating === 2) return "like";
  return "seen";
}

/** A title can be on "Inte min grej" once per group. */
const keyOf = (i: HistoryItem) =>
  `${i.media_type}:${i.tmdb_id}:${i.groupId ?? ""}`;
const refOf = (i: HistoryItem) => ({
  tmdb_id: i.tmdb_id,
  media_type: i.media_type,
});
const listSv = new Intl.ListFormat("sv", { type: "conjunction" });

export function HistoryView({
  groups,
  items: initialItems,
}: {
  groups: GroupOption[];
  items: HistoryItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [full, setFull] = useState<HistoryShelf | null>(null);
  const [detail, setDetail] = useState<{
    item: HistoryItem;
    trailer: string | null;
    imdbId: string | null;
    loading: boolean;
  } | null>(null);
  const [sheet, setSheet] = useState<{
    item: HistoryItem;
    only: "rating" | "rewatch";
  } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastId = useRef(0);
  const fullRef = useRef<HTMLDivElement>(null);

  useBackClose(full !== null, () => setFull(null));
  useBackClose(detail !== null, () => setDetail(null));
  useBackClose(sheet !== null, () => setSheet(null));

  // "Visa alla" is all of Historik, opened at the shelf it was asked from.
  useEffect(() => {
    if (!full) return;
    fullRef.current
      ?.querySelector(`[data-shelf="${full}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [full]);

  const groupName = (id: string | null) =>
    groups.find((g) => g.id === id)?.name ?? "";
  const isSolo = (id: string | null) =>
    groups.find((g) => g.id === id)?.kind === "solo";
  /** "Inte min grej" with Själv, "Inte vår grej" with the others. */
  const notForMeWord = (i: HistoryItem) =>
    isSolo(i.groupId) ? "Inte min grej" : "Inte vår grej";
  /** The line under a title: how it was, or who it was said with. */
  const note = (i: HistoryItem) =>
    i.shelf === "notForMe"
      ? groupName(i.groupId)
      : i.dropped
        ? "Avbruten"
        : i.rating !== null
          ? RATING_WORD[i.rating]
          : null;

  const showToast = (text: string, buttons: ToastButton[] = [], ms = 2200) => {
    setToast({ id: ++toastId.current, text, buttons, ms });
  };
  const replace = (from: HistoryItem, to: HistoryItem) => {
    setItems((list) => list.map((i) => (keyOf(i) === keyOf(from) ? to : i)));
    setDetail((d) =>
      d && keyOf(d.item) === keyOf(from) ? { ...d, item: to } : d,
    );
  };
  /** Out of Historik: the view closes, and "Ångra" puts it back. */
  const takeOut = (item: HistoryItem) => {
    const before = items;
    setItems((list) => list.filter((i) => keyOf(i) !== keyOf(item)));
    setDetail(null);
    return () => setItems(before);
  };

  function open(item: HistoryItem) {
    setDetail({ item, trailer: null, imdbId: null, loading: true });
    openDetail({ sessionId: null, ref: refOf(item), source: null })
      .then((r) =>
        setDetail((d) =>
          d && d.item === item
            ? { ...d, trailer: r.trailerKey, imdbId: r.imdbId, loading: false }
            : d,
        ),
      )
      .catch(() =>
        setDetail((d) => (d && d.item === item ? { ...d, loading: false } : d)),
      );
  }

  /**
   * A new rating is a state: the title stays in Historik (perhaps on
   * another shelf) and the view stays open. No "Ångra", since the same
   * button takes it back.
   */
  async function rate(item: HistoryItem, rating: Exclude<Rating, null>) {
    if (rating === item.rating) return;
    const shelf = shelfOf(rating, item.dropped);
    const updated = { ...item, rating, shelf };
    replace(item, updated);
    showToast(
      shelf !== item.shelf
        ? `Flyttad till ${SHELF_TITLE[shelf]}`
        : `Ändrat till ${RATING_WORD[rating].toLowerCase()}`,
    );
    try {
      await setHistoryRating({ ref: refOf(item), rating });
    } catch (e) {
      console.error(e);
      replace(updated, item);
      showToast("Det gick inte att spara");
    }
  }

  /** Se igen: onto the groups' lists, so it leaves for Att se om. */
  async function rewatch(item: HistoryItem, groupIds: string[]) {
    const putBack = takeOut(item);
    try {
      const added = await setHistoryRewatch({ ref: refOf(item), groupIds });
      const names = groups.filter((g) => added.includes(g.id));
      showToast(
        names.length === 1 && names[0].kind === "solo"
          ? "Sparad att se om"
          : `Sparad att se om med ${listSv.format(names.map((g) => g.name))}`,
        [
          {
            label: "Ångra",
            onClick: () => {
              putBack();
              undoHistoryRewatch({ ref: refOf(item), groupIds: added }).catch(
                (e) => {
                  console.error(e);
                  router.refresh();
                },
              );
            },
          },
        ],
        4000,
      );
    } catch (e) {
      console.error(e);
      putBack();
      showToast("Det gick inte att spara");
    }
  }

  /** "Inte sett": never seen after all. Out of Historik, with "Ångra". */
  async function unseen(item: HistoryItem) {
    const putBack = takeOut(item);
    try {
      const prev = await forgetSeen({ ref: refOf(item) });
      showToast(
        "Markerad som inte sett",
        [
          {
            label: "Ångra",
            onClick: () => {
              putBack();
              restoreSeen({ ref: refOf(item), ...prev }).catch((e) => {
                console.error(e);
                router.refresh();
              });
            },
          },
        ],
        4000,
      );
    } catch (e) {
      console.error(e);
      putBack();
      showToast("Det gick inte att spara");
    }
  }

  /** Lifts "Inte min grej": it can be suggested with the group again. */
  async function lift(item: HistoryItem) {
    if (!item.groupId) return;
    const putBack = takeOut(item);
    try {
      const ids = await liftNotForMe({
        ref: refOf(item),
        groupId: item.groupId,
      });
      showToast(
        isSolo(item.groupId)
          ? "Kan föreslås igen"
          : `Kan föreslås igen med ${groupName(item.groupId)}`,
        [
          {
            label: "Ångra",
            onClick: () => {
              putBack();
              restoreNotForMe({ ids }).catch((e) => {
                console.error(e);
                router.refresh();
              });
            },
          },
        ],
        4000,
      );
    } catch (e) {
      console.error(e);
      putBack();
      showToast("Det gick inte att spara");
    }
  }

  function finishSheet(answers: SeenAnswers) {
    if (!sheet) return;
    const { item, only } = sheet;
    setSheet(null);
    if (only === "rating" && answers.rating !== null)
      void rate(item, answers.rating);
    // "Nej, inte igen" and the cross: it was not on any list, so nothing.
    if (only === "rewatch" && answers.rewatchGroupIds?.length)
      void rewatch(item, answers.rewatchGroupIds);
  }

  const shelves = SHELVES.map((s) => ({
    ...s,
    items: items.filter((i) => i.shelf === s.key),
  })).filter((s) => s.items.length > 0);

  return (
    <>
      {shelves.length === 0 && (
        <p className={list.empty}>
          Inget här än. Det du sett, betygsatt eller sagt ”Inte min grej” om
          hamnar här.
        </p>
      )}

      {shelves.map((s) => (
        <section key={s.key} className={list.shelf} aria-label={s.title}>
          <div className={list.shelfHead}>
            <h2>{s.title}</h2>
            <button
              type="button"
              className="link"
              onClick={() => setFull(s.key)}
            >
              Visa alla {s.items.length > ON_SHELF ? `(${s.items.length})` : ""}
            </button>
          </div>
          <ul className={list.row}>
            {s.items.slice(0, ON_SHELF).map((i) => (
              <li key={keyOf(i)}>
                <button
                  type="button"
                  className={`${list.poster} ${list.s}`}
                  aria-label={i.title}
                  onClick={() => open(i)}
                >
                  {i.poster_path ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w342${i.poster_path}`}
                      alt=""
                      fill
                      sizes="104px"
                    />
                  ) : (
                    <span className={list.noPoster}>{i.title}</span>
                  )}
                </button>
                {(s.key === "notForMe" || s.key === "like" || i.dropped) && (
                  <span className={list.elsewhere}>{note(i)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {full && (
        <div
          className={list.full}
          role="dialog"
          aria-modal="true"
          aria-label="Historik"
          ref={fullRef}
        >
          <div className={list.fullWrap}>
            <button
              type="button"
              className={find.dback}
              onClick={() => setFull(null)}
            >
              ‹ Tillbaka
            </button>
            <h2 className="q">Historik</h2>
            {shelves.map((s) => (
              <section
                key={s.key}
                data-shelf={s.key}
                className={styles.group}
                aria-label={s.title}
              >
                <h3>
                  {s.title} <span>{s.items.length}</span>
                </h3>
                <ul className={`${find.tonightList} ${list.fullList}`}>
                  {s.items.map((i) => {
                    const info = [
                      i.media_type === "movie" ? "Film" : "Serie",
                      i.year,
                      note(i),
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={keyOf(i)} className={find.tonightRow}>
                        <button
                          type="button"
                          className={find.tonightOpen}
                          aria-label={`Visa ${i.title}`}
                          onClick={() => open(i)}
                        >
                          <span className={find.tonightThumb}>
                            {i.poster_path && (
                              <Image
                                src={`https://image.tmdb.org/t/p/w92${i.poster_path}`}
                                alt=""
                                fill
                                sizes="44px"
                              />
                            )}
                          </span>
                          <span className={find.tonightText}>
                            <strong>{i.title}</strong>
                            <span>{info}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}

      {detail && (
        <DetailView
          card={detail.item}
          trailerKey={detail.trailer}
          imdbId={detail.imdbId}
          trailerLoading={detail.loading}
          actions="history"
          onClose={() => setDetail(null)}
          onDecide={() => {}}
          onChoose={() => {}}
          history={
            detail.item.shelf === "notForMe"
              ? {
                  kind: "notForMe",
                  label: notForMeWord(detail.item),
                  onLift: () => void lift(detail.item),
                }
              : {
                  kind: "seen",
                  ratingWord:
                    detail.item.rating !== null
                      ? RATING_WORD[detail.item.rating]
                      : "Betyg",
                  rated: detail.item.rating !== null,
                  onRate: () => setSheet({ item: detail.item, only: "rating" }),
                  onRewatch: () =>
                    setSheet({ item: detail.item, only: "rewatch" }),
                  onUnseen: () => void unseen(detail.item),
                }
          }
        />
      )}

      {sheet && (
        <SeenSheet
          title={sheet.item.title}
          groups={groups}
          only={sheet.only}
          rating={sheet.item.rating}
          onDone={finishSheet}
        />
      )}

      <Toast key={toast?.id} toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
