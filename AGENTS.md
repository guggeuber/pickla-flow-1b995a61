# AGENTS.md

This file is the canonical agent guide for this repository. `CLAUDE.md` intentionally points here so Codex, Claude, and other coding agents share one source of truth.

## Project Overview

**Pickla** is a multi-venue pickleball platform — court booking, events, memberships, and community features. It's a B2B2C SPA: venues manage operations via an admin dashboard and desk interface; players book courts, join events, and connect socially.

## Commands

```bash
npm run dev          # Start dev server on port 8080
npm run build        # Production build
npm run lint         # ESLint check
npm run test         # Run tests once (Vitest)
npm run test:watch   # Run tests in watch mode
```

Single test file: `npx vitest run src/test/example.test.ts`

## Architecture

### Stack
- **Frontend**: React 18 + TypeScript + Vite, shadcn/ui + Radix UI, Tailwind CSS, TanStack React Query, React Hook Form + Zod
- **Backend**: Supabase (PostgreSQL, Auth, Realtime) + Deno Edge Functions
- **Key libs**: Framer Motion, Recharts, date-fns, html5-qrcode, Luxon (timezone handling)

### Directory Structure
```
src/
├── pages/          # Route-level components (one per major user flow)
├── screens/        # Desk operation tab screens (Today, Book, Sales, Ops, Customers)
├── components/
│   ├── ui/         # shadcn/ui primitives
│   ├── admin/      # Venue admin sub-sections
│   ├── community/  # Social/crew features
│   ├── desk/       # QR scanner, desk-specific widgets
│   └── my/         # Player profile components
├── hooks/          # Custom hooks (data fetching lives here, not in components)
├── lib/
│   ├── api.ts      # apiGet/apiPost/apiPatch/apiDelete — all Edge Function calls go through here
│   └── utils.ts
└── integrations/supabase/
    ├── client.ts   # Supabase JS client
    └── types.ts    # Auto-generated DB types
supabase/
├── functions/      # Deno Edge Functions (one directory per API resource)
│   └── _shared/    # cors.ts, auth.ts, bookings.ts (shared helpers)
└── migrations/     # SQL migration files
```

### Data Flow
All server state goes through **React Query** (`useQuery`/`useMutation`) → `apiGet`/`apiPost`/etc. in `src/lib/api.ts` → Supabase Edge Functions → PostgreSQL. Direct Supabase client calls are reserved for auth and realtime subscriptions.

### Auth
`useAuth()` context (in `src/hooks/useAuth.tsx`) wraps the entire app. Protected routes use the `<ProtectedRoute>` component. Roles are stored in the `user_roles` and `venue_staff` DB tables.

### Edge Functions
Located in `supabase/functions/`, each function handles one API domain: `api-admin`, `api-bookings`, `api-events`, `api-checkins`, `api-day-passes`, `api-matches`, `api-memberships`, `api-customers`, `api-corporate`, `api-stripe-webhook`, `api-stripe`, `api-notifications`. Shared utilities are in `_shared/`:
- `cors.ts` — CORS headers + `jsonResponse`/`errorResponse`
- `auth.ts` — `getAuthenticatedClient(req)` / `getServiceClient()`
- `bookings.ts` — `generateAccessCode()` / `getOrCreatePublicBookingUserId()`

**All** functions must be deployed with `--no-verify-jwt` (JWT is HS256 Standby Key; ECC revoked). Auth is handled manually in each function via `getAuthenticatedClient(req)` which calls `client.auth.getUser(token)` with the explicit token — this forces an HTTP call to `/auth/v1/user` and works regardless of algorithm.

### Design System
Tailwind dark mode (default). Custom CSS variables in `index.css`:
- **Pickla colors: dark navy primary, pink/blush accent, red accent, white text. Do NOT use orange.**
- Court status: `--court-free`, `--court-active`, `--court-soon`, `--court-vip`
- Surface layers 1–3 for visual depth
- Fonts: Space Grotesk (headings), Inter (body), Space Mono (admin/code)

Path alias: `@/` maps to `src/`.

### Multi-tenancy
All data is scoped to a `venue_id`. The admin flow always works within the context of a selected venue.

