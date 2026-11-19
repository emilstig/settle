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

Grupp: {{GROUP}}  (namn och filter, till exempel max_age)
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
- Gruppens filter läggs på servern. Sätt inget som strider mot dem.
- vibe: 3–8 ord som fångar stämningen, används i nästa steg.
- label: 2–5 ord som rubrik i leken, på svenska i sentence case, till
  användaren. Inga ord om användaren eller gruppen.

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
  "vibe": string,
  "label": string
}
```

Om varken snabbval eller fritext finns hoppar du över prompt 1 och använder standardfilter.

Namn på personer, bolag och nyckelord slås upp i TMDB på servern (bolag med samma namn: det med flest filmer). Sorteras det på betyg krävs minst 1 000 röster för film och 300 för serier. Ger filtren för få titlar lättas först det användaren inte bad om: lägre betygskrav (vid sortering på betyg 300 röster för film och 100 för serier) och inga nyckelord (nyckelord som är det enda humöret nämnde ligger kvar). Med fritext breddas det sedan bara när användaren väljer ”Visa bredare förslag”: först inga genrer, sist inga personer eller bolag. Med bara snabbval sker alla steg av sig själva. Språk och land behålls, och det de striktare filtren hittade visas först.

## Titlar i stilen

Modell: `claude-sonnet-5-5`. Körs bara när fritext finns, parallellt med prompt 1. Titlarna slås upp i TMDB på namn och år och får samma hårda gränser som leken: användarens tjänster, film eller serie, längd, år, lägsta betyg, krävda genrer och Familjs åldersgräns. Finns minst fem kvar går de först i leken, annars varvas de med hämtningen. Korten loggas med källan `mood`.

```
Användaren letar efter något att titta på och skrev:
"{{MOOD_TEXT}}"
Snabbval: {{QUICK_PICKS}}
Grupp: {{GROUP}}  (namn och filter, till exempel max_age)

Nämn 20 verkliga titlar (filmer eller serier, som fritexten säger) som passar
det användaren menar: stilen, tonen, nivån och tiden, inte bara genren. Ber hen
om något smalare, smartare eller mindre känt, välj så. Ber hen om de största
eller mest kända, välj så. Har gruppen max_age: bara sådant som passar den åldern och
helst de vuxna också. Bara titlar du är säker på finns, med rätt år.
Om fritexten bara gäller sådant som filter klarar (längd, betyg, land, en
person, ett bolag) och inget om stil eller känsla: svara med tom lista.

Svara ENDAST med JSON:
{ "titles": [{ "title": string, "year": number, "media_type": "movie" | "tv" }] }
```

## Smakspåret: profil till sökningar

Modell: `claude-haiku-5-5`, utan tänkande. Körs utom i Familj och först när användaren har minst 10 betyg, parallellt med att resten av leken hämtas. Med humör skrivs sökningarna för kvällen och smaken tillsammans: `{{MOOD}}` är användarens ord och prompt 1:s tolkning (film eller serie, genrer, längd), och varje titel måste klara humörets filter; ett humör som själv nämner nyckelord, person eller bolag hoppar över spåret. Sökningarna blir frågor till TMDB sorterade på betyg (film minst 6,5 och 200 röster, serier minst 7 och 100 röster) inom gruppens gränser; namn slås upp i TMDB, en sökning med personer bärs av dem ensamma, och genrer som profilen tydligt säger nej till utesluts. Titlarna varvas med resten av leken, högst 12 per sida, med källan `taste`. Sökningarna sparas på sessionen (`filters.lane`) så att senare sidor inte frågar igen. Pröva ändringar med `node --env-file=.env.local scripts/eval/eval-taste.mjs <profil.txt> --mood="…"`.

```
Du översätter en användares smakprofil till sökningar i TMDB.
Svara ENDAST med giltig JSON, ingen annan text.

Genrer (id: namn):
{{GENRES}}

Smakprofil:
{{PROFILE}}
Grupp: {{GROUP}}

Ge exakt 4 sökningar. Var och en fångar en sida av smaken som en genre
ensam inte gör: ett tema, en ton, en era, ett land eller en regissör.

Regler:
- Utgå från det användaren älskar och gillar mycket. Leta efter det som
  förenar flera av titlarna, inte efter en enskild titel.
- Undvik det som liknar det ogillade och genrerna som undviks.
- Använd bara genre-id:n från listan ovan. genres: någon av dem räcker,
  högst 3. Tom lista om sökningen bärs av annat.
- keywords: TMDB:s nyckelord på engelska i sin vanligaste form
  ("based on true story", "heist", "cold war", "small town"). Högst 4,
  någon av dem räcker.
- people: regissörer vars filmer ligger nära profilen. Bara i sökningar
  med media_type "movie", högst 3, och högst en sökning med people.
  En sökning med people har inga keywords och inga genres.
- era, origin_countries (ISO-kod, "SE") och languages (ISO-kod, "sv")
  bara när profilen tydligt pekar dit. Annars null och tomma listor.
- Varje sökning ska vara bred nog att ge ett tjugotal titlar: snäva
  inte in med både keywords och era eller land samtidigt.
- Sökningarna ska skilja sig från varandra. Minst en "movie" och minst
  en "tv", om inte humöret säger film eller serie.
- label: 2–4 ord på svenska som säger vad sökningen fångar.

Ikväll: {{MOOD}}
- Står det "Inget" ovan: utgå bara från smaken.
- Annars bestämmer kvällen vad som söks, och smaken bara vilken sorts
  titlar inom det. Varje sökning ska vara något användaren skulle säga ja
  till just ikväll. En sökning som passar smaken men inte kvällen är fel:
  den som vill ha något lätt ska inte få verkliga brott, hur mycket hen
  än älskar dem.
- Står det en tolkning med genrer: välj genres i varje sökning bland dem.
  Står det film eller serie: alla sökningar har den media_type.
- Leta efter det i smaken som möter kvällen. Lätt för den som älskar
  Parks and Recreation är torr arbetsplatskomedi; spännande för den som
  älskar verklighetsbaserat är verkliga brott.

{ "searches": [
  { "label": string,
    "media_type": "movie" | "tv",
    "genres": number[],
    "keywords": string[],
    "people": string[],
    "origin_countries": string[],
    "languages": string[],
    "era": { "from": number | null, "to": number | null } } ] }
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
4. Har gruppen max_age: titeln ska vara lämplig för den åldern och
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
