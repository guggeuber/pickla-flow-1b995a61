# Pickla Admin OS — UX Audit & Redesign Proposal

> Status: Proposal. No code changes. Hand-off doc for design → Codex implementation.
> Scope: `/hub/admin` (AdminPage) + all 19 admin modules.

---

## 1. UX Audit — what exists today

Admin is a **grid of 19 module tiles** → tap → opens a single-table CRUD screen. Each tile maps 1:1 to a database concept.

| Tile | Module file | What it really is |
|---|---|---|
| Banor | AdminCourts | `venue_courts` table |
| Paddor | AdminDevices | `display_devices` table |
| Priser | AdminPricing | `pricing_rules` table |
| Produkter | AdminProducts | `access_products` table |
| Schema | AdminSchedule | `activity_sessions` + `activity_series` |
| Personal | AdminStaff | `venue_staff` table |
| Öppettider | AdminHours | `opening_hours` table |
| Länkar | AdminLinks | `venue_links` table |
| Venue | AdminVenue | `venues` row |
| Stories | AdminStories | `community_stories` table |
| Events | AdminEvents | `events` (planning + public) — 1500 LOC, contains pipeline/calendar/möte |
| Event Leads | AdminEventLeads | inquiry-stage events — 1321 LOC |
| Event Products | AdminEventProducts | `event_products` table |
| Blockeringar | AdminResourceBlocks | resource holds — 683 LOC |
| Drift | AdminVenueOperations | overrides / closures |
| Medlemskap | AdminMemberships | tiers + pricing — 948 LOC |
| Event-mallar | AdminTemplates | franchise templates (HQ) |
| Företag | AdminCorporate | corporate accounts |
| Chat | AdminChannels | forum channels |

### Observed architecture properties
- **One screen = one table.** The user must mentally JOIN them.
- **Same domain split across 3+ tiles.** Events lives in *Events*, *Event Leads*, *Event Products*, *Event-mallar*, *Blockeringar*, *Schema* — and partially in *Priser* and *Produkter*.
- **No shared time axis.** Every module renders its own list; nothing aligns to a calendar.
- **No shared capacity view.** Courts, blocks, sessions, events, bookings — all visible separately, never overlaid.
- **No "today" surface for staff.** OpsCenter exists for desk, but the admin entry point is a 19-tile menu, not a day.
- **No notion of "what needs my attention".** No inbox, no conflicts, no overdue.

---

## 2. Pain points (mapped to user intent)

> Each pain point is phrased as the gap between **what the user wants to do** and **what the UI forces them to do**.

### A. "Vad händer den 25 juni?"
Today: open Events → filter → open Schema → open Blockeringar → open Drift → mentally merge.
Pain: there is no date-centric view of the house.

