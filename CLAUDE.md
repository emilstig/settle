# Settle

## Gemensam spec

Produktbeslut finns i Claude-dokumentet "Settle – projektdokument":
https://claude.ai/artifact/43p5krNWS45a34e51DJs99

- Läs dokumentet innan du börjar på ett nytt steg i planen.
- Dokumentet är sanningen. Där repot skiljer sig, uppdatera repot.
- När ett delsteg är klart: ändra status i tabellen Byggplan och
  status i dokumentet.
- När något ändras under bygget: lägg till en rad i Beslutsloggen
  (nyast först) och uppdatera rätt sektion i dokumentet.
- Promptarna ändras bara i dokumentet. docs/prompts.md är en kopia.
- Skapa inga egna dokumentationssidor.
- Läs inte hela Beslutsloggen, den är lång och växer. Läs dokumentets disposition och sök sedan i stället: en ny rad läggs efter rubrikraden, vars id fås genom att söka på ”I repot”, och rader som inte förts in i repot hittas genom att söka på ”Nej”. Synka per delsteg, inte per commit.

## Produkten

Namnet är Settle, med butiksnamnet *Settle: What to Watch*.

En app som hjälper användaren att snabbt hitta något att titta på bland de streamingtjänster hen faktiskt har. Användaren anger vem som tittar och vilket humör hen är i, swipear bland förslag och appen lär sig smaken över tid.

**MVP-hypotes:** Settle gör att användaren hittar något att titta på snabbare än genom att scrolla i tjänsternas egna appar. Bygg inget som inte hjälper till att testa det.

Det som skiljer Settle från konkurrenterna är profil och historik per grupp, check-in efter tittning och fokus på svensk katalog och svenska åldersgränser.

## Referenser

- **Projektdokumentet**: se Gemensam spec ovan. Läs det med Claude Docs-verktygen. Rader i Beslutsloggen med ”Nej” under ”I repot” förs in i repot och markeras sedan ”Ja”.
- `docs/PLAN.md`: byggordningen. Jobba ett steg i taget och bocka av.
- `docs/prompts.md`: kopia av sektionen Prompter i projektdokumentet. Ändra promptarna i dokumentet och synka hit.
- `docs/prototype.html`: klickbar UX-prototyp och spec för flöden, gester och copy, samma som den publicerade versionen på https://claude.ai/artifact/5tGfN3hKPqmzkH2d6yKkQi. Den har påhittad data. Följ flödet, inte koden.

## Stack

- Next.js (App Router, TypeScript, server components där det går). Yarn och Node 24.
- Supabase: Postgres, Auth med magic link, Row Level Security på alla användartabeller. De nya nycklarna används: publishable (`sb_publishable_…`) och secret (`sb_secret_…`), den senare bara på servern.
- PWA: manifest och ikon så att appen kan läggas på hemskärmen. Ingen push i MVP.
- Mobil först. Desktop behöver bara fungera.

## Externa API:er

Alla nycklar används bara på servern (route handlers eller server actions), aldrig i klienten.

**TMDB (v3, bearer token)**
- Tjänster i Sverige: `GET /watch/providers/movie?watch_region=SE` (och `/tv`)
- Kandidater: `GET /discover/movie` och `/discover/tv` med `watch_region=SE`, `with_watch_providers=8|1899|...` (pipe betyder ELLER), `with_watch_monetization_types=flatrate`, `language=sv-SE`
- Detaljer: `GET /movie/{id}?append_to_response=watch/providers,videos` (och `/tv/{id}`)
- Streamingdatan kommer från JustWatch. **JustWatch och TMDB ska anges som källor i appen**, annars kan API-åtkomsten dras in.
- Cacha i `titles` i högst 6 månader. Uppdatera `providers_se` oftare (cirka en gång i veckan), eftersom katalogerna byts.

**Anthropic**
- Prompt 1 (humör till filter): `claude-haiku-5-5`, utan tänkande. Körs bara när fritext eller snabbval finns. Tolkningen läggs ovanpå gruppens regler (Familjs åldersgräns ligger kvar), och ger filtren färre än 10 titlar lättas de i två steg: lägre betygskrav, sedan inga genrer. Språket behålls.
- Prompt 2 (välj tre): `claude-sonnet-5-5`
- Begär strikt JSON och validera svaret med zod. Vid ogiltigt svar: försök en gång till, annars fall tillbaka på kandidaterna sorterade efter TMDB-betyg.

