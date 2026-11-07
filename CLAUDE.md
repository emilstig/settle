# Settle

Arbetsnamn i butikerna: *Settle: What to Watch*. Prototypen heter fortfarande Soffan.

En app som hjälper användaren att snabbt hitta något att titta på bland de streamingtjänster hen faktiskt har. Användaren anger vem som tittar och vilket humör hen är i, swipear bland förslag och appen lär sig smaken över tid.

**MVP-hypotes:** Soffan gör att användaren hittar något att titta på snabbare än genom att scrolla i tjänsternas egna appar. Bygg inget som inte hjälper till att testa det.

## Referenser

- `docs/PLAN.md`: byggordningen. Jobba ett steg i taget och bocka av.
- `docs/prompts.md`: de två Claude-promptarna. Ändra dem bara där, så att det finns en sanning.
- `docs/prototype.html`: klickbar UX-prototyp och spec för flöden, gester och copy. Öppna den i en webbläsare. Den har påhittad data. Följ flödet, inte koden.

## Stack

- Next.js (App Router, TypeScript, server components där det går)
- Supabase: Postgres, Auth med magic link, Row Level Security på alla användartabeller
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
- Prompt 1 (humör till filter): `claude-haiku-5-5`
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
- `titles` (cache, delad): tmdb_id, media_type, title, original_title, year, runtime, genre_ids, overview, poster_path, vote_average, certification_se, providers_se (jsonb), updated_at
- `groups`: id, user_id (ägare), name, kind (`solo`/`partner`/`family`/`friends`/`custom`), youngest_age (int, bara för familj), sort, created_at. Fyra grupper skapas automatiskt per användare: Själv, Partner, Familj och Vänner.
- `ratings`: user_id, tmdb_id, media_type, rating (−1 ogillade, 1 gillar, 2 gillar mycket, 3 älskar), group_id, updated_at
- `watch_log`: user_id, tmdb_id, media_type, times_seen (`once`/`few`/`many`), last_seen (date, null tillåtet), last_seen_approx (`recent`/`this_year`/`long_ago`, null tillåtet), status (`watching`/`finished`/`dropped`, för serier)
- `watchlist`: user_id, tmdb_id, media_type, group_id, interest (`maybe`/`want`/`rewatch`), added_at. En rad per grupp.
- `interactions`: user_id, tmdb_id, media_type, action (`right`/`left`/`seen`/`open_detail`/`undo`), reason (`not_now`/`not_for_me`/`seen`, null tillåtet), session_id, created_at
- `sessions`: id, user_id, group_id, mood_text, quick_picks (text[]), filters (jsonb), started_at, picked_tmdb_id, picked_at
- `suggest_runs`: id, session_id, prompt (`parse`/`pick`), input (jsonb), output (jsonb), model, latency_ms, created_at

**Grupper i stället för fasta kategorier.** Allt som beror på sällskap pekar på `group_id`. I MVP:n visar UI:t bara de fyra förvalda grupperna. Medlemmar (kopplade konton och profiler utan konto), inbjudningar och egna grupper kommer senare, men datamodellen ska klara dem utan migrering av befintliga rader.

## Domänregler

- **Ingen titel som användaren har ogillat eller avbrutit föreslås igen.** ”Inte nu” döljer en titel i 7 dagar. ”Inte min grej” räknas som ett mildt ogillande.
- **Sedda titlar** föreslås bara när humöret är tryggt (`comfort: true`), och då helst sådana som fått betyget älskar och setts många gånger men inte de senaste 6 månaderna.
- **Watchlist är per grupp.** ”Se igen med Familj” ska väga tungt när gruppen är Familj.
- **Familj** betyder att alla tittar tillsammans: filtrera på svensk åldersgräns utifrån `youngest_age` (standard 7 år om den saknas) och inget skrämmande. Förslagen ska också fungera för de vuxna.
- **Gruppens egen historik** (vad som setts och betygsatts med gruppen) väger tyngre än den personliga profilen när gruppen inte är Själv.
- **Smakprofilen** (`{{PROFILE}}` i prompt 2) byggs på servern vid varje förslag och hålls kort, runt 30 rader: topp 10 älskar, de senaste 10 betygen, ogillade och avbrutna från senaste året, och en genreprofil. Genreprofilen viktar älskar 3, gillar mycket 2, gillar 1, ogillar −2 och avbröt −1, med en halveringstid på ett år.
- **Motiveringar** grundas i första hand i profilen, i andra hand i humör, tid eller sällskap, och beskriver bara filmen om inget av det finns. Se `docs/prompts.md`.

## UX-regler

- Följ flödena i `docs/prototype.html`: startvy, swipe, detaljvy, sett-sheet, Lista, Profil, Efter tittning.
- Swipe i Hitta: höger betyder vill se (`maybe`), vänster betyder nej (orsaks-chips i 2 sekunder, standard ”inte nu”), upp betyder sett. Tryck öppnar detaljvyn.
- Allt ska också gå att göra med knappar, inte bara gester.
- Ångra gäller senaste swipen, inklusive det den skrev till databasen.

## Konventioner

- UI-text på svenska, i sentence case, med typografiska citattecken (” ”) och apostrofer (’). Kod, tabeller och variabler på engelska.
- Använd inga påhittade siffror eller tjänster i UI:t. Visa bara det TMDB returnerar.
- Varje steg i `docs/PLAN.md` ska sluta med något som går att använda på telefonen. Committa per delsteg.
- Bygg inte sådant som står under ”Inte i MVP” i planen utan att fråga först.
