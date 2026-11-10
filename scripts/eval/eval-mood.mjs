// Compares how free-text moods turn into a deck: today's prompt 1 against a
// draft v2 (more TMDB fields, plus Claude naming titles in the style).
// Run: node --env-file=.env.local scripts/eval/eval-mood.mjs [phrase-index …]
// Writes scripts/eval/out/eval-<timestamp>.md. Reads nothing from the
// database and writes nothing to it: the deck here has no user history, no
// taste profile and no prompt 2, so it shows the fetch, not the whole app.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

// "I dag" is prompt 1 before v3, kept here as the baseline; v3 and the
// style call are the app's own prompts, so the eval tests what runs.
const { PARSE_PROMPT: APP_PARSE, STYLE_PROMPT: APP_STYLE } = await import(
  new URL("../../src/lib/suggest/prompts.ts", import.meta.url)
);
const PARSE_PROMPT = readFileSync(new URL("./baseline-prompt1.txt", import.meta.url), "utf8");

/** The services from the user's screenshot: Netflix, Disney+, SVT Play, TV4 Play, HBO Max. */
const PROVIDERS = [8, 337, 493, 1944, 1899];
const MONETIZATION = "flatrate|free|ads";
const MODEL = "claude-haiku-5-5";
/** Model for the style titles: --style-model=claude-sonnet-5-5 to compare. */
const STYLE_MODEL =
  process.argv.find((a) => a.startsWith("--style-model="))?.split("=")[1] ?? "claude-sonnet-5-5";
const SHOW = 10;

const phrases = JSON.parse(
  readFileSync(new URL("./phrases.json", import.meta.url), "utf8"),
);
const pick = process.argv.slice(2).filter((a) => !a.startsWith("--")).map(Number);
const run = (pick.length ? pick : phrases.map((_, i) => i)).map((i) => [i, phrases[i]]);

/** Titles compared loosely: case, punctuation and "The" do not matter. */
const norm = (t) => t.toLowerCase().replace(/^the /, "").replace(/[^\p{L}\p{N}]+/gu, "");
/** How many of the first cards the user named as right, and as wrong. */
function score(cards, phrase) {
  const has = (list) => cards.filter((c) => list.some((t) => [c.title, c.orig].filter(Boolean).some((x) => norm(x) === norm(t)))).length;
  return { good: has(phrase.good), bad: has(phrase.bad) };
}

