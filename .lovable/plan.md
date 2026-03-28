

## Plan: Medlemssida, inloggning & go-live-fix

### Översikt

Skapa en dedikerad `/membership`-sida i samma vita PlayPage-design där gäster kan se tiers, registrera sig (skapar konto), och ansöka om medlemskap. Betalning hanteras manuellt via desken (som idag) — sidan samlar in intresseanmälan, inte betalning. Dessutom säkerställa att inloggningsflödet fungerar och att `/my`-sidan visar bokningar korrekt.

### Vad som byggs

#### 1. Ny `/membership`-sida
- Samma vita, minimalistiska design som PlayPage (Space Grotesk + Space Mono, vita kort, rundade hörn)
- Hämtar `membership_tiers` + `membership_tier_pricing` dynamiskt från DB
- Visar tier-kort med namn, beskrivning, månadspris, dagspasspris
- "Bli medlem"-knapp per tier som öppnar ett registreringsformulär
- Formuläret samlar: namn, e-post, telefon, lösenord (för att skapa konto)
- Vid submit: skapar konto via `signUp`, sparar telefon till `player_profiles`, och skickar en membership request (eller toast med "Vi kontaktar dig för att aktivera ditt medlemskap")
- Om redan inloggad: visa "Kontakta oss för att aktivera medlemskap" + länk till WhatsApp/desk

#### 2. Uppdatera PlayPage
- "Bli medlem"-knappen navigerar till `/membership` istället för `/community?tab=play`

#### 3. Fix inloggning & `/my`-sidan
- Verifiera att Auth-flödet fungerar (det ser korrekt ut redan)
- `/my` visar redan bokningar, dagspass och medlemskap — men lägga till en "Logga in"-länk i PlayPage-headern för icke-inloggade
- Lägga till navigeringslänk till `/my` i PlayPage för inloggade användare

#### 4. Betalning
- Recurring-betalning byggs **inte** nu — medlemskap betalas och aktiveras manuellt via desken (befintligt flöde i CustomersScreen)
- Membership-sidan kommunicerar tydligt att "betalning sker i desken" eller "vi kontaktar dig"
- Stripe-integration för recurring kan läggas till senare

### Filer att ändra/skapa

| Fil | Ändring |
|------|--------|
| `src/pages/MembershipPage.tsx` | **Ny** — tier-lista + registreringsformulär i PlayPage-design |
| `src/App.tsx` | Lägg till route `/membership` |
| `src/pages/PlayPage.tsx` | "Bli medlem" → `/membership`, lägg till inloggnings-/profil-ikon i header |

### Designdetaljer

- Vit bakgrund, samma `FONT_HEADING` och `FONT_MONO` som PlayPage
- Tier-kort i samma stil som event-korten (rundade 2xl, subtila borders)
- Registreringsformulär: samma input-stil som Auth-sidan (rounded-2xl, bg-neutral-50)
- Formuläret visas inline under vald tier (expand/collapse)
- After signup: toast "Konto skapat! Kolla din e-post" + info om att medlemskap aktiveras via desken

