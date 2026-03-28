

## Plan: Dagspass-system med delning, förbrukning och självservice

### Översikt

Bygga ett komplett dagspass-system där medlemmar kan:
1. Få en månatlig kvot dagspass (t.ex. 4/mån) baserat på sin tier
2. Dela/skicka pass till vänner via e-post/telefon (vännen får en unik länk)
3. Vännen skapar konto via länken och ser passet i sitt konto
4. Pass förbrukas (status → `used`) vid incheckning
5. Vem som helst kan köpa vanliga dagspass direkt på `/membership`

### Databasändringar

**1. Ny tabell: `day_pass_grants`** — spårar medlemmars månatliga kvot
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | uuid | PK |
| membership_id | uuid | FK → memberships |
| venue_id | uuid | FK → venues |
| month_year | date | Första dagen i månaden (2025-04-01) |
| passes_allowed | int | Antal pass tillåtna (t.ex. 4) |
| passes_used | int | Antal använda/delade |

**2. Ny tabell: `day_pass_shares`** — spårar delade pass
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | uuid | PK |
| day_pass_id | uuid | FK → day_passes (skapas vid delning) |
| shared_by | uuid | Medlemmens user_id |
| recipient_email | text | Mottagarens e-post |
| recipient_phone | text | Mottagarens telefon |
| token | text | Unik token för claim-länk |
| status | text | pending / claimed / expired |
| claimed_by | uuid | Mottagarens user_id efter claim |
| claimed_at | timestamptz | |

**3. Utöka `membership_tier_pricing`** — ny product_type `monthly_passes`
Lägg till rader med product_type = `monthly_passes` och fixed_price = antal pass/mån per tier.

**4. Utöka `day_passes`**
- Lägg till kolumn `shared_from` (uuid, nullable) — FK till day_pass_shares
- Befintlig `status` enum behöver värdet `used` (kontrollera om det finns)

### Edge Functions

**5. `api-day-passes` — utöka med nya endpoints:**
- `POST /share` — Medlem delar ett pass: skapar day_pass + day_pass_share med token, skickar inte e-post (visas som länk att kopiera/dela)
- `POST /claim/:token` — Mottagare claimar passet: skapar konto om behövs, kopplar day_pass till rätt user_id
- `GET /my-allowance` — Returnerar medlemmens kvot och antal kvar för aktuell månad
- `PATCH /consume` — Desken markerar dagspass som `used` vid incheckning

**6. `api-day-passes/public-purchase`** — redan finns, behåll för köp av vanliga dagspass

### Frontend

**7. `/membership` — lägg till sektion "Köp dagspass"**
- Enkel knapp/kort under tier-listan: "Köp dagspass — 165 kr"
- Anropar befintliga `public-purchase` endpointen
- Visar bekräftelse med referenskod

**8. `/my` — utöka med dagspass-hantering för medlemmar**
- Visa "Dina dagspass denna månad: 2 av 4 kvar"
- Knapp "Ge till en vän" → formulär med e-post/telefon
- Genererar delningslänk som kopieras / delas via SMS/WhatsApp
- Lista över delade pass med status (väntande/hämtad)

**9. Ny route: `/pass/:token`** — Claim-sida
- Visa "Du har fått ett dagspass från [namn]!"
- Om ej inloggad: registreringsformulär (samma stil som membership)
- Om inloggad: knapp "Hämta ditt pass" → claimar passet
- Redirect till `/my` efter claim

**10. Incheckning (desk)** — uppdatera befintlig checkin-logik
- Vid incheckning, markera day_pass.status = `used`

### Filer att ändra/skapa

| Fil | Ändring |
|-----|---------|
| Migration | Skapa `day_pass_grants`, `day_pass_shares`, utöka `day_passes` med `shared_from` |
| `supabase/functions/api-day-passes/index.ts` | Nya endpoints: share, claim, my-allowance, consume |
| `src/pages/MembershipPage.tsx` | Lägg till "Köp dagspass"-sektion |
| `src/pages/MyPage.tsx` | Dagspass-kvot, dela-knapp, lista delade pass |
| `src/pages/ClaimPassPage.tsx` | **Ny** — claim-sida för delade pass |
| `src/App.tsx` | Lägg till route `/pass/:token` |
| `src/hooks/useDesk.ts` | Uppdatera checkin för att konsumera dagspass |

### Flöde

```text
Medlem → "Ge till vän" → Anger e-post/telefon
  → System skapar day_pass + day_pass_share med token
  → Medlem får delningslänk: /pass/ABC123
  → Delar via SMS/WhatsApp

Vän → Öppnar /pass/ABC123
  → Ser "Du har fått ett dagspass!"
  → Skapar konto eller loggar in
  → Pass kopplas till vännens konto

Vän → Kommer till venue → Visar pass i /my
  → Desk checkar in → Pass markeras "used"
```

