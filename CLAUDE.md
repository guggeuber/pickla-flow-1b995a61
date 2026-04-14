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
- **Key libs**: Framer Motion, Recharts, date-fns, html5-qrcode

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
└── migrations/     # SQL migration files
```

### Data Flow
All server state goes through **React Query** (`useQuery`/`useMutation`) → `apiGet`/`apiPost`/etc. in `src/lib/api.ts` → Supabase Edge Functions → PostgreSQL. Direct Supabase client calls are reserved for auth and realtime subscriptions.

### Auth
`useAuth()` context (in `src/hooks/useAuth.tsx`) wraps the entire app. Protected routes use the `<ProtectedRoute>` component. Roles are stored in the `user_roles` and `venue_staff` DB tables.

### Edge Functions
Located in `supabase/functions/`, each function handles one API domain: `api-admin`, `api-bookings`, `api-events`, `api-checkins`, `api-day-passes`, `api-matches`, `api-memberships`, `api-customers`, `api-corporate`. Shared utilities (CORS, auth, response helpers) are in `_shared/`.

Each function calls `getAuthenticatedClient(req)` to get a user-scoped Supabase client.

### Design System
Tailwind dark mode (default). Custom CSS variables in `index.css`:
- `--primary`: burnt orange (#E86C24) — main action color
- Court status: `--court-free`, `--court-active`, `--court-soon`, `--court-vip`
- Surface layers 1–3 for visual depth
- Fonts: Space Grotesk (headings), Inter (body), Space Mono (admin/code)

Path alias: `@/` maps to `src/`.

### Multi-tenancy
All data is scoped to a `venue_id`. The admin flow always works within the context of a selected venue.

## Environment

Requires a `.env` file with:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_PROJECT_ID=...
```
