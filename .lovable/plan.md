

# Pickla Community Platform -- Fas 1: Community-flode

Visionen ar att omvandla Pickla fran ett venue-management-verktyg till en levande community-plattform for social sport -- dar spelare across alla hallar ser aktivitet, interagerar och klimbar i ranking. Fas 1 fokuserar pa de fyra grundpelarna: Community-flode, PWA app-kansla, Social interaktion och Leaderboards.

---

## Oversikt

```text
+---------------------------------------------------+
|                PICKLA PLATFORM                     |
|                                                    |
|  Spelar-app (LinkHub/MyPage)    Staff-app (Index)  |
|  +-----------------------+   +------------------+  |
|  | /community (NY)       |   | Today / Desk     |  |
|  | - Activity feed       |   | (befintlig)      |  |
|  | - Leaderboard         |   +------------------+  |
|  | - Personlig dashboard |                         |
|  | - Spelar-profiler     |                         |
|  +-----------------------+                         |
|                                                    |
|  PWA: Installbar, offline, splash screen           |
+---------------------------------------------------+
```

---

## 1. PWA-setup (app-kansla)

Installera `vite-plugin-pwa` och konfigurera i `vite.config.ts` med:
- App-manifest (namn: "Pickla", farger, ikoner)
- Service worker med offline-stod och caching av API-anrop
- `navigateFallbackDenylist: [/^\/~oauth/]`
- Skapa PWA-ikoner i `public/` (192x192, 512x512)
- Lagg till mobil-meta-taggar i `index.html` (theme-color, apple-mobile-web-app)

Resultat: Spelare kan installera appen pa hemskarm, den laddar snabbt och kanns som en riktig app.

---

## 2. Community Feed -- ny sida `/community`

Skapa en ny sida `src/pages/CommunityPage.tsx` med bottom-navigation for spelare (separat fran staff-appen) med flikarna:

```text
[ Feed ]  [ Ranking ]  [ Profil ]
```

### Feed-flode
- Visar aktivitet across alla hallar: matcher spelade, resultat, nya spelare, event-uppdateringar
- Ny databastabell `community_feed` med kolumner: `id`, `venue_id`, `player_id`, `event_type` (match_result, checkin, achievement, event_created), `content` (jsonb), `created_at`
- RLS: publikt lasbar, endast backend kan skriva (via trigger/edge function)
- Varje feed-kort visar: spelarnamn, hallnamn, typ av aktivitet, tidsstampel
- "Gilla"-funktion med hjartan (ateranvand `event_likes`-monster)

### Auto-genererade feed-poster
- Databastriggrar som skapar feed-poster nar: en match avslutas, en spelare checkar in, ett event skapas

---

## 3. Leaderboard & Ranking

### Global topplista
- Ny komponent `LeaderboardTab.tsx` som visar spelare sorterade pa `pickla_rating`
- Filtrera per hall (venue) eller visa globalt across alla hallar
- Visa topp-3 med speciell design (guld/silver/brons), resten som lista
- Anvander befintlig `player_profiles`-tabell (pickla_rating, total_wins, total_matches)

### Lokal hall-ranking
- Filtrera leaderboard pa venue via dropdown
- Visa "din position" for inloggad spelare

---

## 4. Utokad spelarprofil & personlig dashboard

Bygg ut `/my`-sidan med:
- **Utokad statistik**: Win-rate, matcher per vecka (sparkline), senaste 5 matcher
- **Favorit-hall**: Baserat pa `preferred_venue_id`
- **Achievement-badges**: Forsta matchen, 10 vinster, 100 matcher (beraknas client-side fran befintlig data)
- **Senaste aktivitet**: Mini-feed med spelarens egna aktiviteter

---

## 5. Social interaktion

- **Gilla feed-poster**: Hjart-ikon pa varje feed-kort, sparas i ny tabell `feed_likes`
- **Utmana spelare**: Fran leaderboard -- "Utmana" knapp som skapar en `ladder_challenge`
- **Dela resultat**: "Dela"-knapp pa matchresultat som kopierar en delbar lank

---

## Teknisk plan

### Nya databastabeller
1. `community_feed` -- for aktivitetsflode
2. `feed_likes` -- for gilla-markering pa feed-poster

### Nya filer
- `src/pages/CommunityPage.tsx` -- huvudsida med tabs
- `src/components/community/FeedTab.tsx` -- aktivitetsflodet
- `src/components/community/LeaderboardTab.tsx` -- topplista
- `src/components/community/ProfileTab.tsx` -- utokad profil
- `src/components/community/FeedCard.tsx` -- enskilt feed-kort
- `src/components/community/CommunityNav.tsx` -- bottom-nav for spelare

### Andrade filer
- `src/App.tsx` -- ny route `/community`
- `vite.config.ts` -- PWA-konfiguration
- `index.html` -- meta-taggar for PWA

### Edge function-andringar
- Utoka `api-matches` eller skapa trigger for att auto-posta till `community_feed` vid matchresultat

### Designprinciper
- Samma rosa/varma estetik som LinkHub for spelar-delen
- Mobile-first, touch-friendly, staggered framer-motion animationer
- Konsekvent typografi med Space Grotesk

