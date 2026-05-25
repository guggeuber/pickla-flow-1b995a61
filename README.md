# Pickla

Pickla is a social sports operating system for venue bookings, memberships, events, desk operations, displays, scoring, and player community.

The canonical agent guide is [AGENTS.md](./AGENTS.md).

## Commands

```bash
npm run dev          # Start local dev server
npm run build        # Production build
npm run test         # Run Vitest once
npm run lint         # Full ESLint check; currently has legacy repo-wide debt
npm run ops:agent    # Print production ops/deploy checklist
npm run prod:check   # Release gate: tests + production build
```

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS + shadcn/ui + Radix UI
- TanStack React Query
- Supabase PostgreSQL/Auth/Realtime/Edge Functions
- Stripe Checkout/Billing
- Resend email

## Production Readiness

Soft-launch readiness is tracked in [docs/production-readiness.md](./docs/production-readiness.md).

Core runbooks:

- [Launch runbook](./docs/launch-runbook.md)
- [Stage setup](./docs/staging.md)
- [Smoke tests](./docs/smoke-tests.md)
- [Daily operations](./docs/daily-operations-runbook.md)
- [Observability and Ops Agent](./docs/observability-and-ops-agent.md)
- [Data and compliance](./docs/data-and-compliance.md)
- [Security checklist](./docs/security-checklist.md)
- [Support runbook](./docs/support-runbook.md)

Before a production candidate:

```bash
npm run prod:check
npm run ops:agent -- --mode=deploy
```

## Deploy

Frontend deploys from Vercel when `main` is pushed.

Supabase migrations are applied manually in the Supabase SQL editor, followed by:

```sql
NOTIFY pgrst, 'reload schema';
```

Supabase Edge Functions are deployed manually:

```bash
supabase functions deploy <function-name> --no-verify-jwt --project-ref cqnjpudmsreubgviqptg
```

See [docs/launch-runbook.md](./docs/launch-runbook.md) for the full deploy and rollback checklist.

## Environment

Local development requires a `.env` file:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_PROJECT_ID=...
```

Production and stage must use separate Supabase, Stripe, Resend, and VAPID secrets.