### Timezone
All timestamps are stored as UTC in the database. Always use **Luxon** (`DateTime` from `"luxon"`) for timezone-aware display and conversion:
- Display: `DateTime.fromISO(utcStr, { zone: 'utc' }).setZone('Europe/Stockholm').toFormat('HH:mm')`
- Input → UTC: `DateTime.fromISO(`${date}T${time}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()`
- Today's date: `DateTime.now().setZone('Europe/Stockholm').toISODate()`

Never use `new Date().toLocaleTimeString()` or append `Z` to user-entered times.

For Edge Functions that need “the venue day”, use `stockholmDateRangeUtc(date)` from `supabase/functions/_shared/bookings.ts` instead of building `${date}T00:00:00.000Z`. The input `date` is a Stockholm calendar date; the returned range is UTC for querying `timestamptz` columns.

## Key Features Built

### Booking System
- `access_code` (4-digit, unique per venue per calendar day) generated on booking creation, stored on `bookings` table. Displayed on `BookingConfirmation.tsx`.
- `stripe_session_id` on `bookings` and `day_passes` for idempotent webhook processing.
- Stripe Checkout flow: `POST api-bookings/create-checkout` → Stripe-hosted page → `api-stripe-webhook` creates booking → `BookingConfirmed.tsx` polls `GET api-bookings/by-session` → redirect to `/b/:ref`.
- Free/corporate bookings bypass Stripe and use `public-book` directly.
- Court booking conflict checks must happen before Stripe checkout is created and again defensively in the Stripe webhook. A paid booking must never silently double-book a court.
- After booking confirmation, users should land in the booking chat (`/hub?room=<room_id>` style flow via HubPage helpers), not a dead-end confirmation page.
- Multi-court bookings keep one booking row per court for availability/occupancy, but are treated as one customer booking:
  - Stripe multi-court sessions use unique `(stripe_session_id, venue_court_id)` instead of one row per session.
  - Rows from the same Stripe session share one `access_code`.
  - Booking chat rooms use grouped resource keys (`stripe_session:<id>` or direct booking group keys) so booking several dart boards at the same time opens one chat, not one chat per board.

### Operations Screen (`/display/venue?v=slug`)
- No-auth kiosk page showing all courts grouped by sport type in realtime.
- Supabase Realtime subscriptions on `bookings` and `venue_checkins`.
- Layout: always 2 sub-columns for pickleball (B1–B4 | B5–B8), auto-split for other sports.
- TV-optimised: `h-screen` → `flex-1 min-h-0` → `h-full grid [gridTemplateRows: repeat(N, 1fr)]` — no scroll.
- `showAll=true` query param on `public-courts` skips the `is_available` filter.

### Self-service Check-in
- `POST api-checkins/code` — kiosk endpoint, no auth, validates `access_code` against active bookings.
- Time-window validation (Luxon, Stockholm tz): same day, ≤30 min before start, not after end.
- `session_date` stored as Stockholm date, not UTC.
- Check-ins are idempotent: retrying the same booking code or desk scan should return/reuse the active check-in rows rather than creating duplicate live counts.

### Open Play
- `open_play_sessions` table: recurring slots with `day_of_week[]`, `court_ids[]`, `price_sek`.
- Seed: "Open Play" (mon–thu + sat–sun, 165 kr), "Fredagsklubben" (fri, 99 kr).
- `/openplay` (`OpenPlayPage.tsx`): upcoming 7-day slots, Stripe checkout per slot.
- `/display/openplay?v=slug` (`OpenPlayDisplay.tsx`): kiosk tablet, 4-digit touch input, `POST api-checkins/code`, B5–B8 status strip, 60s idle reset.

### Stripe Payment Flow
- `POST api-bookings/create-checkout` handles `court_booking`, `day_pass`, `membership`.
  - `day_pass`/`court_booking`: `mode:'payment'`; success → `/booking/confirmed?type=day_pass&session=...`
  - `membership`: `mode:'subscription'`, `recurring:{interval:'month'}`; success → `/membership/confirmed?session=...`
  - Success URL uses `&session=` when path already contains `?` (avoids double-`?` bug).
- `api-stripe-webhook` `resolveUserId(session, metaUserId, serviceClient)`: (1) metadata `user_id`, (2) `auth.admin.getUserByEmail(email)`, (3) `auth.admin.createUser({email, email_confirm:true})`, (4) guest fallback.
- `BookingConfirmed.tsx`: `?type=day_pass` shows success immediately, redirects `/my` after 3s (no polling).
- `MembershipConfirmed.tsx` at `/membership/confirmed`: success page → `/my`.
- Membership idempotency: `memberships.notes = 'stripe_session:<id>'`.
- After `signUp()`, call `supabase.auth.getUser()` directly — `useAuth` React state lags behind.

### Stripe Saved Cards (`api-stripe`)
- `player_profiles.stripe_customer_id` stores Stripe Customer ID (migration `20260417120000`).
- `POST api-stripe/setup-session` — Checkout in `setup` mode, returns hosted URL to save a card.
- `GET api-stripe/payment-methods` — lists saved cards (brand, last4, exp).
- `DELETE api-stripe/payment-method?pmId=X` — detaches after verifying customer ownership.
- `WalletSection` in `MyPage.tsx` renders saved cards and links to add new ones.

### Membership Entitlements (migration `20260417130000`)
- `membership_entitlements`: per-tier rules — `entitlement_type`, `value`, `period` (week/month).
  - Types: `court_hours_per_week`, `open_play_unlimited`, `free_day_pass_monthly`, `court_discount_pct`, `day_pass_discount_pct`.
- `membership_usage`: tracks consumed value per user/venue/type/period.
- `POST api-bookings/create-checkout` checks active membership entitlements before creating a Stripe session:
  - Discount types reduce `finalAmountSek` by percentage.
  - Quota types (court hours, free day pass) set `finalAmountSek = 0` if within limit — bypasses Stripe entirely, creates booking/day-pass directly, returns `{ free: true, redirect: "..." }`.
  - Frontend (`BookingPage.tsx`) handles `result.free` with toast + navigate.

### PWA + Web Push
- `vite-plugin-pwa` in `vite.config.ts`: manifest with existing `pwa-192x192.png`/`pwa-512x512.png`, Workbox NetworkFirst for Supabase function URLs.
- `push_subscriptions` table (migration `20260417140000`): endpoint, p256dh, auth per user/venue.
- `src/lib/push.ts`: `subscribeToPush(venueId?)` / `unsubscribeFromPush()`.
- `api-notifications`: `POST /subscribe`, `DELETE /subscribe`, `GET /vapid-key`, `POST /send` (staff-only, VAPID JWT signing in Deno).
- `SettingsSection` in `MyPage.tsx`: shows notification permission state — granted (green, non-interactive), denied (red, instructions), default (clickable activate button).
- **VAPID keys must be generated and set as Supabase secrets**: `npx web-push generate-vapid-keys` → `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.