### B. "Kan jag lägga in ett event 14–17 i hela darten?"
Today: open Events form → guess resources → save as `tentative` → open Schema to verify no clash → open Blockeringar to hold → open Bookings (doesn't exist in admin) to check court load.
Pain: capacity & conflict checking is manual and post-hoc. Double-booking is possible.

### C. "Vilka leads ligger och pyr?"
Today: Event Leads tab — flat list, no SLA, no last-touch, no owner alert.
Pain: no triage. Hot leads die silently.

### D. "Ska vi öppna imorgon?"
Today: Drift (overrides) + Öppettider (weekly) — two screens, no merged "what is the operational calendar".
Pain: staff can't see "next 7 days as the house will actually run".

### E. "Vem är på plats nu och vad gör vi nu?"
Today: not in admin at all. Lives in `/desk` (OpsCenter).
Pain: admin and ops are two universes. Owner can't see live occupancy without switching context.

### F. "Vad säljer? Vad är tomt?"
Today: nothing. There is no occupancy heatmap, no fill-rate, no revenue-per-court.
Pain: planning decisions (more open play? raise price?) have no surface.

### G. "Är det här eventet redo?"
Today: Events row has `planning_status` but no checklist (resources confirmed? staff assigned? customer paid? padda prepped? communication sent?).
Pain: readiness is tribal knowledge, not a state.

### H. Domain fragmentation
*Events* leaks into 6 tiles. *Customers* doesn't exist as a tile at all (lives implicitly inside bookings, memberships, corporate, leads). *Memberships* and *Corporate* are siblings of *Products* but disconnected from *Pricing*.

### I. Forms-as-UI
Most modules are CRUD forms with 6–20 fields. The user is doing data entry, not running a venue.

### J. No global search / no command bar
To find "Anna Andersson booking from May 25", staff must guess which tab.

---

## 3. New Information Architecture

> Replace **19 module tiles** with **6 task-surfaces** + a hidden **System Settings** drawer for the rare CRUD that remains.

```text
┌──────────────────────────────────────────────────────────────┐
│  Pickla Admin OS                                  ⌘K search  │
├──────────────────────────────────────────────────────────────┤
│  1. TODAY          live ops + attention inbox                │
│  2. CALENDAR       house view, week/day/month, all layers    │
│  3. PIPELINE       leads → events → delivered                │
│  4. CAPACITY       occupancy, conflicts, revenue heatmap     │
│  5. PEOPLE         customers, members, corporate, staff      │
│  6. CATALOG        products, pricing, memberships, schedule  │
│                                                              │
│  ⚙  Settings       venue, hours, courts, paddor, links,     │
│                    drift overrides, channels, templates      │
└──────────────────────────────────────────────────────────────┘
```

### Mapping old → new
| Old tile | New home |
|---|---|
| Events, Event Leads | **Pipeline** (lead → tentative → booked → ready → done) |
| Event Products, Event-mallar | **Catalog → Event packages** |
| Schema, Blockeringar | **Calendar** (sessions and blocks are just layers on the calendar) |
| Banor, Paddor, Öppettider, Drift, Länkar, Venue, Channels, Stories | **Settings** |
| Priser, Produkter, Medlemskap | **Catalog** |
| Personal | **People → Staff** |
| Företag | **People → Corporate** |
| (none today) | **Today** (attention inbox + live occupancy) |
| (none today) | **Capacity** (heatmaps, fill rate, conflicts) |

### Design principles applied
- **Calendar first.** Every event/session/block/override renders on one shared time axis.
- **Timeline first.** Every customer, lead, event has an activity timeline, not a form.
- **Capacity first.** Booking, blocking, scheduling all happen *on top of* a visible occupancy grid that updates live.
- **Action first.** Each surface opens with "what needs your attention now", not an empty form.

---

## 4. Wireframes (low-fi)

### 4.1 TODAY — landing surface
```text
┌─ Pickla Admin · Arena Sthlm ─────────────────  ⌘K ─┐
│ Tis 25 juni · 14 personer i huset · 78% beläggn.   │
├────────────────────────────────────────────────────┤
│ ATTENTION (4)                                       │
│  • 3 leads har inte fått svar på 48h          →    │
│  • Event "Spotify kickoff" saknar staff       →    │
│  • Padda B7 offline sedan 11:14               →    │
│  • Friskvårdsmoms fattas på 2 kvitton         →    │
├────────────────────────────────────────────────────┤
│ NU PÅ HUSET                                         │
│  [mini occupancy strip: B1▮ B2▮ B3░ B4▮ ... D1▮]   │
│  Nästa pass: Open Play Kväll 17:00 · 12/16 anm.    │
├────────────────────────────────────────────────────┤
│ DAGENS PLAN                                         │
│  10:00 Open Play FM         ●●●●●●●●○○ 8/10        │
│  14:00 Företagsevent ABB    ▣ Hela darten · ⚠ stf  │
│  17:00 Open Play Kväll      ●●●●●●●●●●●● 12/16    │
│  19:30 Pickla Open kval     ●○○○ 1/8               │
└────────────────────────────────────────────────────┘
```
Replaces: the 19-tile launcher.

### 4.2 CALENDAR — the house view
```text
┌─ Vecka 26 ──────────  [Dag][Vecka][Månad]  + Lägg in ─┐
│        Mån 23  Tis 24  Ons 25  Tor 26  Fre 27  ...    │
│ 08 ┌──────────────────────────────────────────────┐   │
│ 09 │ Open Play FM  (B1–B4)                        │   │
│ 10 │ ████████████████████  ████████████████████   │   │
│ 11 │                                              │   │
│ 12 │            ░ Föret. tentativ ABB ░           │   │
│ 14 │ ▓▓▓▓▓ Företagsevent (hela darten) ▓▓▓▓▓     │   │
│ 17 │ Open Play Kväll                              │   │
│ 18 │ ████████████ Gruppträning ████████████       │   │
│ 19 │ ▓ Pickla Open kval ▓                         │   │
│ 21 │                                              │   │
│    └──────────────────────────────────────────────┘   │
│ Lager: ☑ Sessions  ☑ Events  ☑ Blocks  ☑ Drift  ☑ Bok│
└───────────────────────────────────────────────────────┘
```
Drag-to-create. Conflicts highlighted red. Drift overrides shown as striped bars across all resources.

### 4.3 PIPELINE — lead-to-delivery board
```text
┌─ Eventpipeline ────────────────  Mina · Alla · Filtrera ─┐
│ INKOMM(7) │ TENTATIV(3) │ BOKAD(5) │ KLAR(2) │ KÖRD(11)  │
│ ┌───────┐ │ ┌─────────┐ │ ┌──────┐ │ ┌─────┐ │ ┌────────┐│
│ │Spotify│ │ │ABB 25/6 │ │ │SEB   │ │ │Klar │ │ │  ...   ││
│ │ 2d ⚠  │ │ │14–17 dt │ │ │6/7   │ │ │  ✓  │ │ │        ││
│ │ Anna  │ │ │ owner: J│ │ │ paid │ │ └─────┘ │ └────────┘│
│ └───────┘ │ └─────────┘ │ └──────┘ │           │          │
└──────────────────────────────────────────────────────────┘
```
Card opens drawer: customer + timeline + readiness checklist (resources/staff/paid/comm/padda) + linked calendar slot.

### 4.4 CAPACITY — occupancy & conflicts
```text
┌─ Kapacitet · Juni 2026 ───────  Resurs · Sport · Hela huset ─┐
│ Heatmap (timme × dag), färg = fill rate                       │
│       Mån Tis Ons Tor Fre Lör Sön                             │
│ 08    ░░  ░░  ░░  ░░  ░░  ▓▓  ▓▓                              │
│ 17    ██  ██  ██  ██  ▓▓  ▓▓  ██                              │
│ 20    ██  ██  ██  ██  ██  ██  ▓▓                              │
│                                                               │
│ KONFLIKTER (2)                                                │
│  ⚠ 25/6 14–17  Event ABB krockar med Open Play kväll          │
│  ⚠ 27/6 18–19  Gruppträning krockar med stängt (drift)        │
│                                                               │
│ INTÄKT vs FÖRRA VECKAN   +12%   ████████████░░                │
└───────────────────────────────────────────────────────────────┘
```

### 4.5 PEOPLE — unified customer record
```text
┌─ Anna Andersson · Medlem Founder ────────────  Mejla · Ring ─┐
│ TIMELINE                                                      │
│  • Bokade B3 25/6 17:00  (98 kr)                             │
│  • Köpte day pass 22/6                                       │
│  • Anmäld Open Play Kväll 25/6                               │
│  • Förnyade Founder 01/05                                    │
│ ENTITLEMENTS  ▮ 2/4 court hours kvar denna vecka             │
│ KVITTON  · 12 st · Friskvård: aktivt                         │
└───────────────────────────────────────────────────────────────┘
```
One record collapses bookings + memberships + corporate role + receipts + check-ins.

### 4.6 CATALOG — sell-side configuration
```text
┌─ Catalog ───────────────────────────────────────────────────┐
│ [Produkter] [Priser] [Medlemsnivåer] [Eventpaket] [Schema]  │
│                                                              │
│ Day Pass                       250 kr   Founder: 0 kr  ✏     │
│ Open Play slot (1.5h)          165 kr   Founder: -20%  ✏     │
│ Group training                 199 kr                  ✏     │
│ Founder membership          499 kr/mån  · 4h/v inkl   ✏     │
│ Corporate L                 8 000 kr/mån · 40h        ✏     │
└──────────────────────────────────────────────────────────────┘
```

### 4.7 SETTINGS — collapsed CRUD
A single drawer with venue, hours, courts, paddor, links, channels, drift overrides, templates, stories. Each is a small form. This is where ~70% of today's tiles end up — out of the way.

---

## 5. Implementation roadmap

> Codex-ready. Each phase ships independently; no big-bang rewrite.

### Phase 0 — Foundation (1–2 days)
- Introduce new admin shell: top nav with the 6 surfaces + `⌘K` search + `Settings` icon.
- Keep all old modules reachable from Settings to avoid regressions.
- Add `useAdminAttention()` hook that aggregates: unresponded leads (>24h), events missing staff/resources/readiness, offline paddor, drift overrides today/tomorrow, friskvård/receipt gaps.

### Phase 1 — TODAY surface (2–3 days)
- Build attention inbox component fed by `useAdminAttention`.
- Embed live occupancy strip (reuse OpsCenter realtime sub).
- Render "today's plan" by merging `activity_sessions` + `events` + `resource_blocks` + drift overrides for the Stockholm day.
- This replaces the current 19-tile landing.

### Phase 2 — CALENDAR (3–5 days)
- Shared time-grid component (day / week / month) with resource rows.
- Layers: sessions, events, blocks, drift, bookings — each toggleable, each from existing tables.
- Conflict detection on render (pure client compute over the merged set).
- Drag-to-create opens a unified "new entry" sheet that picks the right entity (event vs block vs session) based on context.

### Phase 3 — PIPELINE (2–3 days)
- Refactor AdminEvents + AdminEventLeads (currently 2 800 LOC across two files) into one kanban driven by `planning_status`.
- Card drawer = customer panel + readiness checklist + linked calendar slot + communication thread (already in `event_communications`).
- Retire AdminEventLeads as a separate tile.

### Phase 4 — CAPACITY (3–4 days)
- Heatmap from bookings/check-ins aggregated per hour × day.
- Conflict list = output of Phase 2 conflict detector, persisted as a queryable view.
- Revenue panel from `booking_receipts` + future `customer_transactions`.
- No new write paths — read-only surface.

### Phase 5 — PEOPLE (3–4 days)
- New "Customer 360" page that joins `players` / `memberships` / `bookings` / `day_passes` / `corporate_members` / `event_checkins` / `booking_receipts`.
- Subtabs: Kunder, Medlemmar, Företag, Personal.
- Replaces parts of AdminMemberships, AdminCorporate, AdminStaff (which become forms inside this surface).

### Phase 6 — CATALOG (2–3 days)
- Merge AdminProducts + AdminPricing + AdminMemberships pricing + AdminEventProducts under one tabbed surface.
- No schema changes; UI consolidation only.

### Phase 7 — Settings cleanup (1–2 days)
- Move AdminVenue, AdminHours, AdminCourts, AdminDevices, AdminLinks, AdminChannels, AdminStories, AdminVenueOperations (drift), AdminTemplates, AdminResourceBlocks (as fallback CRUD) into a single Settings drawer.
- Delete old 19-tile launcher.

### Phase 8 — Polish (ongoing)
- `⌘K` global search across customers, bookings, events, leads, paddor.
- Keyboard shortcuts on each surface.
- Saved filters per user.

### Non-goals for this redesign
- No DB schema changes. Every new surface reads existing tables.
- No change to Edge Functions until Phase 5+ where a `customer_360` read endpoint becomes useful.
- No change to desk / OpsCenter — Admin OS *links* into ops, doesn't replace it.

---

## 6. Success metrics
- Time-to-answer "vad händer 25/6?" drops from N clicks across 4 tabs → 1 click (Calendar → date).
- Lead response SLA visible and actionable from Today surface.
- Zero double-bookings caused by manual cross-checking (conflict detector catches before save).
- Owner can run a Monday review entirely from Today + Capacity, without opening any CRUD form.
