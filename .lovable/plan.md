

## Plan: Open Play, Event-prissättning och Dagspass-modell

### Problemanalys

1. **Events saknar start/sluttid** — `start_date` och `end_date` är `timestamptz` i DB men admin-UI:t hanterar dem bara som datum, inte klockslag.
2. **Inga banval per event** — events har `number_of_courts` (antal) men kopplar inte till specifika `venue_courts`.
3. **Play-sidan visar medlemskap först** — borde istället visa dagens aktiviteter/event med priser per kundtyp.
4. **Dagspass som "valuta"** — ett event kan kosta "1 dagspass". Köper du dagspass för t.ex. Pickla Open får du även Open Play hela dagen.

### Designförslag: Dagspass-modellen

```text
Dagspass = en heldags-token för anläggningen

Event-prissättning:
┌─────────────────────────────────────────────┐
│ Pickla Open (Open Play)                     │
│ Medlem: Gratis  |  Play: 120kr  |  Gäst: 165kr │
│ (= 1 dagspass)                              │
└─────────────────────────────────────────────┘

Logik:
- Event har entry_fee_type: 'fixed' | 'day_pass'
- Om 'day_pass': priset = dagspaspriset (styrt av membership tier)
- Köp av dagspass → giltigt hela dagen → inkluderar alla drop-in event
- Medlem med "fri entry" behöver inget dagspass
```

### Ändringar

#### 1. Events-tabellen: Lägg till tider och bankoppling

**DB-migration:**
- Ny kolumn `start_time TIME` och `end_time TIME` på `events` (separata från datum)
- Ny kopplingstabell `event_courts` (event_id → venue_court_id) för vilka banor eventet använder
- Ny kolumn `entry_fee_type TEXT DEFAULT 'fixed'` på `events` (`'fixed'` eller `'day_pass'`)
- Ny kolumn `entry_fee NUMERIC` på `events` (direktpris per event istället för att förlita sig på pricing_rules)

#### 2. Play-sidan: Event-fokuserad istället för medlemskapsfokuserad

Ny struktur för `/play`:
1. **Dagens aktiviteter** — lista publika event idag med priser per kundtyp (gratis/medlem/play/gäst)
2. **Kommande event** — nästa vecka
3. **Boka bana** — CTA
4. **Medlemskap** — liten badge/länk längst ner (inte kort)
5. **Community feed** — som idag

Priser visas direkt på event-kortet:
- Hämta användarens membership tier
- Beräkna pris via `membership_tier_pricing` (product_type = 'event_fee' eller 'day_pass')
- Visa: "Medlem: 0 kr | Play: 120 kr | Gäst: 165 kr"

#### 3. AdminEvents: Tider och banval i event-formuläret

- Lägg till `start_time` / `end_time` fält (time-picker)
- Lägg till multi-select för venue_courts (vilka banor)
- Lägg till `entry_fee` och `entry_fee_type` (dropdown: fast pris / dagspass)

#### 4. api-events och api-event-public: Hantera nya fält

- Uppdatera `create` och `update` endpoints med nya fält
- Uppdatera `detail` endpoint att returnera kopplade banor
- Uppdatera `list` endpoint att returnera tider och prisinfo

#### 5. Incheckning + Dagspass-koppling

Nuvarande `venue_checkins.entry_type` stödjer redan `'day_pass'`. Logiken:
- Vid incheckning: om kund har aktivt dagspass idag → entry_type = 'day_pass'
- Om kund registrerar sig till event med `entry_fee_type = 'day_pass'` → skapa ett dagspass automatiskt
- Dagspasset gäller hela dagen, inklusive alla drop-in event

### Filer att ändra/skapa

| Fil | Ändring |
|-----|---------|
| DB-migration | Nya kolumner på `events`, ny `event_courts` tabell |
| `src/pages/PlayPage.tsx` | Omdesign: event-lista först, medlemskap nedtonat |
| `src/components/admin/AdminEvents.tsx` | Tider, banval, entry_fee_type |
| `supabase/functions/api-events/index.ts` | Nya fält i create/update |
| `supabase/functions/api-event-public/index.ts` | Returnera tider, banor, tier-priser |
| `supabase/functions/api-checkins/index.ts` | Dagspass-koppling vid incheckning |

### Pickla Event Hub-projektet

Det andra projektet ([Pickla Event Hub](/projects/242423e3-f089-4b74-82fe-b3b4924fa4b7)) har bara `generate-team-names` och `parse-event` edge functions — ingen API att koppla till direkt. All event-logik lever redan i detta projekts `api-events` och `api-event-public`. Vi bygger vidare på dessa.