### Pickla Hub (`/hub`)
- Replaces old chat tab in bottom nav. Route: `/hub` → `HubPage`, `/hub/admin` → `AdminPage` (ProtectedRoute).
- **DB** (migration `20260417150000`): drops old `chat_channels`/`chat_messages` (channel_id schema), creates:
  - `chat_rooms`: `room_type` (daily|booking|event|ritual), `venue_id`, `session_date`, partial unique index for one daily room per venue per day.
  - `chat_messages`: `room_id`, `user_id`, `message_type` (text|bot|action_card|booking_card), `metadata JSONB`.
  - `chat_participants`: join table, unique per room+user.
  - Trigger `fn_bump_room_updated_at` bumps `chat_rooms.updated_at` on each new message.
  - `chat_messages` added to `supabase_realtime` publication.
- **Components** in `src/components/hub/`:
  - `ChannelCard` — emoji badge, LIVE indicator, unread badge, overlapping participant dots.
  - `ActionCard` — navy card with segmented spots progress bar, red CTA button.
  - `BotMessage` — 🤖 avatar, "PICKLA BOT" label, off-white bubble.
- **HubPage** (`src/pages/HubPage.tsx`): channel list + slide-in ChatRoom (AnimatePresence, spring x: 100%→0).
  - Daily room: upserted on load via `onConflict: "venue_id,session_date"`; bot content rendered synthetically from live DB data (free courts, next open play).
  - Booking/event rooms: upserted on tap (not pre-created).
  - Realtime: `postgres_changes` subscription on `chat_messages` per room with cleanup.

### Venue Courts
- 19 dart tables seeded in `venue_courts` with `sport_type = 'dart'`.
- Seed also covers: venue row, 8 pickleball courts, opening hours, `open_play_sessions`, and `membership_tiers`.