## Miljövariabler

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
TMDB_TOKEN=
ANTHROPIC_API_KEY=
```

## Datamodell

Alla användartabeller har `user_id` (uuid, refererar `auth.users`) och RLS där användaren bara ser sina egna rader. `media_type` är `movie` eller `tv`.

- `user_providers`: user_id, provider_id (TMDB:s id), region (`SE`)
- `titles` (cache, delad): tmdb_id, media_type, title, original_title, year, runtime, genre_ids, overview, poster_path, vote_average, certification_se, providers_se (jsonb), collection_id (TMDB-samling för filmserier), updated_at
- `groups`: id, user_id (ägare), name, kind (`solo`/`partner`/`family`/`friends`/`custom`), youngest_age (int, bara för familj), sort, created_at. Fyra grupper skapas automatiskt per användare: Själv, Partner, Familj och Vänner.
- `ratings`: user_id, tmdb_id, media_type, rating (−1 ogillade, 1 gillar, 2 gillar mycket, 3 älskar), group_id, updated_at
- `watch_log`: user_id, tmdb_id, media_type, times_seen (`once`/`few`/`many`), last_seen (date, null tillåtet), last_seen_approx (`recent`/`this_year`/`long_ago`, null tillåtet), status (`watching`/`finished`/`dropped`, för serier)
- `watchlist`: user_id, tmdb_id, media_type, group_id, interest (`maybe`/`want`/`rewatch`), added_at. En rad per grupp.
- `interactions`: user_id, tmdb_id, media_type, action (`right`/`left`/`seen`/`open_detail`/`undo`/`not_seen`/`unsure`, där `not_seen` är ”Inte sett” i kalibreringen och `unsure` är ”Vet inte” i Hitta), reason (`not_now`/`not_for_me`/`seen`, null tillåtet), session_id, created_at
- `sessions`: id, user_id, group_id, mood_text, quick_picks (text[]), filters (jsonb), started_at, picked_tmdb_id, picked_at
- `suggest_runs`: id, session_id, prompt (`parse`/`pick`), input (jsonb), output (jsonb), model, latency_ms, created_at

**Grupper i stället för fasta kategorier.** Allt som beror på sällskap pekar på `group_id`. I MVP:n visar UI:t bara de fyra förvalda grupperna. Medlemmar (kopplade konton och profiler utan konto), inbjudningar och egna grupper kommer senare, men datamodellen ska klara dem utan migrering av befintliga rader. Appen ska vara fullt användbar även om bara en person i gruppen använder den.

## Domänregler

- **Fakta om användaren gäller överallt, beslut om sällskapet gäller i gruppen.** Ingen titel som användaren har ogillat, avbrutit eller sett föreslås igen i någon grupp. ”Inte nu” och ”Vet inte” döljer en titel överallt i 7 dagar. ”Inte min grej” (”Inte vår grej” i andra grupper än Själv) döljer titeln bara i gruppen där det sades och räknas som ett milt ogillande: i Själv i genreprofilen, i andra grupper i den gruppens historik. Vill se och Se igen gäller i sina grupper.
- **Sedda titlar** kommer tillbaka på två sätt. Det användaren själv sagt ”Se igen med” om (watchlist `rewatch` för gruppen) kan föreslås vilken kväll som helst med den gruppen och få en plats i Toppval ikväll. Övriga sedda titlar föreslås bara när humöret är tryggt (`comfort: true`), och då helst sådana som fått betyget älskar och inte betygsatts de senaste 6 månaderna (betygsdatumet ersätter ”När senast?”). Båda läggs till som kandidater uttryckligen, eftersom discover inte hittar dem, tillsammans med gruppens lista (”Vill gärna” före ”Vill se”). Listans titlar roteras per session, och titlar som svarats ”Sett” på den senaste veckan väljs inte till topp 3. Det som har varit bland Claudes topp 3 de senaste 3 dagarna vilar och väljs inte till topp 3 igen (titlarna loggas i `suggest_runs.output.keys`). Kortet får etiketten ”Se igen”.
- **Watchlist är per grupp.** ”Se igen med Familj” ska väga tungt när gruppen är Familj.
- **Familj** betyder att alla tittar tillsammans: filtrera på svensk åldersgräns utifrån `youngest_age` (standard 7 år om den saknas) och inget skrämmande. Förslagen ska också fungera för de vuxna.
- **Gruppens egen historik** (vad som setts och betygsatts med gruppen) väger tyngre än den personliga profilen när gruppen inte är Själv. Gruppen har en egen genreprofil av det senaste årets svep höger (+1), ”Inte vår grej” (−1) och betyg med gruppen, och leken sorteras efter 70 % gruppens profil och 30 % den personliga. En genre som gruppen sagt ”Inte vår grej” om minst 10 gånger och svept höger på högst 5 % av gångerna utesluts i discover för gruppen, om inte humöret ber om den.
- **Smakprofilen** (`{{PROFILE}}` i prompt 2) byggs på servern vid varje förslag och hålls kort, runt 30 rader: topp 10 älskar, de senaste 10 betygen, ogillade och avbrutna från senaste året, och en genreprofil. Profilen bygger på användarens egna betyg (kalibreringen och Själv); betyg med andra grupper är gruppens historik. Genreprofilen viktar älskar 3, gillar mycket 2, gillar 1, ogillar −2, avbröt −1 och ”Inte min grej” i Själv −1 (om titeln inte har betygsatts), med en halveringstid på ett år, och rangordnar genrer efter snitt per titel (med en spärr så att få titlar inte toppar, och minst 4 titlar per genre) i stället för summa. Genrer som TMDB saknar svenskt namn för (till exempel Music) får ett svenskt namn i appen. Seriegenrer räknas som motsvarande filmgenrer, till exempel Sci-Fi & Fantasy som Science Fiction och Fantasy.
- **Motiveringar** handlar om användaren, inte bara om filmen. De grundas i första hand i profilen, i andra hand i humör, tid eller grupp, och beskriver bara filmens känsla om inget av det finns. Se `docs/prompts.md`.

## UX-regler

- Följ flödena i `docs/prototype.html`: startvy, swipe, detaljvy, sett-sheet, Lista, Profil, Efter tittning. Tre flikar (Hitta, Lista, Profil) och en klocka i headern för Efter tittning.
- Startvy: ”Vem tittar ikväll?” med grupperna som rutor i ett 2×2-rutnät (ett val, radiogrupp) med en rad under namnet: åldersgränsen för Familj (tryck igen för att ändra), annars antal sparade titlar, ”Vad är du sugen på?” med fritext och snabbvalen Lätt, Spännande, Kort, Något tryggt och Överraska mig som pills (flera val, bock när valda), sedan en knapp som heter ”Föreslå utifrån min smak” när inget är ifyllt och ”Visa förslag” när fritext eller snabbval finns. Humöret är valfritt: utan fritext och snabbval hoppas prompt 1 över och prompt 2 väljer utifrån smakprofilen. Valet visas som en etikett överst i kortleken och går att trycka på för att ändra.
- Swipe i Hitta: höger betyder vill se (watchlist `maybe` för aktuell grupp). Toasten säger ”Sparad i din lista” för Själv och ”Sparad för Partner” (gruppens namn) annars, med chipsen ”Vill gärna” (ger `want`) och ”Med annan grupp” (välj vilka gruppers listor titeln ska ligga på). Vänster betyder inte nu (sparas som `not_now`; toasten ”Inte nu” visar i 2 sekunder chipset ”Inte min grej”, eller ”Inte vår grej” i andra grupper än Själv). Upp betyder sett och öppnar sett-sheet. Ner betyder vet inte (sparas som `unsure`), samma riktning som ”Inte sett” i kalibreringen. Tryck öppnar detaljvyn och loggas som `open_detail`.
- Leken och kalibreringen visar en film per filmserie åt gången och låter genrerna turas om. Titlar som användaren svarat på i en annan grupp den senaste månaden hamnar sist på sidan, och kortet visar ”Sparad för Själv” om titeln redan ligger på en annan grupps lista. Leken sorteras efter snittet av genreprofilens vikter för titelns genrer, inte summan, så att titlar med många genrer inte vinner på antalet. Ordningen varieras lite per session. Varje sida varvar populärlistan med spåret ”Liknar det ni gillat”: TMDB:s rekommendationer för upp till 24 frötitlar (gruppens svep höger och betyg gillar mycket eller älskar det senaste året, i Själv även det användaren älskar), högst 15 per sida, flest frön först och sedan högst betyg. Samma regler gäller som för populärlistan, och filter spåret inte kan kontrollera (som språk) stänger av det. Kalibreringen blandar de mest röstade titlarna med välrecenserade.
- Kortet visar titel, år, typ, längd, genrer och motiveringen från prompt 2.
- Sett-sheet: bakgrunden dimmas, stegindikator och kryss, krysset sparar det som hunnit besvaras. I MVP: ”Hur var den?” och ”Vill du se den igen? Med vem?” där bara grupper som redan har titeln på se igen-listan är förvalda. ”Klar” sparar exakt de valda grupperna (avvalda tappar se igen), ”Nej, inte igen” tar bort se igen och krysset lämnar se igen orört. Länken heter ”Hoppa över steget”, på sista steget ”Nej, inte igen”.
- Toppval ikväll (steg 5): knappen ”Ikväll · N” i svepvyn öppnar en sheet med det som svepts höger ikväll med gruppen, senast först, med sortering Senast, Betyg och Kortast och ”Välj” på varje. Ett kryss på raden tar bort titeln ur Ikväll men inte ur gruppens lista (toasten har ”Ångra”), och kvällens val finns med även om det valts från detaljvyn. Toppvalen ingår inte förrän de svepts höger. Toasten efter ett svep höger har ”Välj för ikväll”, och detaljvyn har ”Välj den här”. Ikväll hör till kvällen (05–05 svensk tid) och gruppen, inte till sessionen, så det sparade följer med när man börjar om. Det som svepts höger ikväll med gruppen föreslås inte igen, varken i leken eller som Toppval, förrän nästa kväll. Ett val per kväll och grupp sparas på sessionen (`picked_*`); efter valet visas ”Ikväll blir det …” med länk till var den finns, ”Ändra” och ”Till startsidan”. Startvyn visar ett kort med kvällens kandidater eller val för vald grupp. Claudes tre kort i leken har etiketten ”Toppval”. I appen står det ”Toppval”, aldrig ”Claude”.
- Lista (steg 6): rader om användaren, inte genrer: Vill se per grupp, Att se om, Fortsätt titta.
- Detaljvy: helsida med motivering, handling, betyg, fakta och en lista med likvärdiga länkrader (”Finns på Netflix” med tjänstens logga via JustWatch, ”Se trailer” på YouTube, ”Betyg och rollista” på IMDb med id från TMDB:s `external_ids`, ingen IMDb-data eller IMDb-logga), och en fast knapprad för beslut. ”Välj den här” sätter valet på sessionen.
- Kalibrering: höger gillar, upp älskar, vänster ogillade, ner inte sett. ”Hoppa över” under knapparna går vidare utan att spara något, och titeln visas inte igen under samma kalibrering. Sist i onboarding efter tjänsterna, går att avsluta med ”Klar” när som helst så att man snabbt kommer till startvyn. Slutskärmen har ”Fortsätt kalibrera” som hämtar 20 nya titlar. Nås också från Profil och, så länge användaren har färre än 10 betyg, från en sekundär knapp ”Fortsätt kalibrera” under huvudknappen på startvyn.
- Yngsta barnets ålder frågas första gången Familj väljs i startvyn. Utan svar gäller 7 år.
- Efter tittning: klockan med siffra frågar om gårdagens val (betyg, eller status för serier). Push-notis först efter MVP.
- Allt ska också gå att göra med knappar, inte bara gester.
- Förval får bara visa hur det redan är, aldrig skapa en ny önskan. ”Med annan grupp” förväljer gruppen där titeln redan är sparad; sett-sheeten förväljer bara grupper där den redan ligger på se igen-listan.
- Medan förslagen tas fram visar knappen en spinner och fraser som växlar, och knappen laddar tills det finns minst 10 kort att visa (upp till 4 TMDB-sidor), så att leken aldrig öppnas tom. ”Hämtar fler” visar samma spinner. Prompt 2 körs på en ny sida först när användaren har svept minst 15 kort sedan förra körningen.
- Ångra gäller senaste swipen, inklusive det den skrev till databasen.

## Konventioner

- UI-text på svenska, i sentence case, med typografiska citattecken (” ”) och apostrofer (’). Kod, tabeller och variabler på engelska.
- Använd inga påhittade siffror eller tjänster i UI:t. Visa bara det TMDB returnerar.
- Varje steg i `docs/PLAN.md` ska sluta med något som går att använda på telefonen. Committa per delsteg.
- Bygg inte sådant som står under ”Inte i MVP” utan ett beslut som först förts in i Beslutsloggen i projektdokumentet.
