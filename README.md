# Settle

Se `CLAUDE.md` för produkt, stack och regler, och `docs/PLAN.md` för byggordningen.

## Kom igång lokalt

```bash
npm install
cp .env.example .env.local   # fyll i värdena
npm run dev
```

## Supabase

1. Kör migreringarna: `npx supabase link --project-ref <ref>` och sedan `npx supabase db push`.
2. **Authentication → URL Configuration**: sätt *Site URL* till produktions-URL:en och lägg till
   `http://localhost:3000/**` och `https://*-<vercel-team>.vercel.app/**` under *Redirect URLs*.
3. **Authentication → Email Templates → Magic link** (och *Confirm signup*): klistra in
   `supabase/templates/magic_link.html`. Mallen har både länk och kod. Koden behövs på iPhone,
   där appen på hemskärmen inte delar inloggning med Safari.
4. Sätt OTP-längden till 6 siffror under *Authentication → Providers → Email* om du vill ha korta koder.

## Ikoner

`node scripts/generate-icons.mjs` ritar om ikonerna i `public/icons`.