### Admin Event Planning
- Admin events live in `src/components/admin/AdminEvents.tsx` and use `api-events`.
- The admin event module is now an operations planning tool, not only public events:
  - `Pipeline` view: stages `inquiry`, `tentative`, `booked`, `ready`, `published`, `done`, `cancelled`.
  - `Kalender` view: grouped by month with default upcoming filter.
  - `Möte` view: clean partner/employee-facing overview for upcoming activations.
- Event time filters are `Framåt`, `Alla`, and `Arkiv`. `Framåt` is default so old events like previous open plays do not dominate meeting views.
- Event planning metadata is stored on `events`: `planning_status`, `visibility`, `customer_name`, `customer_email`, `customer_phone`, `expected_participants`, `owner_name`, `partner_notes`, `internal_notes`, `resources`, `staffing`.
- `resources` are lightweight text tags for now (for example `Hela darten`, `Hela hallen`, `Lounge`, `Restaurang`, `Scen`, `Bar`). They are deliberately not real bookable resources yet; courts remain the only first-class inventory resource.
- `staffing` is free text for now. There is no separate staff scheduling table yet.
- Public/partner meeting share:
  - Admin `Möte` tab has a `Dela` action.
  - `POST api-events/meeting-link` creates or reuses `venues.event_plan_share_token`.
  - Public route `/event-plan/:venueId?token=...` renders `EventPlanPublic.tsx`.
  - Public plan endpoint `GET api-events/public-plan?venueId&token` is no-auth, validates the venue token with service role, and only returns future/non-archived events where `visibility` is `partners` or `public`.
  - Internal notes are never returned in the public plan.
  - The admin UI always shows the generated link after sharing; mobile Safari can reject async clipboard writes, so copying is best-effort only.

## Infrastructure

- **Supabase project**: `pickla-base` — project ref `cqnjpudmsreubgviqptg`
- **Frontend**: Vercel, live at `playpickla.com`, auto-deploys on every `git push` to `main`
- **Email**: Resend — `playpickla.com` verified, SMTP configured in Supabase Auth
- **Auth**: Supabase Auth with HS256 Standby Key (ECC/ES256 revoked). Site URL: `https://playpickla.com`, redirect URL: `https://playpickla.com/auth/callback`

## Workflow

**Division of labour:**
- **Lovable**: design, visual changes, UI components
- **Coding agents (Codex/Claude/etc.)**: logic, Edge Functions, database migrations, and focused UI fixes when needed

**Deploy process:**
- Frontend: `git push` → Vercel deploys automatically (no Lovable step needed)
- Edge Functions: `supabase functions deploy --no-verify-jwt --project-ref cqnjpudmsreubgviqptg`
- Migrations: run manually in the Supabase SQL editor, then run `NOTIFY pgrst, 'reload schema'` to flush PostgREST cache
- Stripe webhook URL: `https://cqnjpudmsreubgviqptg.supabase.co/functions/v1/api-stripe-webhook`

**Git:** `git pull --rebase` before pushing if Lovable has made changes.

## Environment

