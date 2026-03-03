

# Pickla Crews -- Gille/Klan-system inspirerat av gaming

Spelare bildar "Crews" (gillen/klaner) som tranar tillsammans, tar i mot utmaningar och klimbar pa en gemensam rankinglista -- precis som i Clash of Clans eller Brawl Stars, men for pickleball.

---

## Koncept

```text
+----------------------------------------------+
|              PICKLA CREWS                     |
|                                               |
|  Crew Card (som referensbilden)               |
|  +----------------------------------------+  |
|  | [Badge]  Nora the best     16/50       |  |
|  |          "This is nora sigma join me"   |  |
|  |                                         |  |
|  |  Crew Score: 1826   Activity: Medium    |  |
|  |  Required Level: 0  Type: Open          |  |
|  |                                         |  |
|  |          [ Ga med ]                     |  |
|  +----------------------------------------+  |
|                                               |
|  Crew Members (rankade)                       |
|  #1  An1         Rating 434                   |
|  #2  Clyde       Rating 258                   |
|  ...                                          |
+----------------------------------------------+
```

---

## Nya databastabeller

### 1. `crews` -- Gillen/klaner
- `id` (uuid, PK)
- `name` (text, unikt)
- `description` (text, valfritt)
- `badge_emoji` (text, t.ex. "flower" -- anvands for att valja badge-ikon)
- `badge_color` (text, hex-farg for badge)
- `crew_type` (text: "open", "invite_only", "closed")
- `min_rating` (integer, default 0 -- krav for att ga med)
- `max_members` (integer, default 50)
- `created_by` (uuid, auth_user_id)
- `venue_id` (uuid, nullable -- kan kopplas till en hall eller vara global)
- `created_at`, `updated_at`

### 2. `crew_members` -- Medlemmar
- `id` (uuid, PK)
- `crew_id` (uuid, FK -> crews)
- `player_profile_id` (uuid, FK -> player_profiles)
- `role` (text: "leader", "co_leader", "elder", "member")
- `joined_at` (timestamptz)

### 3. `crew_challenges` -- Clash mellan crews
- `id` (uuid, PK)
- `challenger_crew_id` (uuid, FK -> crews)
- `challenged_crew_id` (uuid, FK -> crews)
- `status` (text: "pending", "accepted", "completed", "declined")
- `message` (text, valfritt)
- `result` (jsonb -- vinnare, matcher spelade, poang)
- `created_at`, `completed_at`

### RLS-policyer
- Crews: publikt lasbara, bara leader kan uppdatera/ta bort
- Crew members: publikt lasbara, autentiserade kan ga med (INSERT), bara leader kan ta bort andra
- Crew challenges: publikt lasbara, crew leaders kan skapa/svara

---

## Nya UI-komponenter

### Community-navigering -- ny flik "Crews"
Utoka `CommunityNav.tsx` med en fjarde flik:

```text
[ Feed ]  [ Ranking ]  [ Crews ]  [ Profil ]
```

### CrewsTab.tsx -- Oversikt
- Lista alla crews sorterade pa "crew score" (summa av medlemmarnas rating)
- Varje crew-kort visar: badge, namn, beskrivning, medlemsantal/max, crew score, typ (Open/Invite), krav
- "Skapa Crew"-knapp for inloggade utan crew
- Filter: "Alla" / "Oppna" / "Min hall"

### CrewCard.tsx -- Enskilt crew-kort
- Gaming-inspirerad design med badge/emblem, farg, och stor "Ga med"-knapp for oppna crews
- Visa crew stats: Total score, aktivitetsniva, antal medlemmar
- Klicka for att oppna crew-detaljvy

### CrewDetailPage.tsx -- ny route `/community/crew/:id`
- Fullstandig crew-vy (som referensbilden):
  - Crew-header med badge, namn, beskrivning, kapacitet
  - Stats-ruta: Crew Score, Activity, Required Level, Type
  - "Ga med" / "Lamna"-knapp
  - Medlemslista rankad pa rating med position, avatar, namn, rating
  - "Utmana"-knapp for ledare av andra crews -- skapar en crew_challenge

### CrewBadge.tsx -- Visuellt emblem
- Emoji-baserat badge med konfigurerbar bakgrundsfarg
- Anvands i crew-kort, leaderboard och spelarens profil

---

## Andringar i befintliga komponenter

### ProfileTab.tsx
- Visa spelarens crew under profilkortet: "Crew: [badge] Nora the best"
- Lank till crew-detaljsidan

### LeaderboardTab.tsx
- Ny sub-tab: "Spelare" / "Crews" -- crews-leaderboard visar crews rankade pa total score

### CommunityPage.tsx
- Lagg till "crews"-tab i state
- Ny route `/community/crew/:id` i App.tsx

### FeedTab.tsx (framtida)
- Auto-genererade feed-poster nar: ny crew skapas, medlem gar med, crew challenge avslutas

---

## Check-in-koppling

Allt forblir lankat till inloggad spelare:
- Nar en crew-medlem checkar in pa en hall, syns det i crew-aktiviteten
- Crew score beraknas fran alla medlemmars `pickla_rating`
- Matcher spelade av crew-medlemmar rakas in i crewens aktivitetsniva
- Crew activity level beraknas som: "High" (5+ matcher/vecka), "Medium" (2-4), "Low" (0-1)

---

## Teknisk plan

### Nya filer
- `src/components/community/CrewsTab.tsx` -- crew-lista
- `src/components/community/CrewCard.tsx` -- enskilt crew-kort
- `src/components/community/CrewDetailView.tsx` -- fullstandig crew-vy
- `src/components/community/CrewBadge.tsx` -- visuellt emblem
- `src/components/community/CreateCrewModal.tsx` -- skapa ny crew

### Andrade filer
- `src/pages/CommunityPage.tsx` -- lagg till "crews"-tab
- `src/components/community/CommunityNav.tsx` -- fjarde flik
- `src/components/community/ProfileTab.tsx` -- visa crew-koppling
- `src/components/community/LeaderboardTab.tsx` -- crew-rankinglista
- `src/App.tsx` -- route for crew-detalj (hanteras inuti CommunityPage)

### Databasmigrering
- Skapa tabellerna `crews`, `crew_members`, `crew_challenges` med RLS
- Databasvy `crew_scores` som beraknar summan av medlemmars rating per crew

### Designprinciper
- Gaming-inspirerat men med Picklas varma, rosa estetik
- Badges med emoji + farg istallet for bilduppladdning (enklare, snabbare)
- Touch-first, staggered animationer med framer-motion
- Crew-korten har en tydlig visuell hierarki: badge, namn, stats, CTA

