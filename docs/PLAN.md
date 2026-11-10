# Byggplan för MVP:n

Ett steg i taget. Varje steg är klart när kriteriet ”Klart när” är uppfyllt på telefonen. Commit per delsteg.

Status förs också under Byggplan och status i projektdokumentet (se `CLAUDE.md`). Bocka av på båda ställena.

## 1. Grund
- [x] Next.js med TypeScript, Supabase-klient (server och klient)
- [x] Inloggning med magic link och en skyddad layout
- [x] PWA-manifest, ikon och temafärg
- [x] Migreringar för alla tabeller i `CLAUDE.md`, med RLS
- [x] Skapa de fyra standardgrupperna vid registrering, och fråga efter yngsta barnets ålder för Familj (flyttat till första Familj-valet i steg 4)
- [x] Deploy (Vercel) med miljövariabler

**Klart när:** du kan logga in på telefonen och appen ligger på hemskärmen.

## 2. Data från TMDB
- [x] Onboarding: välj tjänster bland providers för SE, spara i `user_providers`
- [x] Serverfunktion för discover (film och tv) med användarens tjänster
- [x] Cache i `titles` med uppdatering av providers ungefär en gång i veckan
- [x] Källangivelse för TMDB och JustWatch i appen

**Klart när:** du ser en lista med riktiga titlar som finns på dina tjänster.

## 3. Swipen
- [x] Startvy: grupp, snabbval, fritext och en knapp, ”Visa förslag” (humöret är valfritt). Skapar en rad i `sessions`.
- [x] Kortlek med gester och knappar enligt prototypen
- [x] Höger, vänster med orsaks-chips, upp med sett-sheet (betyg, och se igen med vem)
- [x] Detaljvy med handling, betyg, trailer och knappar för beslut
- [x] Skriver till `interactions`, `ratings`, `watch_log` och `watchlist`
- [x] Ångra för senaste swipen
- [x] Efter test: svep nedåt ”Vet inte”, ”Med annan grupp” efter höger, en film per filmserie och genrer som turas om

**Klart när:** du har använt det själv tre kvällar, även om sorteringen är dum.

## 4. Kalibrering och profil
- [x] Kalibrering: 20 kända titlar från alla tjänster i Sverige (korten visar inga tjänster), med swipe för betyg. Sist i onboarding och går att hoppa över, med ”Hoppa över” per titel, nås också från en sekundär knapp på startvyn när profilen är tunn (färre än 10 betyg)
- [x] Yngsta barnets ålder frågas första gången Familj väljs, inte i onboarding
- [x] Funktion som bygger smakprofilen enligt domänreglerna (`src/lib/profile.ts`)
- [x] Funktion som genererar texten till `{{PROFILE}}`, visad på sidan Din smakprofil

**Klart när:** profiltexten för ditt konto ser ut att stämma när du läser den.

## 5. Claude
- [x] Prompt 2 enligt `docs/prompts.md`, validerad med zod, med ett nytt försök och reserv på TMDB-betyg
- [x] Kandidater från fler källor: toppen av leken, välrecenserat i dina genrer och nyare titlar
- [x] Prompt 1 enligt `docs/prompts.md`, validerad med zod, med reserv på reglerna och filter som lättas steg för steg när de ger för få titlar
- [x] Justera prompt 2 (i projektdokumentet först):
  - högst ett se igen-val av tre, fler bara vid tryggt humör
  - sedda titlar, även se igen, väljs inte när humöret säger att det ska vara något nytt eller osett
  - motiveringen använder appens ord: ”Du har sparat den” för aktuell grupp, nämner inte andra gruppers listor (det gör etiketten), ”se igen” i stället för rewatch, och inga interna ord som slot eller watchlist
  - motiveringen för se igen säger varför den är värd att se om, inte bara att den står på listan
- [x] Rensning av kandidater enligt domänreglerna, innan prompt 2
- [x] Logga varje körning i `suggest_runs`
- [x] Motiveringen visas på kortet och i detaljvyn
- [x] Se igen: gruppens `rewatch`-titlar och, vid tryggt humör, älskade sedda titlar läggs till som kandidater, med etiketten ”Se igen” på kortet
- [x] Toppval ikväll överst i svepvyn: Claudes tre val plus det som svepas höger under sessionen, med ”Välj” på varje titel och ”Välj för ikväll” i toasten
- [ ] Tillfällig växel: Claude-sortering mot ren TMDB-sortering, för jämförelse

**Klart när:** Claude-förslagen känns tydligt bättre än TMDB-sorteringen under en vecka.

## 6. Att se och check-in
- [x] Fliken Att se: gruppen överst (delad med Hitta), hyllor (Vill gärna, Att se om, Vill se, Inte på dina tjänster) och Visa alla med chips och sortering; detaljvyn med Välj den här, Ta bort och Vill gärna. Fortsätt titta kommer med Efter tittning
- [x] Fliken Profil som meny med Din smak (genrerutor, Fortsätt kalibrera), Historik (hyllor med det man sett, ogillat och sagt Inte min grej om, där betyg, se igen, Inte sett och Inte min grej går att ändra i efterhand) och Tjänster
- [x] ”Välj den här” i detaljvyn sätter `picked_tmdb_id` på sessionen (byggt med Toppval ikväll i steg 5)
- [ ] Efter tittning: klockan frågar om gårdagens val (betyg, eller status för serier)

**Klart när:** check-in fyller på betyg utan att du tänker på det.

## 7. Testare
- [ ] Bjud in 3–5 personer
- [ ] Enkel vy eller SQL för mätvärden: andel sessioner med ett val, tid till val, återkommande användare per vecka
- [ ] Kort intervju efter två veckor

**Klart när:** du kan svara på MVP-hypotesen med siffror och intervjuerna.

## Inte i MVP

Byggs inte utan ett beslut som först förts in i Beslutsloggen i projektdokumentet.

Gruppmedlemmar och kopplade konton, inbjudningar, egna grupper och namnbyte, parläge och matchning, push-notiser, Liknande (`/recommendations`), stegen ”Hur många gånger?” och ”När senast?” i sett-sheet, rader i Att se som Claude sätter ihop, inställningar per grupp (till exempel inga barnfilmer med Själv eller Vänner), native app.