Requires a `.env` file with:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_PROJECT_ID=...
```

Supabase secrets required: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.

## Known Pitfalls

- **PostgREST FK embeds + schema cache**: Running migrations via the SQL editor does NOT flush PostgREST's schema cache. If embedded resource queries (`table(col)`) return 500, run `NOTIFY pgrst, 'reload schema'` in the SQL editor, or replace embeds with flat queries merged client-side (see `AdminCorporate.tsx`).
- **Rules of Hooks**: Never place a `useMemo`/`useCallback`/`useState` after an early return. Move all hooks before any `if (isLoading) return` (see `AdminCourts.tsx` — `groupedCourts` useMemo was after early return and caused React error #310).
- **Edge Function JWT**: `getUser()` without args reads internal session (empty in Deno) and always fails. Always pass token explicitly: `client.auth.getUser(token)` where `token = authHeader.slice('Bearer '.length)`.
- **Stripe success URL**: When `successPath` already contains `?`, use `&session=` not `?session=` to avoid double-`?`.
- **signUp() async state**: After `supabase.auth.signUp()`, `useAuth().user` is still null. Call `supabase.auth.getUser()` directly to get the fresh user ID before continuing.
- **Hub daily room upsert**: `onConflict` on `"venue_id,session_date"` requires a partial unique index (`WHERE room_type = 'daily'`). If upsert errors, HubPage falls back to a plain `.select()` fetch.
- **Old chat schema**: Pre-hub migrations created `chat_channels` (with `channel_id`/`sender_profile_id`). Migration `20260417150000` drops these and recreates with `room_id`/`user_id`. Do not reference the old column names.

## Session 2026-04-18 to 2026-04-20

### Pickla Hub
- `/hub` route replaces chat in bottom nav. Shared `PlayerNav` component: Live → /hub, Boka → /book, Mig → /my (used in HubPage, MyPage, BookingPage, LinkHub)
- DB tables: `chat_rooms` (room_type: daily|booking|event|ritual), `chat_messages`, `chat_participants`, `chat_reactions`
- Realtime via Supabase `postgres_changes` on `chat_messages` and `chat_reactions` per room
- Channel list preview shows sender avatar + "🎬 GIF" / "📷 Bild" for media messages

### Hub features
- GIF picker via Giphy API — requires `VITE_GIPHY_API_KEY` in Vercel env
- Image upload to Supabase Storage bucket `chat-images`
- Emoji reactions: `chat_reactions` table, toggle on/off, rendered absolute at bubble bottom edge (iMessage style)
- Long-press context menu: Reply, Copy, Delete (soft delete — sets `content = null`, `is_deleted = true`)
- Share/invite: generates `/hub?join=<room_id>` link; recipient lands on HubPage which calls `join_chat_room` RPC

### Hub bugs fixed
- **RLS infinite recursion** on `chat_rooms` UPDATE policy — fixed by rewriting policy without self-referencing subquery
- **Upsert via REST fails with partial index** — `onConflict: "venue_id,session_date"` not supported via REST for partial unique indexes. Fixed with SECURITY DEFINER RPCs: `upsert_daily_chat_room(venue_id, session_date, name)` and `upsert_resource_chat_room(venue_id, resource_id, room_type, name)`
- **`chat_participants` always empty** — `join_chat_room` was only called via invite link. Fixed: `onSelectRoom` in HubPage now always calls `join_chat_room` RPC before opening a room
- **`venue_id` null on push_subscriptions** — `subscribeToPush()` was called without `venueId`. Fixed: `SettingsSection` in MyPage now fetches venue by slug and passes ID to `subscribeToPush(venueId)`
- **Double close on swipe-to-dismiss** — drag handler called `history.back()` which triggered the `popstate` listener a second time. Fixed: removed `history.back()` from drag handler; `popstate` listener alone handles history cleanup
- **iOS haptics silent** — `AudioContext` was closed synchronously before oscillator finished. Fixed: close via `osc.onended` callback; added `webkitAudioContext` fallback; `ctx.resume()` for suspended state

### PWA native-feel (8 fixes applied)
- `-webkit-overflow-scrolling: touch` + `overscroll-behavior: contain` on all scroll containers
- `whileTap={{ scale: 0.97 }}` on all interactive surfaces in hub
- `visualViewport` resize listener for keyboard push-up on iOS — applied as `paddingBottom` on container (not height shrink, which caused header jump)
- Swipe-to-dismiss ChatRoom overlay: `drag="x"`, threshold 80px, `dragElastic={0}`, `dragMomentum={false}`
- Fonts consolidated: Space Grotesk (labels/headings), Inter (body/timestamps) — Space Mono completely removed from hub components
- `overscroll-behavior: none` on `html` and `body` in `index.css`
- Haptics: `AudioContext` oscillator (2ms, gain 0.01) on iOS; `navigator.vibrate(10)` on Android
- Skeleton loaders replace `Loader2` spinners in HubPage channel list and ChatRoom

### Push notifications
- VAPID private key: `web-push` generates raw base64url scalar — imported via `jose importJWK` using `{kty:'EC', crv:'P-256', d, x, y}` (x/y extracted from public key bytes 1-32 and 33-64). PKCS#8 wrapping does not work in Deno.
- Uses `web-push` npm library (`https://esm.sh/web-push@3.6.7`) for RFC 8291 payload encryption, correct `Content-Encoding: aes128gcm`, and VAPID JWT auth
- Apple-specific headers added only for `web.push.apple.com` endpoints: `apns-push-type: alert`, `apns-priority: 10`, `apns-expiration: 0`
- Payload format for all endpoints: `{ aps: { alert: { title, body }, sound: "default", badge: 1 }, url }`
- Custom service worker `src/sw.ts` (injectManifest strategy) handles `push` event (calls `showNotification`) and `notificationclick` event (focuses or opens window, navigates to `data.url`). Without the push handler the notification never appears even if APNs returns 201.
- `POST api-notifications/chat-message` sends push to all `chat_participants` in room except sender. No `venue_id` filter — queries by `user_id` array.
- `POST api-notifications/test-push` — no auth required, takes `{user_id}`, sends test push to all their subscriptions, returns per-endpoint `{ok, status, body}` for debugging
- iOS PWA: must be installed via Safari Add to Home Screen; requires iOS 16.4+

