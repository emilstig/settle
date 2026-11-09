# Settle

Produktion: https://settle-tonight.vercel.app

Se `CLAUDE.md` för produkt, stack och regler, och `docs/PLAN.md` för byggordningen.

## Kom igång lokalt

```bash
nvm use
yarn
cp .env.example .env.local   # fyll i värdena
yarn dev
```

## Supabase

Nycklarna finns under *Project Settings → API Keys*. Använd de nya nycklarna, inte legacy:
*publishable* (`sb_publishable_…`) i `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` och *secret*
(`sb_secret_…`) i `SUPABASE_SECRET_KEY`. Secret-nyckeln används bara på servern.

1. Kör migreringarna: `npx supabase link --project-ref <ref>` och sedan `npx supabase db push --remote` (Supabase CLI, behöver inte installeras).
2. **Authentication → URL Configuration**: sätt *Site URL* till produktions-URL:en och lägg till
   `http://localhost:3000/**` och `https://*-<vercel-team>.vercel.app/**` under *Redirect URLs*.
3. Inställningarna för inloggning ligger i `supabase/config.toml` och skickas upp med
   `npx supabase config push --remote=<ref>`.
4. Mejlmallen i `supabase/templates/magic_link.html` har både länk och kod. Koden behövs på iPhone,
   där appen på hemskärmen inte delar inloggning med Safari. På gratisplanen går mallar bara att ändra
   med egen SMTP: lägg in SMTP under *Authentication → Emails → SMTP Settings*, avkommentera mallarna
   i `config.toml` och kör `config push` igen.

## Vem som kan logga in

Settle är stängd för nyregistrering (`enable_signup = false` i `supabase/config.toml`). Bara konton som
redan finns kan logga in. Lägg till en testare under *Authentication → Users → Add user* (bocka i
*Auto confirm*), så kan hen sedan logga in med länk. Supabases inbyggda mejl går bara till medlemmar i
organisationen, så testare behöver egen SMTP för att få inloggningsmejlet.

För att testa lokalt utan mejl: `node --env-file=.env.local scripts/dev-login.mjs http://localhost:3000`
skapar ett separat testkonto (första gången) och skriver ut en engångslänk till `/auth/confirm`. Skriptet
vägrar andra adresser än localhost.

## Ikoner

`node scripts/generate-icons.mjs` ritar om ikonerna i `public/icons`.