// ---------------------------------------------------------------------------
// TMDB
// ---------------------------------------------------------------------------

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}` },
    });
    if (res.ok) return res.json();
    if (attempt >= 2 || !(res.status === 429 || res.status >= 500))
      throw new Error(`TMDB ${res.status} on ${path}`);
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
}

async function genres() {
  const [m, t] = await Promise.all([
    tmdb("/genre/movie/list", { language: "sv-SE" }),
    tmdb("/genre/tv/list", { language: "sv-SE" }),
  ]);
  const names = {};
  for (const g of [...t.genres, ...m.genres]) names[g.id] = g.name;
  return { names, movie: new Set(m.genres.map((g) => g.id)), tv: new Set(t.genres.map((g) => g.id)) };
}
const G = await genres();

async function discover(type, filters, sortBy, page = 1) {
  const d = await tmdb(`/discover/${type}`, {
    watch_region: "SE",
    with_watch_providers: PROVIDERS.join("|"),
    with_watch_monetization_types: MONETIZATION,
    language: "sv-SE",
    include_adult: "false",
    sort_by: sortBy,
    page,
    ...filters,
  });
  return {
    total: d.total_results,
    hits: d.results.map((r) => ({
      id: r.id,
      type,
      title: r.title ?? r.name,
      orig: r.original_title ?? r.original_name,
      year: (r.release_date ?? r.first_air_date ?? "").slice(0, 4),
      vote: r.vote_average,
      votes: r.vote_count,
      genres: r.genre_ids,
    })),
  };
}

/** Like loadDeckPage without the user's history: films and series take turns. */
async function deck(filters, want = SHOW) {
  const out = [];
  let total = 0;
  for (let page = 1; page <= 3 && out.length < want; page++) {
    const res = await Promise.all(
      filters.mediaTypes.map((t) => discover(t, filters[t], filters.sortBy, page)),
    );
    if (page === 1) total = res.reduce((s, r) => s + r.total, 0);
    const longest = Math.max(0, ...res.map((r) => r.hits.length));
    for (let i = 0; i < longest; i++) for (const r of res) if (r.hits[i]) out.push(r.hits[i]);
    if (res.every((r) => r.hits.length < 20)) break;
  }
  return { total, cards: out };
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const anthropic = new Anthropic();

async function askJson(prompt, schema, model = MODEL) {
  const started = Date.now();
  const res = await anthropic.messages.create({
    model,
    max_tokens: 4000,
    // Haiku turns thinking off with "disabled"; Sonnet 5.5 with "between_tools".
    thinking: { type: model.includes("haiku") ? "disabled" : "between_tools" },
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { json: JSON.parse(text), ms: Date.now() - started };
}

const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
const genreList = Object.entries(G.names).map(([id, n]) => `${id}: ${n}`).join("\n");
const base = (mood) => ({ GENRES: genreList, GROUP: '{"kind":"solo"}', QUICK_PICKS: "Inga", MOOD_TEXT: mood });

const nullableNum = { type: ["number", "null"] };
const V1_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["media_type", "with_genres", "without_genres", "languages", "max_runtime", "min_vote", "era", "comfort", "novelty", "vibe"],
  properties: {
    media_type: { enum: ["movie", "tv", "any"] },
    with_genres: { type: "array", items: { type: "number" } },
    without_genres: { type: "array", items: { type: "number" } },
    languages: { type: "array", items: { type: "string" } },
    max_runtime: nullableNum,
    min_vote: nullableNum,
    era: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: nullableNum, to: nullableNum } },
    comfort: { type: "boolean" },
    novelty: { enum: ["low", "medium", "high"] },
    vibe: { type: "string" },
  },
};

// ---- Draft v3 of prompt 1: TMDB's own fields, no rules per wish. ----

const V2_PROMPT = APP_PARSE;

// ---- The style call: Claude names titles, run next to prompt 1. ----

const STYLE_PROMPT = APP_STYLE;

const strArr = { type: "array", items: { type: "string" } };
const numArr = { type: "array", items: { type: "number" } };
const V2_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["media_type", "with_genres", "required_genres", "without_genres", "origin_countries", "languages", "people", "companies", "keywords", "without_keywords", "max_runtime", "min_vote", "era", "sort", "tv_ended", "tv_miniseries", "comfort", "novelty", "vibe", "label"],
  properties: {
    ...V1_SCHEMA.properties,
    required_genres: numArr,
    origin_countries: strArr,
    people: strArr,
    companies: strArr,
    keywords: strArr,
    without_keywords: strArr,
    sort: { enum: ["popularity", "votes", "rating", "newest"] },
    tv_ended: { type: "boolean" },
    tv_miniseries: { type: "boolean" },
    label: { type: "string" },
  },
};
const STYLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titles"],
  properties: {
    titles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "year", "media_type"],
        properties: { title: { type: "string" }, year: { type: "number" }, media_type: { enum: ["movie", "tv"] } },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Filters: today's applyParsed, ported, and v2 on top of it
// ---------------------------------------------------------------------------

const FILM_TO_TV = { 878: [10765], 14: [10765], 28: [10759], 12: [10759], 10752: [10768], 53: [80, 9648], 27: [9648] };
const TV_TO_FILM = { 10765: [878, 14], 10759: [28, 12], 10768: [10752], 10762: [10751] };
const uniq = (a) => [...new Set(a)];
const forType = (ids, type) =>
  uniq(ids.flatMap((g) => (G[type].has(g) ? [g] : ((type === "tv" ? FILM_TO_TV[g] : TV_TO_FILM[g]) ?? [])))).filter((g) => G[type].has(g));

function baseFilters() {
  return { mediaTypes: ["movie", "tv"], movie: { "vote_count.gte": 100 }, tv: { "vote_count.gte": 50 }, sortBy: "popularity.desc" };
}

function applyV1(p) {
  const out = baseFilters();
  let types = p.media_type === "any" ? out.mediaTypes : [p.media_type];
  for (const type of ["movie", "tv"]) {
    const f = out[type];
    if (p.with_genres.length) {
      const g = forType(p.with_genres, type);
      if (g.length === 0) types = types.filter((t) => t !== type);
      else f.with_genres = g.join("|");
    }
    const without = forType(p.without_genres, type);
    if (without.length) f.without_genres = without.join(",");
    if (p.languages.length) f.with_original_language = p.languages.join("|");
    if (p.max_runtime && (type === "movie" || p.max_runtime <= 60)) f["with_runtime.lte"] = Math.round(p.max_runtime);
    if (p.min_vote) {
      f["vote_average.gte"] = p.min_vote;
      f["vote_count.gte"] = Math.max(f["vote_count.gte"], type === "movie" ? 200 : 100);
    }
    const date = type === "movie" ? "primary_release_date" : "first_air_date";
    if (p.era.from) f[`${date}.gte`] = `${p.era.from}-01-01`;
    if (p.era.to) f[`${date}.lte`] = `${p.era.to}-12-31`;
  }
  out.mediaTypes = types.length ? types : out.mediaTypes;
  if (p.comfort) out.sortBy = "vote_count.desc";
  return out;
}

const lookups = new Map();
async function lookup(kind, name) {
  const k = `${kind}:${name.toLowerCase()}`;
  if (lookups.has(k)) return lookups.get(k);
  const res = (await tmdb(`/search/${kind}`, { query: name })).results ?? [];
  const exact = res.filter((r) => r.name?.toLowerCase() === name.toLowerCase());
  // Companies share names (there are several "A24"): the real studio is the
  // one with the most films. People: the most popular with that name.
  const counted =
    kind === "company"
      ? await Promise.all(
          exact.slice(0, 5).map(async (r) => ({
            r,
            n: (await tmdb("/discover/movie", { with_companies: r.id })).total_results,
          })),
        )
      : [];
  const hit =
    kind === "company"
      ? (counted.sort((a, b) => b.n - a.n)[0]?.r ?? null)
      : kind === "person"
        ? [...(exact.length ? exact : res)].sort((a, b) => b.popularity - a.popularity)[0]
        : (exact[0] ?? null);
  const id = hit?.id ?? null;
  lookups.set(k, id);
  return id;
}

async function applyV2(p, level = 0) {
  const out = applyV1({ ...p, languages: p.languages });
  const ids = async (kind, names) => (await Promise.all(names.map((n) => lookup(kind, n)))).filter(Boolean);
  const [people, companies, keywords, without] = await Promise.all([
    ids("person", p.people),
    ids("company", p.companies),
    ids("keyword", p.keywords),
    ids("keyword", p.without_keywords),
  ]);
  const sorts = { popularity: "popularity.desc", votes: "vote_count.desc", rating: "vote_average.desc", newest: null };
  if (!p.comfort && sorts[p.sort]) out.sortBy = sorts[p.sort];
  for (const type of ["movie", "tv"]) {
    const f = out[type];
    if (p.origin_countries.length) f.with_origin_country = p.origin_countries.join("|");
    const required = forType(p.required_genres, type);
    // Level 1 lets go of the narrow fields, level 2 of genres as well.
    if (level < 1) {
      if (type === "movie" && people.length) f.with_people = people.join("|");
      if (companies.length) f.with_companies = companies.join("|");
      if (keywords.length) f.with_keywords = keywords.join("|");
    }
    if (required.length && level < 2) {
      // Comma means and in TMDB: every required genre, then any of the rest.
      f.with_genres = required.join(","); // as in the app: required genres replace "any of"
    }
    if (without.length) f.without_keywords = without.join(",");
    if (p.sort === "newest") out.sortBy = type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
    // "Highest rated" among what people have seen: a real floor of votes,
    // or new titles with a handful of votes and 9+ come first.
    if (out.sortBy === "vote_average.desc") f["vote_count.gte"] = Math.max(f["vote_count.gte"], type === "movie" ? 1000 : 300);
    if (type === "tv" && p.tv_ended) f.with_status = "3"; // Ended
    if (type === "tv" && p.tv_miniseries) f.with_type = "2"; // Miniseries
    if (level >= 2) delete f.with_genres;
  }
  // People only work on films in discover (no with_people for series).
  if (people.length && level < 1) out.mediaTypes = out.mediaTypes.filter((t) => t === "movie");
  if (!out.mediaTypes.length) out.mediaTypes = ["movie"];
  return { filters: out, resolved: { people, companies, keywords, without } };
}

/** Claude's titles in the style, found in TMDB by title and year, kept when on the services. */
/**
 * Claude's titles in the style, found in TMDB by title and year. They pass
 * the same hard limits as the deck: the services, film or series, length,
 * era, lowest rating, required genres and, for Familj, the Swedish age
 * limit. The style is Claude's; the limits are the user's.
 */
async function styleTitles(list, filters, parsed, maxCert = null) {
  const found = await Promise.all(
    list.map(async ({ title, year, media_type }) => {
      const kind = media_type === "tv" ? "tv" : "movie";
      if (!filters.mediaTypes.includes(kind)) return { title, why: "typ" };
      const yearKey = kind === "tv" ? "first_air_date_year" : "year";
      const res = (await tmdb(`/search/${kind}`, { query: title, [yearKey]: year })).results ?? [];
      const r = res.find((x) => Math.abs(Number((x.release_date ?? x.first_air_date ?? "").slice(0, 4)) - year) <= 1);
      if (!r) return { title, missing: true };
      const d = await tmdb(`/${kind}/${r.id}`, {
        append_to_response: kind === "movie" ? "watch/providers,release_dates" : "watch/providers,content_ratings",
      });
      const p = d["watch/providers"]?.results?.SE ?? {};
      const on = [...(p.flatrate ?? []), ...(p.free ?? []), ...(p.ads ?? [])].some((x) => PROVIDERS.includes(x.provider_id));
      if (!on) return { title, why: "tjänst" };
      const f = filters[kind];
      const runtime = kind === "movie" ? d.runtime : d.episode_run_time?.[0];
      if (f["with_runtime.lte"] && runtime && runtime > f["with_runtime.lte"]) return { title, why: "längd" };
      const yr = Number((d.release_date ?? d.first_air_date ?? "").slice(0, 4));
      const date = kind === "movie" ? "primary_release_date" : "first_air_date";
      if (f[`${date}.gte`] && yr < Number(f[`${date}.gte`].slice(0, 4))) return { title, why: "år" };
      if (f[`${date}.lte`] && yr > Number(f[`${date}.lte`].slice(0, 4))) return { title, why: "år" };
      if (parsed.min_vote && d.vote_average < parsed.min_vote) return { title, why: "betyg" };
      const genreIds = d.genres.map((g) => g.id);
      const required = forType(parsed.required_genres ?? [], kind);
      if (required.some((g) => !genreIds.includes(g))) return { title, why: "genre" };
      if (maxCert !== null) {
        const raw =
          kind === "movie"
            ? d.release_dates?.results?.find((x) => x.iso_3166_1 === "SE")?.release_dates?.[0]?.certification
            : d.content_ratings?.results?.find((x) => x.iso_3166_1 === "SE")?.rating;
        const cert = raw ? (/btl/i.test(raw) ? 0 : Number(raw.match(/\d+/)?.[0])) : null;
        if (cert !== null && cert > maxCert) return { title, why: "ålder" };
      }
      return { id: r.id, type: kind, title: d.title ?? d.name, orig: d.original_title ?? d.original_name, year: String(yr), vote: d.vote_average, votes: d.vote_count, genres: genreIds, style: true };
    }),
  );
  const why = {};
  for (const x of found) if (x.why) why[x.why] = (why[x.why] ?? 0) + 1;
  return {
    named: list.length,
    notInTmdb: found.filter((f) => f.missing).map((f) => f.title),
    onServices: found.filter((f) => f.id),
    left: why,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const fmt = (c) =>
  `${c.style ? "◆ " : ""}${c.title} (${c.year}, ${c.type === "movie" ? "film" : "serie"}, ★ ${c.vote?.toFixed(1) ?? "–"}, ${c.votes} röster; ${c.genres.slice(0, 2).map((g) => G.names[g] ?? g).join(", ")})`;
const short = (f) =>
  JSON.stringify({ types: f.mediaTypes, sort: f.sortBy, ...(f.mediaTypes.includes("movie") ? { movie: f.movie } : {}), ...(f.mediaTypes.includes("tv") ? { tv: f.tv } : {}) });

const lines = [`# Fritext till lek: dagens prompt 1 mot utkast v3`, ``, `Tjänster: Netflix, Disney+, SVT Play, TV4 Play, HBO Max. Grupp: Själv. ${SHOW} första korten, utan användarens historik och utan Claudes toppval. ◆ = titel som Claude nämnt i stilen (v3).`, ``];