### Auth fixes
- **`AuthCallback.tsx` never confirmed users** — page showed success screen and redirected without calling any Supabase API. The `?code=` token was silently discarded. Fixed: `exchangeCodeForSession(window.location.href)` now called on mount.
- **`emailRedirectTo` pointed to root** — `signUp()` used `window.location.origin` which sent confirmation link to `https://www.playpickla.com/` (LinkHub). Fixed: now `${window.location.origin}/auth/callback`.
- **Two unconfirmed users** manually confirmed via `UPDATE auth.users SET email_confirmed_at = now()` (jonaswallenman, magnus.ehntorp)
- Added forgot password flow: "Glömt lösenord?" link on login → email input → `resetPasswordForEmail(email, { redirectTo: 'https://playpickla.com/auth/reset' })` → `/auth/reset` page handles `PASSWORD_RECOVERY` event → `updateUser({ password })` → redirect to `/my`

### PWA manifest (Android install)
- Removed `display_override: ["window-controls-overlay"]` — desktop-only feature blocked Android Chrome install
- Removed `screenshots` array — 512×512 image is below Chrome's minimum (1280px); undersized screenshots block install prompt on Chrome 119+
- Added `mobile-web-app-capable` meta tag alongside Apple variant
- Split icon entries: separate objects for `purpose: "any"` and `purpose: "maskable"` (combined `"any maskable"` is deprecated)
- Added `id: "/"` to manifest

### Migrations deployed (2026-04-18 to 2026-04-20, all applied)
- `20260418100000` — `upsert_daily_chat_room` RPC (SECURITY DEFINER)
- `20260418110000` — `upsert_resource_chat_room` RPC (SECURITY DEFINER)
- `20260418120000` — `join_chat_room` RPC + `chat_rooms` SELECT policy fix (participant access)
- `20260418130000` — `chat_reactions` table, RLS policies, realtime publication, reply + soft-delete columns on `chat_messages`

## Session 2026-05-07 to 2026-05-11

### Booking flow and booking chats
- Booking confirmation was clarified so the user is routed onward into the booking chat.
- Multi-court Stripe bookings were fixed at DB/function level:
  - `20260507120000_allow_multi_court_stripe_bookings.sql` changes Stripe idempotency from one booking per session to one booking per `(stripe_session_id, venue_court_id)`.
  - `20260507140000_shared_access_code_booking_groups.sql` makes multi-court rows share one `access_code` and updates `upsert_resource_chat_room` so existing booking rooms refresh title/subtitle.
- `api-bookings` creates one shared access code for a multi-court checkout session.
- Hub booking chat lookup supports both Stripe session grouped rooms and direct booking grouped rooms, so several courts at the same time should surface as one chat bubble.

### Event planning/admin hub
- Added admin event planning pipeline, calendar, and meeting views.
- Added event planning columns via:
  - `20260510120000_event_planning_pipeline.sql`
  - `20260510133000_event_resources_and_staffing.sql`
  - `20260510143000_event_plan_share_token.sql`
- Added partner/public plan sharing:
  - `api-events/meeting-link`
  - `api-events/public-plan`
  - `/event-plan/:venueId?token=...`
- The share link UI now displays the generated link after `Dela` and provides explicit `Kopiera` and `Öppna` controls because iOS/Safari may block clipboard calls after async API work.

### Deploy notes from this session
- Event planning migrations were applied manually in Supabase SQL editor.
- `api-events` was deployed after adding meeting-link/public-plan endpoints.
- Latest share-link UI fix is frontend-only; Vercel deploys from `main`.

## Session 2026-05-11

