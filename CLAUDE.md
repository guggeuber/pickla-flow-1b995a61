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
Located in `supabase/functions/`, each function handles one API domain: `api-admin`, `api-bookings`, `api-events`, `api-checkins`, `api-day-passes`, `api-matches`, `api-memberships`, `api-customers`, `api-corporate`, `api-stripe-webhook`. Shared utilities are in `_shared/`:
- `cors.ts` — CORS headers + `jsonResponse`/`errorResponse`
- `auth.ts` — `getAuthenticatedClient(req)` / `getServiceClient()`
- `bookings.ts` — `generateAccessCode()` / `getOrCreatePublicBookingUserId()`

`api-stripe-webhook` must be deployed with `--no-verify-jwt`.

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

### Venue Courts
- 19 dart tables seeded in `venue_courts` with `sport_type = 'dart'`.

## Workflow

**Division of labour:**
- **Lovable**: design, visual changes, UI components
- **Claude Code**: logic, Edge Functions, database migrations

**Deploy process:**
1. Claude Code makes changes → `git push`
2. Tell Lovable-chatten "Deploy edge functions" after each push
3. Supabase migrations run manually in the SQL editor
4. Stripe webhook URL: `https://qrzkxhnpxtsicqcpzplc.supabase.co/functions/v1/api-stripe-webhook`

**Git:** `git pull --rebase` before pushing if Lovable has made changes.

## Environment

Requires a `.env` file with:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_PROJECT_ID=...
```

Supabase secrets required: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

## Next Up
- `access_code` on `day_passes` (shown to customer after purchase)
- SMS to customer on day pass purchase
- `/display/dart/:court_id` — dart kiosk webapp
- Group purchase — multiple codes in one checkout
