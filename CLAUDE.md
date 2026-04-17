# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Key Features Built

### Booking System
- `access_code` (4-digit, unique per venue per calendar day) generated on booking creation, stored on `bookings` table. Displayed on `BookingConfirmation.tsx`.
- `stripe_session_id` on `bookings` and `day_passes` for idempotent webhook processing.
- Stripe Checkout flow: `POST api-bookings/create-checkout` → Stripe-hosted page → `api-stripe-webhook` creates booking → `BookingConfirmed.tsx` polls `GET api-bookings/by-session` → redirect to `/b/:ref`.
- Free/corporate bookings bypass Stripe and use `public-book` directly.

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

## Infrastructure

- **Supabase project**: `pickla-base` — project ref `cqnjpudmsreubgviqptg`
- **Frontend**: Vercel, live at `playpickla.com`, auto-deploys on every `git push` to `main`
- **Email**: Resend — `playpickla.com` verified, SMTP configured in Supabase Auth
- **Auth**: Supabase Auth with HS256 Standby Key (ECC/ES256 revoked). Site URL: `https://playpickla.com`, redirect URL: `https://playpickla.com/auth/callback`

## Workflow

**Division of labour:**
- **Lovable**: design, visual changes, UI components
- **Claude Code**: logic, Edge Functions, database migrations

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

## Pending Deployment (as of 2026-04-17)

Migrations to run in Supabase SQL editor (in order), then `NOTIFY pgrst, 'reload schema'`:
1. `20260417100000_fix-rls-corporate-accounts.sql`
2. `20260417110000_fix-rls-venue-checkins.sql`
3. `20260417120000_stripe-customer-id.sql`
4. `20260417130000_entitlements.sql`
5. `20260417140000_push-subscriptions.sql`
6. `20260417150000_hub-chat.sql`

Edge Functions to deploy:
```bash
supabase functions deploy api-memberships api-bookings api-day-passes api-stripe api-notifications --no-verify-jwt --project-ref cqnjpudmsreubgviqptg
```

VAPID keys (one-time):
```bash
npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... --project-ref cqnjpudmsreubgviqptg
```

## Next Up
- Design-uppdatering av hela appen
- Membership visas på /my (webhook skapar korrekt, men query i MyPage kan behöva verifieras)
- `access_code` on `day_passes` (shown to customer after purchase)
- SMS to customer on day pass purchase
- `/display/dart/:court_id` — dart kiosk webapp
- Group purchase — multiple codes in one checkout