### Booking-to-desk architecture hardening
- Introduced `stockholmDateRangeUtc(date)` and routed booking/day queries through Stockholm calendar days instead of UTC-midnight string ranges.
- Updated desk hooks to use Stockholm “today” for bookings and revenue.
- Added pre-Stripe conflict checking for court bookings in `api-bookings/create-checkout`.
- Added defensive conflict checking in `api-stripe-webhook` before inserting court booking rows.
- Made booking-code check-in idempotent: repeated code entry reuses existing active `venue_checkins`.
- Made desk check-in idempotent for entitlement/user scans.
- Added migration `20260511120000_idempotent_venue_checkins.sql` to dedupe existing active duplicates and add partial unique indexes for active check-ins.

### Access resolver / check-in OS
- `api-checkins` now has a shared access resolver used by QR scan, customer search, and desk check-in.
- Resolver order: active booking in check-in window first, active membership second, today's active day pass third.
- Memberships are reusable access rights; every scan/check-in still creates or reuses a `venue_checkins` presence row for live occupancy/data.
- Day passes are valid only for `valid_date = today` in Europe/Stockholm; old active rows cannot be used on later dates because resolver never selects them.
- Desk/customer manual check-in with a known user auto-upgrades to the best valid entitlement when available, so staff check-ins still record the true access source.
- Repeated scans return `already_checked_in` with the active check-in row instead of creating duplicate presence.

### Access OS structural model
- Migration `20260511150000_access_os.sql` introduces the new canonical access model:
  - `activity_sessions`: dated or recurring activities such as Open Play FM, Open Play Kväll, group training, Pickla Open.
  - `session_registrations`: a user signed up for one concrete occurrence of an activity session.
  - `access_entitlements`: what a user is allowed to do (`day_access`, `session_ticket`, `membership_access`, `booking_access`).
  - `access_vouchers`: undated gift/credit objects that can later be claimed/redeemed into real access.
- Legacy `day_passes` still exists during transition, but new purchases also create `access_entitlements`, and activity purchases create `session_registrations`.
- Open Play page now reads `activity_sessions` instead of legacy `open_play_sessions`.
- Seeded initial activity sessions for Pickla Arena Stockholm: Open Play FM 10-12, Eftermiddag 14-16, Kväll 17-20, and Onsdag Gruppträning 18-19.

### Access products and membership pricing
- Migration `20260511160000_access_products.sql` introduces `access_products`, the product catalog above Access OS:
  - `day_access` = Day Pass/dagsmedlemskap.
  - `open_play_slot` = specific Open Play slot ticket.
  - `group_training` = training session ticket.
  - `group_training_day_access` = session plus same-day Open Play access.
  - `day_access_voucher` = undated gift/credit.
- Admin has a `Produkter` section for product catalog management.
- Membership tier pricing now uses product keys from `access_products`, so tiers can set fixed price or percent discount per product.
- `api-bookings/create-checkout` resolves day-pass/open-play pricing through `access_products.product_key` before falling back to session price.

### Activity program / schedule
- Migration `20260511170000_activity_series.sql` introduces `activity_series` and adds program fields to `activity_sessions`.
- Use `activity_series` for recurring programs or finite courses: Fredagsklubben, Pickla Open weekly, 10-week courses, recurring group training.
- Use `activity_sessions` for the actual schedule rows: weekday recurrence/date, time, capacity, price, product key, and access policy.
- Admin has a `Schema` section for creating programs and recurring schedule sessions.
- Ordinary recurring activities should live in Schema/Activity Sessions, not as heavy `events`. Use `events` for larger campaigns/productions/partner-facing planning that may contain or reference sessions.

## Session 2026-05-20

### Mobile app / booking UX
- Root route `/` now opens the lightweight Today surface instead of an older landing/home.
- Today/Book/Me direction was simplified around two core player surfaces:
  - Today = live venue/community feed with quick actions, hero image, and chronological schedule.
  - Book = focused booking flow for activities/resources, progressive decisions, no calendar-first UI.
- BookingPage was redesigned into a large airy booking card:
  - activity -> date -> period -> duration -> first available time/resource -> book.
  - fixed “Uber footer” was removed.
  - exact time/resource selection stays behind drawers/secondary actions.
