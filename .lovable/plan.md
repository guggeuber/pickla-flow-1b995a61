

## Plan: Route-omstrukturering, Desk-routing och Incheckning

### 1. Omstrukturering av routes

**Nuvarande problem:** LinkHub (`/links`) borde vara startsidan (`/`), och Desk-appen (`/` idag) + Admin (`/admin`) behöver egna routes med mindre uppenbara namn.

**Ny route-struktur:**

| Route | Komponent | Beskrivning |
|-------|-----------|-------------|
| `/` | LinkHub | Publik startsida (stories, status, nav) |
| `/play` | PlayPage | Medlemskap, dagspass, feed |
| `/my` | MyPage | Konto, bokningar, medlemskap |
| `/auth` | Auth | Login/signup |
| `/desk` | Index (Desk-appen) | Personal: Today, Customers, Book, Sell, Ops |
| `/hub` | AdminPage | Venue-admin (istället för `/admin`) |
| `/event-ops` | EventOps | Event-styrning |
| `/event/:id`, `/e/:slug` | EventPage | Event-detalj |
| `/book` | BookingPage | Banbokning |
| `/b/:ref` | BookingConfirmation | Bekräftelse |

**Ändringar i `App.tsx`:**
- `/` → LinkHub (publik, ingen auth)
- `/desk` → ProtectedRoute + Index (desk)
- `/hub` → ProtectedRoute + AdminPage
- Ta bort `/links`
- Uppdatera alla `navigate("/links")` till `navigate("/")`

**Uppdatera navigering i:**
- `MyPage.tsx`: signOut → `navigate("/")`
- `Index.tsx` (Desk): admin-knapp → `/hub`
- `Auth.tsx`: default redirect för personal → `/desk`, kunder → `/play`

### 2. Incheckning — datamodell och logik

**Koncept:** När en kund kommer till anläggningen måste de checkas in. Incheckningen validerar att kunden har rätt att spela (aktivt medlemskap, dagspass, eller banbookning).

**Entitlement-logik (ny edge function `api-checkins`):**

Ny endpoint: `POST /validate-checkin`

```text
Input: { user_id eller phone/namn, venue_id }
Logik:
  1. Kolla memberships → aktiv? ✅ entry_type = "membership"
  2. Kolla day_passes → giltigt dagspass idag? ✅ entry_type = "day_pass"  
  3. Kolla bookings → aktiv bokning just nu? ✅ entry_type = "booking"
  4. Inget hittat → ❌ "Ingen giltig entitlement"
Output: { allowed: bool, entry_type, details }
```

**DB-migration:** Lägg till kolumner på `event_checkins` eller skapa ny tabell `venue_checkins`:

```sql
CREATE TABLE venue_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL,
  user_id UUID,
  player_name TEXT,
  player_phone TEXT,
  entry_type TEXT NOT NULL, -- 'membership', 'day_pass', 'booking', 'manual'
  entitlement_id UUID,     -- FK till membership/day_pass/booking
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_out_at TIMESTAMPTZ,
  checked_in_by UUID,      -- staff user
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

RLS: Staff kan läsa/skriva för sin venue. Publik kan räkna (för spelarräknaren).

### 3. Incheckning via Desk

**Ny flik eller integration i TodayScreen:**
- "Check In"-knapp prominent i Desk-vyn
- Söker kund via namn/telefon/email
- Visar automatiskt kundens entitlement (medlemskap, dagspass, bokning)
- One-tap check-in om entitlement finns
- Om ingen entitlement: erbjud att skapa dagspass direkt

### 4. QR-kod för självincheckning (framtida fas)

- Generera en QR-kod per kund (baserat på user_id eller booking_ref)
- Kunden visar QR i desken, personal skannar
- Eller: en iPad vid ingången med kamera som skannar

**Rekommendation:** Börja med desk-baserad incheckning (steg 2-3), QR som nästa iteration.

### Sammanfattning av filer att ändra/skapa

| Fil | Ändring |
|-----|---------|
| `src/App.tsx` | Ny route-mappning |
| `src/pages/MyPage.tsx` | Navigering till `/` |
| `src/pages/Index.tsx` | Admin-knapp → `/hub` |
| `src/pages/Auth.tsx` | Redirect-logik desk vs kund |
| `src/pages/PlayPage.tsx` | Navigering till `/` |
| DB-migration | Ny `venue_checkins`-tabell |
| `supabase/functions/api-checkins/index.ts` | Validate + create checkin |
| `src/screens/TodayScreen.tsx` | Check-in widget |

