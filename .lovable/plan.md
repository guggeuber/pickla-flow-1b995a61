

# Crew-traning med direkt bokning

## Oversikt

Nar en crew-ledare **eller co-leader** skapar ett traningstillfalle sa gors en riktig bokning i systemet direkt -- inget separat steg. Medlemmar kan sedan anmala sig till traningen.

## Flode

```text
1. Leader/co-leader klickar "Ny traning" i crew-vyn
2. Valjer datum, tid, langd, venue och bana
3. Klickar "Boka traning"
4. -> Riktig bokning skapas via api-bookings/create
5. -> crew_sessions-rad skapas med booking_id kopplat
6. -> Status = "booked" direkt
7. Medlemmar ser traningen och kan anmala sig
```

## Databasandringar

### Ny tabell: `crew_sessions`

| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | uuid PK | |
| crew_id | uuid FK -> crews | |
| title | text | T.ex. "Tisdagstraning" |
| description | text (nullable) | Valfri beskrivning |
| session_date | date | |
| start_time | timestamptz | |
| end_time | timestamptz | |
| venue_id | uuid (nullable) | |
| venue_court_id | uuid (nullable) | |
| booking_id | uuid (nullable) | Kopplas till bookings |
| max_participants | integer (nullable) | null = obegransat |
| status | text | "booked", "completed", "cancelled" |
| created_by | uuid | auth user id |
| created_at / updated_at | timestamptz | |

### Ny tabell: `crew_session_signups`

| Kolumn | Typ | Beskrivning |
|---|---|---|
| id | uuid PK | |
| crew_session_id | uuid FK -> crew_sessions | |
| player_profile_id | uuid FK -> player_profiles | |
| status | text | "signed_up" / "cancelled" |
| signed_up_at | timestamptz | |

### RLS-policyer

- **crew_sessions**: Publikt lasbara. Leader **och co-leader** kan INSERT/UPDATE/DELETE (via `is_crew_leader` som redan inkluderar bade leader och co_leader). Samma funktion anvands for bokningsknappen.
- **crew_session_signups**: Publikt lasbara. Crew-medlemmar kan INSERT sin egen rad. Kan DELETE sin egen rad.

Befintlig `is_crew_leader()` kontrollerar redan `role IN ('leader', 'co_leader')` -- ingen andring behovs dar.

## Nya komponenter

### `CreateSessionModal.tsx`
Modal som leader/co-leader oppnar:
- Titel-falt
- Datumvaljare
- Tidvaljare (klickbara tidsluckor)
- Langdvaljare (60/90 min)
- Venue + bana-val (hamtar venues och venue_courts)
- Max deltagare (valfritt)
- "Boka traning"-knapp som:
  1. Anropar `api-bookings/create` for att skapa riktig bokning
  2. Skapar `crew_sessions`-rad med `booking_id` och status `booked`

### `CrewSessionsList.tsx`
Visas i `CrewDetailView` under medlemmar:
- Listar kommande traningar med datum, tid, bana, antal anmalda
- "Anmal dig" / "Avanmal"-knapp for crew-medlemmar
- Badge som visar "Bokad" (gron)

## Andringar i befintliga filer

### `CrewDetailView.tsx`
- Importera `CrewSessionsList` och `CreateSessionModal`
- Lagg till "Ny traning"-knapp synlig for leader och co-leader
- Visa sessionslistan i crew-detaljvyn

## Sammanfattning av filer

| Vad | Fil |
|---|---|
| DB-migrering | `supabase/migrations/xxx_crew_sessions.sql` |
| Skapa session + boka | `src/components/community/CreateSessionModal.tsx` |
| Sessionslista + anmalan | `src/components/community/CrewSessionsList.tsx` |
| Andrad | `src/components/community/CrewDetailView.tsx` |