- Public court availability supports `days=7` batch fetching, so switching dates reads from `availabilityByDate` instead of full reloads.
- Multi-resource booking was restored in the court/resource drawer; booking price sums selected resources and entitlement usage counts court-hours (`durationHours * resourceCount`).
- Added longer-date selection so users can jump beyond the first visible week.

### Purchase flow, receipts, and My page
- After normal paid/free court booking, logged-in customers land on `/my?booking=<ref>&v=<slug>` instead of directly in the booking chat.
- `/my?booking=...` opens the selected booking detail sheet; chat is now an explicit action from the detail view.
- Guest bookings can still use `/b/:ref`.
- Added Pickla receipt view with VAT/moms fields and fallback calculation for older bookings.
- Added `booking_receipts` snapshot model for new paid bookings, with one shared receipt for grouped/multi-resource bookings.
- Free/corporate/entitlement bookings must show `0 kr` receipts instead of fallback list-price totals.
- Wellness/friskvård direction: receipts are the base for future yearly wellness certificate export.

### Group booking inquiries
- `Boka event` now routes to `/book/group?v=<slug>`.
- `GroupBookingPage` is a public mobile inquiry form for company events, bachelor/bachelorette groups, birthdays, etc.
- Group inquiry creates an internal event lead in the existing admin event pipeline (`planning_status='inquiry'`, `visibility='internal'`, `is_public=false`).
- Group inquiries require email so Pickla can send confirmation and continue the conversation.
- Public group-booking copy/image/notes are venue-configurable from admin.

### Event/customer communication
- Event/inquiry chat in Hub remains internal staff chat.
- Added explicit customer email composer in inquiry/event rooms: “Skicka mail till kund”.
- Added `event_communications` for outbound/inbound email log.
- Added `api-event-public/customer-message` for staff-sent Resend emails.
- Added `api-event-public/email-webhook` for future Resend inbound replies mapped back to the same event thread.
- Group inquiry confirmation email uses an event-specific reply address/token so customer replies can be attached to the lead.

### Resource-based check-in and paddor
- Added resource station URLs:
  - `/display/resource/:courtId?v=<venue-slug>` for per-resource code check-in.
  - `/display/device/:token` for physical padda home screen.
- `api-checkins/code` accepts optional `resource_id`:
  - valid code on the right resource checks in the whole booking group.
  - valid code on the wrong resource returns expected resources and does not check in.
  - repeated code entry is idempotent and returns “already checked in”.
- `display_devices` table and admin section `Paddor` were added.
- `api-admin/display-devices` supports full CRUD:
  - create padda, rename, reassign resource, update external links/instructions, toggle active, rotate token, delete.
- `api-bookings/display-device` is the public no-auth token lookup for padda home screens and updates `last_seen_at`.
- Dart paddor always expose Nakka (`https://n01darts.com/n01/web/n01.html`) either from configured links or automatic fallback based on dart/tavla resource naming.
- Padda home was made deliberately static for older Lenovo/Chrome tablets:
  - no Framer Motion, no CSS transforms, no heavy shadows, no fixed clipped layout.
  - after successful resource check-in, station returns to `/display/device/:token`.
  - device home displays current booking state and “Redan incheckad” with customer-name fallback from booking notes.

### Admin/auth/deploy fixes
- Added explicit `vercel.json` so Vercel builds this Vite app with `npm ci`, `npm run build`, output `dist`, and SPA rewrite to `/index.html`.
- `useAdmin` query keys now include session user/access token and refetch on mount/focus, reducing stale admin access after login/logout on shared tablets.
- Recent edge deploys included `api-bookings`, `api-checkins`, `api-admin`, and event communication functions as their features changed.
- Supabase `.temp/*` files often change locally after CLI deploys; do not stage them unless explicitly intended.

## Next Up
- Design-uppdatering av hela appen
- Membership visas på /my (webhook skapar korrekt, men query i MyPage kan behöva verifieras)
- Real resource/staff planning model for events (separate resources like hall/lounge/stage/bar and staff assignments instead of lightweight text tags)
- Verify grouped multi-court booking UX end-to-end in production with Stripe webhook + Hub chat list
- Polish device/padda admin once real staff use it for a few days: search/filter, bulk-create for all dart boards, clearer kiosk setup checklist.
- Finish inbound Resend DNS/webhook production setup for event customer replies.
- Build friskvård yearly certificate export from receipt snapshots.