const totals = [];
for (const [i, phrase] of run) {
  const mood = phrase.text;
  process.stderr.write(`${i}: ${mood}\n`);
  const [v1, v2, styleCall] = await Promise.all([
    askJson(fill(PARSE_PROMPT, base(mood)), V1_SCHEMA),
    askJson(fill(V2_PROMPT, base(mood)), V2_SCHEMA),
    askJson(fill(STYLE_PROMPT, base(mood)), STYLE_SCHEMA, STYLE_MODEL),
  ]);

  const today = await deck(applyV1(v1.json));

  let level = 0;
  let next = await applyV2(v2.json, 0);
  let d2 = await deck(next.filters);
  while (d2.cards.length < SHOW && level < 2) {
    level++;
    next = await applyV2(v2.json, level);
    d2 = await deck(next.filters);
  }
  const style = await styleTitles(styleCall.json.titles, next.filters, v2.json);
  // With enough titles in the style, they all go first and the fetch fills
  // in after them; with few, they take turns with the fetch.
  const lead = style.onServices.length >= 5;
  const seen = new Set();
  const mixed = [];
  const add = (c) => {
    if (c && !seen.has(`${c.type}:${c.id}`)) {
      seen.add(`${c.type}:${c.id}`);
      mixed.push(c);
    }
  };
  if (lead) [...style.onServices, ...d2.cards].forEach(add);
  else
    for (let k = 0; k < Math.max(style.onServices.length, d2.cards.length); k++) {
      add(style.onServices[k]);
      add(d2.cards[k]);
    }


  const v2rest = v2.json;
  const s1 = score(today.cards.slice(0, SHOW), phrase);
  const s3 = score(mixed.slice(0, SHOW), phrase);
  totals.push({ i, mood, s1, s3 });
  lines.push(
    `## ${i + 1}. ”${mood}”`,
    ``,
    `_${phrase.note}_ Rätt enligt dig: i dag ${s1.good}, v3 ${s3.good}. Fel enligt dig: i dag ${s1.bad}, v3 ${s3.bad}.`,
    ``,
    `**I dag** (${v1.ms} ms): ${short(applyV1(v1.json))}. ${today.total} träffar.`,
    ``,
    ...today.cards.slice(0, SHOW).map((c, n) => `${n + 1}. ${fmt(c)}`),
    ...(today.cards.length ? [] : ["_Inga kort._"]),
    ``,
    `**v3** (prompt 1 ${v2.ms} ms, titlar i stilen ${styleCall.ms} ms med ${STYLE_MODEL}${level ? `, lättad i ${level} steg` : ""}): ${short(next.filters)}. ${d2.total} träffar. Tolkning: \`${JSON.stringify(v2rest)}\`. Uppslag: ${JSON.stringify(next.resolved)}.`,
    `Titlar i stilen: ${style.named} nämnda, ${style.onServices.length} kvar (bortfall: ${JSON.stringify(style.left)})${style.notInTmdb.length ? `, ej i TMDB: ${style.notInTmdb.join(", ")}` : ""}.`,
    ``,
    ...mixed.slice(0, SHOW).map((c, n) => `${n + 1}. ${fmt(c)}`),
    ...(mixed.length ? [] : ["_Inga kort._"]),
    ``,
  );
}

// A summary first: the titles the user named as right and wrong, per phrase.
const sum = (k, f) => totals.reduce((n, t) => n + t[k][f], 0);
lines.splice(
  4,
  0,
  `| # | Fras | Rätt i dag | Rätt v3 | Fel i dag | Fel v3 |`,
  `|---|---|---|---|---|---|`,
  ...totals.map((t) => `| ${t.i + 1} | ${t.mood} | ${t.s1.good} | ${t.s3.good} | ${t.s1.bad} | ${t.s3.bad} |`),
  `| | **Summa** | **${sum("s1", "good")}** | **${sum("s3", "good")}** | **${sum("s1", "bad")}** | **${sum("s3", "bad")}** |`,
  ``,
);
console.error(lines.slice(4, 4 + totals.length + 3).join("\n"));

mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
const tag = STYLE_MODEL.includes("sonnet") ? "-sonnet" : "";
const file = new URL(`./out/eval-${new Date().toISOString().replace(/[:.]/g, "-")}${tag}.md`, import.meta.url);
writeFileSync(file, lines.join("\n"));
console.log(file.pathname);
