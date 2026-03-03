

## Visa Community direkt -- Stories-karusell + Feed-preview

Användaren vill att Picklas community-känsla ska synas direkt -- inte gömmas bakom en länk. Bilden visar Instagram Stories-liknande vertikala kort med foton från anläggningen. Planen är att bygga ut detta i tre delar:

### 1. Ny tabell: `community_stories`
En enkel stories-tabell för kortlivat visuellt innehåll (foton/bilder) som personal eller admins laddar upp via Supabase Storage.

Kolumner: `id`, `venue_id`, `image_url` (text), `caption` (text, nullable), `created_at`, `expires_at` (auto 24h), `created_by` (uuid).

RLS: Alla kan läsa, bara autentiserade staff/admins kan skapa.

### 2. Stories-karusell på LinkHub (förstasidan)
Horisontellt scrollbar rad med vertikala kort högst upp på `/links`-sidan, likt Instagram Stories:
- Varje kort: vertikal bild med Pickla-logotyp + text-overlay (plats, datum)
- Rounded corners, liten skugga, 3:4 aspect ratio
- Klick öppnar bilden i en fullskärms-overlay med swipe mellan stories
- Om inga stories finns visas inget (graceful fallback)
- Hämtar från `community_stories` WHERE `expires_at > now()`

### 3. Community Feed-preview på LinkHub
Under stories-karusellen, visa de 3 senaste community_feed-posterna (träningar, matcher, clashes) med kompakt layout och "Se mer →"-knapp som navigerar till `/community`.

### 4. Community Feed-preview på Index (desk-sidan)
Liten sektion i TodayScreen eller som separat widget som visar senaste community-aktiviteten för personalen att se engagement.

### Teknisk sammanfattning

```text
┌─────────────────────────────┐
│  LinkHub (/links)           │
│                             │
│  [Stories ○ ○ ○ ○ ○ ] ←scroll
│                             │
│  [Boka] [Dagspass] [Events] │
│                             │
│  ── Community ──            │
│  [FeedCard compact]         │
│  [FeedCard compact]         │
│  [FeedCard compact]         │
│  [Se mer →]                 │
│                             │
│  ── Länkar ──               │
│  ...existing links...       │
└─────────────────────────────┘
```

**Nya filer:**
- Migration: `community_stories` tabell + Storage bucket
- `src/components/community/StoriesCarousel.tsx` -- horisontell karusell
- `src/components/community/StoryViewer.tsx` -- fullskärms story-overlay
- `src/components/community/FeedPreview.tsx` -- kompakt feed-preview med 3 items

**Ändrade filer:**
- `src/pages/LinkHub.tsx` -- lägg till StoriesCarousel + FeedPreview
- `src/screens/TodayScreen.tsx` -- lägg till en kompakt community-widget (valfritt)

Stories kan sedan laddas upp via admin-panelen eller direkt i databasen till att börja med. Bilderna lagras i Supabase Storage (`community-stories` bucket).

