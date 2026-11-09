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
- with_genres: någon av genrerna. required_genres: genrer som titeln måste ha
  ("dokumentär", "barnfilm", "familj" när det är själva kravet).
- Sätt bara det som fritexten eller snabbvalen faktiskt säger. Allt annat null
  eller tom lista.
- media_type: står "film" eller "filmer" i fritexten → "movie"; "serie" eller
  "serier" → "tv". Bara när inget av dem står där → "any".
- "spännande" → thriller, kriminal och mysterium; "lätt", "rolig" → komedi.
- "trött", "något tryggt", "hjärndöd" → comfort: true
- "något nytt", "överraska mig", "inte sett" → novelty: "high"
  och comfort: false
- Tolka tid generöst: "en film före läggdags" ≈ max 110 min.
- "höga betyg", "bra betyg" → min_vote 7.5; "betyg över 8" → 8.
- Ord om tid blir era: "80-tal" → 1980–1989, "nostalgisk" → till cirka 2005,
  "modern tid", "nyare" → från cirka 2010, "gamla klassiker" → till cirka 1990.
- Land eller region → origin_countries med ISO 3166-1-koder
  ("skandinaviskt" → ["SE", "DK", "NO"], "koreansk" → ["KR"]).
  languages med ISO 639-1-koder bara när språket självt efterfrågas
  ("på svenska" → ["sv"]).
- Personer som nämns (skådespelare, regissörer) → people med fullständigt namn.
- Bolag eller nätverk som nämns ("A24", "HBO") → companies med namnet.
  Gissa inga bolag.
- Ämnen som inte är genrer ("tidsresor", "heist", "zombies") → keywords på
  engelska, som TMDB:s nyckelord. Det man vill slippa → without_keywords.
- Ordning: "klassiker", "största", "mest kända" → sort "votes"; "högst betyg",
  "bästa" → "rating"; "nytt", "senaste" → "newest". Annars "popularity".
- Serier: "avslutad" → tv_ended: true; "miniserie" → tv_miniseries: true.
- Grupp "family" → without_genres ska innehålla skräck och thriller.
- vibe: 3–8 ord som fångar stämningen, används i nästa steg.

{
  "media_type": "movie" | "tv" | "any",
  "with_genres": [id], "required_genres": [id], "without_genres": [id],
  "origin_countries": [string], "languages": [string],
  "people": [string], "companies": [string],
  "keywords": [string], "without_keywords": [string],
  "max_runtime": number | null,
  "min_vote": number | null,
  "era": { "from": number | null, "to": number | null },
  "sort": "popularity" | "votes" | "rating" | "newest",
  "tv_ended": boolean, "tv_miniseries": boolean,
  "comfort": boolean,
  "novelty": "low" | "medium" | "high",
  "vibe": string
}
```

Om varken snabbval eller fritext finns hoppar du över prompt 1 och använder standardfilter.

Namn på personer, bolag och nyckelord slås upp i TMDB på servern (bolag med samma namn: det med flest filmer). Sorteras det på betyg krävs minst 1 000 röster för film och 300 för serier. Ger filtren för få titlar lättas de i två steg: först lägre betygskrav och inga personer, bolag eller nyckelord, sedan inga genrer. Språk och land behålls.

## Titlar i stilen

Modell: `claude-sonnet-5-5`. Körs bara när fritext finns, parallellt med prompt 1. Titlarna slås upp i TMDB på namn och år och får samma hårda gränser som leken: användarens tjänster, film eller serie, längd, år, lägsta betyg, krävda genrer och Familjs åldersgräns. Finns minst fem kvar går de först i leken, annars varvas de med hämtningen. Korten loggas med källan `mood`.

```
Användaren letar efter något att titta på och skrev:
"{{MOOD_TEXT}}"
Snabbval: {{QUICK_PICKS}}
Grupp: {{GROUP}}  (kind och, för familj, youngest_age)

Nämn 20 verkliga titlar (filmer eller serier, som fritexten säger) som passar
det användaren menar: stilen, tonen, nivån och tiden, inte bara genren. Ber hen
om något smalare, smartare eller mindre känt, välj så. Ber hen om de största
eller mest kända, välj så. Grupp "family": bara sådant som passar barnet och
helst de vuxna också. Bara titlar du är säker på finns, med rätt år.
Om fritexten bara gäller sådant som filter klarar (längd, betyg, land, en
person, ett bolag) och inget om stil eller känsla: svara med tom lista.

Svara ENDAST med JSON:
{ "titles": [{ "title": string, "year": number, "media_type": "movie" | "tv" }] }
```

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
2. Sedda titlar (my_rating eller times_seen satt):
   - aldrig om novelty = "high" eller humöret ber om något nytt
     eller osett
   - annars bara om comfort = true eller watchlist har "rewatch"
     för aktuell grupp
   - högst en sedd titel bland de tre, utom när comfort = true
   - föredra my_rating 3 som inte setts de senaste 6 månaderna
3. Watchlist för aktuell grupp väger tyngst: "want" först,
   "maybe" därefter.
4. Grupp "family": titeln ska vara lämplig för youngest_age och
   helst fungera för de vuxna också. Gruppens historik väger
   tyngre än den personliga profilen.
5. Variera: ett säkert kort, ett från listan eller nära
   favoriterna, ett oväntat (hoppa över om novelty = "low").
6. Motivering: svenska, högst 15 ord, konkret, och den ska handla
   om användaren, inte bara om filmen.
   - Finns en relevant titel i profilen: grunda i den
     ("Samma torra humor som Fargo, som du älskar").
   - Annars: grunda i humör, tid eller grupp
     ("Lätt som du bad om – och bara 1 tim 43 min").
   - Annars: beskriv filmens känsla.
   - Kan gärna kombineras ("Lätt som du ville, med samma humor
     som Grand Budapest Hotel").
   - Skiljer sig tonen från favoriterna, säg det
     ("Lättsammare än Mindhunter, men samma jakt på en mördare").
   Nämn bara titlar som finns i profilen eller kandidaterna.
7. Skriv som appen: "du har sparat den" om titeln finns på
   aktuell grupps lista, "du ville se den igen" om den har
   "rewatch". Nämn inte andra gruppers listor. Skriv aldrig
   orden rewatch, watchlist, slot, kandidat eller id.

{ "picks": [
  { "id": number,
    "slot": "safe" | "watchlist" | "wildcard" | "rewatch",
    "reason": string } ] }
```

Kortleken i Hitta börjar med de tre valda titlarna och fortsätter med resten av kandidaterna sorterade efter genreprofilen. När kortleken tar slut körs prompt 2 igen på nästa sida med kandidater.
