# Prompts

Kopia av sektionen Prompter i projektdokumentet (se `CLAUDE.md`). Ändra promptarna där och synka hit.

Variabler inom `{{ }}` fylls i på servern. Båda promptarna kräver strikt JSON. Validera med zod.

## Prompt 1: humör till filter

Modell: `claude-haiku-5-5`. Input: grupp, snabbval och fritext från startvyn.

```
Du översätter användarens humör till sökfilter för TMDB.
Svara ENDAST med giltig JSON, ingen annan text.

Genrer (id: namn):
{{GENRES}}

Grupp: {{GROUP}}  (kind och, för familj, youngest_age)
Snabbval: {{QUICK_PICKS}}
Fritext: {{MOOD_TEXT}}

Regler:
- Använd bara genre-id:n från listan ovan.
- Sätt fält till null om inget antyder dem.
- "trött", "något tryggt", "hjärndöd" → comfort: true
- "något nytt", "överraska mig" → novelty: "high"
- Tolka tid generöst: "en film före läggdags" ≈ max 110 min.
- Grupp "family" → without_genres ska innehålla skräck och thriller.
- vibe: 3–8 ord som fångar stämningen, används i nästa steg.

{
  "media_type": "movie" | "tv" | "any",
  "with_genres": [id], "without_genres": [id],
  "max_runtime": number | null,
  "min_vote": number | null,
  "era": { "from": number | null, "to": number | null },
  "comfort": boolean,
  "novelty": "low" | "medium" | "high",
  "vibe": string
}
```

Om varken snabbval eller fritext finns (”Bara swipea”) hoppar du över prompt 1 och använder standardfilter.

## Prompt 2: välj tre

Modell: `claude-sonnet-5-5`. Kandidaterna (cirka 20) kommer från TMDB discover, är filtrerade på användarens tjänster och har redan rensats enligt domänreglerna i `CLAUDE.md`.

```
Du väljer exakt 3 titlar åt användaren ur kandidatlistan.
Svara ENDAST med giltig JSON.

Smakprofil:
{{PROFILE}}
Grupp: {{GROUP}}
Gruppens historik: {{GROUP_HISTORY}}
Humör: {{MOOD_TEXT}}
Tolkning: {{FILTERS}}

Kandidater (endast dessa får väljas):
{{CANDIDATES}}

Varje kandidat har: id, titel, år, längd, genrer, TMDB-betyg,
beskrivning, samt my_rating, times_seen, last_seen, status,
watchlist (lista av {group, interest}).

Regler:
1. Välj bara id:n ur kandidatlistan. Hitta aldrig på titlar.
2. Sedda titlar bara om comfort = true. Föredra då my_rating 3
   och times_seen "many", men inte sedda senaste 6 månaderna.
3. Watchlist för aktuell grupp väger tyngst: "rewatch" och
   "want" först, "maybe" därefter.
4. Grupp "family": titeln ska vara lämplig för youngest_age och
   helst fungera för de vuxna också. Gruppens historik väger
   tyngre än den personliga profilen.
5. Variera: ett säkert kort, ett från listan eller nära
   favoriterna, ett oväntat (hoppa över om novelty = "low").
6. Motivering: svenska, max 15 ord, konkret, och den ska handla
   om användaren, inte bara om filmen.
   - Finns en relevant titel i profilen: grunda i den
     ("Samma torra humor som Fargo, som du älskar").
   - Annars: grunda i humör, tid eller grupp
     ("Lätt som du bad om – och bara 1 tim 43 min").
   - Annars: beskriv filmens känsla.
   - Kan gärna kombineras ("Lätt som du ville, med samma humor
     som Grand Budapest Hotel").
   Nämn bara titlar som finns i profilen eller kandidaterna.

{ "picks": [
  { "id": number,
    "slot": "safe" | "watchlist" | "wildcard" | "rewatch",
    "reason": string } ] }
```

Kortleken i Hitta börjar med de tre valda titlarna och fortsätter med resten av kandidaterna sorterade efter genreprofilen. När kortleken tar slut körs prompt 2 igen på nästa sida med kandidater.
