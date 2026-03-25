

## Plan: Fix "Bli medlem" och bokningsvisning i admin

### Problem 1: "Bli medlem" visar inga erbjudanden
- PlayPage:s "Bli medlem"-knapp navigerar till `/community` som visar **FeedTab** (inte membership)
- `PlayNowTab` (community "play" tab) har **hårdkodade** planer istället för att hämta från databasens `membership_tiers`
- Det finns inga faktiska membership tiers synliga för användaren

**Lösning:** Ändra "Bli medlem" på PlayPage att navigera till `/community?tab=play` och uppdatera `PlayNowTab` att hämta tiers + pricing från DB istället för hårdkodad data.

### Problem 2: Bokningar syns inte i admin
- Bokningarna **finns i databasen** (senaste: 2026-03-25, för datum 2026-03-26)
- `TodayScreen` filtrerar **bara dagens datum** — om du bokade för imorgon syns det inte
- Admin-panelen (`/hub`) har **ingen bokningssektion** — bara TodayScreen (som visar banstatus) och BookScreen (för att skapa nya bokningar)

**Lösning:** Lägg till en bokningsöversikt i admin/desk som visar bokningar per dag med datumväljare, inte bara "idag".

### Filer att ändra

| Fil | Ändring |
|------|--------|
| `src/pages/PlayPage.tsx` | Ändra "Bli medlem" → navigera `/community?tab=play` |
| `src/components/community/PlayNowTab.tsx` | Hämta `membership_tiers` + `membership_tier_pricing` från DB istället för hårdkodad data |
| `src/screens/TodayScreen.tsx` | Lägg till en "Bokningar"-sektion med datumväljare som visar alla bokningar, inte bara dagens banstatus |

### Detaljer

**PlayNowTab** omskrivs till att:
1. Hämta aktiva `membership_tiers` via supabase-klienten
2. Hämta `membership_tier_pricing` med `product_type = 'day_pass'` för att visa dagspaspris per tier
3. Rendera tiers dynamiskt med namn, pris, färg från DB

**TodayScreen** bokningsvy:
1. Lägg till expanderbar sektion "Bokningar" under befintliga stats
2. Datumväljare (quickdates + kalender) — defaultar till idag
3. Lista bokningar för valt datum med bana, tid, status, kundinfo (från notes)
4. Möjlighet att avboka (PATCH status → cancelled)

