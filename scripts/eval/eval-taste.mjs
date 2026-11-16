// Shows what the taste lane's prompt makes of a taste profile: the searches
// Haiku writes, and what each brings from TMDB.
// Run: node --env-file=.env.local scripts/eval/eval-taste.mjs <profile.txt> [--answered=keys.json] [--providers=8,337]
// The profile is the text of {{PROFILE}} (Profil → Din smak → Visa som text).
// --answered is a JSON list of "movie:123" keys to count as already answered.
// Reads nothing from the database and writes nothing to it.
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const { TASTE_PROMPT } = await import(new URL("../../src/lib/suggest/prompts.ts", import.meta.url));
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) throw new Error("Give a profile text file");
const profile = readFileSync(file, "utf8").trim();
const answered = new Set(arg("answered") ? JSON.parse(readFileSync(arg("answered"), "utf8")) : []);
const PROVIDERS = (arg("providers") ?? "8,337,493,1944,1899").split(",");
const MODEL = arg("model") ?? "claude-haiku-5-5";
/** The lane's floor: known enough to trust the rating, and liked. */
const FLOOR = { movie: { "vote_count.gte": 200, "vote_average.gte": 6.5 }, tv: { "vote_count.gte": 100, "vote_average.gte": 7 } };

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}` } });
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return res.json();
}
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
async function find(kind, name) {
  const { results } = await tmdb(`/search/${kind}`, { query: name });
  const exact = results.filter((r) => same(r.name, name));
  return (kind === "keyword" ? exact : exact.length ? exact : results).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0]?.id ?? null;
}

const [m, t] = await Promise.all([tmdb("/genre/movie/list", { language: "sv-SE" }), tmdb("/genre/tv/list", { language: "sv-SE" })]);
const names = Object.fromEntries([...m.genres, ...t.genres].map((g) => [g.id, g.name]));
const valid = { movie: new Set(m.genres.map((g) => g.id)), tv: new Set(t.genres.map((g) => g.id)) };
const str = { type: "array", items: { type: "string" } };
const schema = {
  type: "object", additionalProperties: false, required: ["searches"],
  properties: { searches: { type: "array", items: {
    type: "object", additionalProperties: false,
    required: ["label", "media_type", "genres", "keywords", "people", "origin_countries", "languages", "era"],
    properties: {
      label: { type: "string" }, media_type: { enum: ["movie", "tv"] },
      genres: { type: "array", items: { type: "number" } }, keywords: str, people: str, origin_countries: str, languages: str,
      era: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: { type: ["number", "null"] }, to: { type: ["number", "null"] } } },
    } } } },
};
const prompt = TASTE_PROMPT.replace(/\{\{(\w+)\}\}/g, (x, k) => ({
  GENRES: Object.entries(names).map(([id, n]) => `${id}: ${n}`).join("\n"), PROFILE: profile, GROUP: '{"kind":"solo"}',
})[k] ?? x);
const started = Date.now();
const res = await new Anthropic().messages.create({
  model: MODEL, max_tokens: 4000, thinking: { type: MODEL.includes("haiku") ? "disabled" : "between_tools" },
  output_config: { effort: "low", format: { type: "json_schema", schema } }, messages: [{ role: "user", content: prompt }],
});
const { searches } = JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
console.log(`${MODEL}, ${Date.now() - started} ms, ${res.usage.input_tokens} in / ${res.usage.output_tokens} ut\n`);

for (const s of searches) {
  const type = s.media_type;
  const kw = (await Promise.all(s.keywords.map((k) => find("keyword", k)))).map((id, i) => [s.keywords[i], id]);
  const ppl = type === "movie" ? (await Promise.all(s.people.map((p) => find("person", p)))).map((id, i) => [s.people[i], id]) : [];
  const date = type === "movie" ? "primary_release_date" : "first_air_date";
  const filters = {
    watch_region: "SE", with_watch_providers: PROVIDERS.join("|"), with_watch_monetization_types: "flatrate|free|ads", language: "sv-SE",
    sort_by: "vote_average.desc", ...FLOOR[type],
    with_genres: s.genres.filter((g) => valid[type].has(g)).join("|"),
    with_keywords: kw.filter(([, id]) => id).map(([, id]) => id).join("|"),
    with_people: ppl.filter(([, id]) => id).map(([, id]) => id).join("|"),
    with_origin_country: s.origin_countries.join("|"), with_original_language: s.languages.join("|"),
    [`${date}.gte`]: s.era.from ? `${s.era.from}-01-01` : "", [`${date}.lte`]: s.era.to ? `${s.era.to}-12-31` : "",
  };
  const pages = await Promise.all([1, 2].map((page) => tmdb(`/discover/${type}`, { ...filters, page })));
  const rows = pages.flatMap((p) => p.results);
  const left = rows.filter((r) => !answered.has(`${type}:${r.id}`));
  const yr = (r) => (r.release_date || r.first_air_date || "").slice(0, 4);
  console.log(`## ${s.label} (${type === "movie" ? "film" : "serie"})`);
  console.log(`genrer: ${s.genres.map((g) => names[g] ?? g).join(", ") || "–"} · nyckelord: ${kw.map(([n, id]) => (id ? n : `${n} (saknas)`)).join(", ") || "–"} · personer: ${ppl.map(([n, id]) => (id ? n : `${n} (saknas)`)).join(", ") || "–"} · land: ${s.origin_countries.join(",") || "–"} · språk: ${s.languages.join(",") || "–"} · era: ${s.era.from ?? ""}–${s.era.to ?? ""}`);
  console.log(`träffar: ${pages[0].total_results}${answered.size ? `, av de första ${rows.length} är ${rows.length - left.length} redan besvarade` : ""}`);
  console.log(left.slice(0, 12).map((r) => `${r.title || r.name} (${yr(r)}, ${r.vote_average.toFixed(1)})`).join(" · ") + "\n");
}
