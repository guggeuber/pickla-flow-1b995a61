# Pickla

Pickla is a community-first racket sports platform and venue operating system.

The product is moving from a booking site into **Pickla OS**: one operational layer for venue managers, desk staff, event sales, member access, customer history, financial truth, and the public player experience.

This README is written for a new technical leader who needs the architecture truth quickly. The canonical coding-agent guide remains [AGENTS.md](./AGENTS.md).

## Vision

Pickla OS should answer the questions a venue asks all day:

- What is happening in the building now, today, and tomorrow?
- Who is arriving, what have they paid for, and do they have access?
- Which courts/resources are available, blocked, booked, or allocated to events?
- Which activities are public, hidden, cancelled, full, or affected by operations?
- What did we sell today, through which channel, and what evidence exists?
- Which event leads need action, and what safe recommendation should staff approve?

The product principles are:

- Venue operating system first, marketing site second.
- Community-first racket sports: activity, membership, social proof, chat, and repeat play matter as much as bookings.
- Human approval for operational decisions. Agents recommend; staff approves; the system executes.
- Source-of-truth data over dashboards. Every metric should be clickable or traceable.
- Multi-venue by design, scoped by `venue_id`.

## Architecture

### Frontend

- React 18, TypeScript, Vite.
- Tailwind CSS, shadcn/ui, Radix UI, Framer Motion.
- TanStack React Query for server state.
- React Router routes live in [src/App.tsx](./src/App.tsx).
- API calls go through [src/lib/api.ts](./src/lib/api.ts) to Supabase Edge Functions.
- Auth state lives in [src/hooks/useAuth.tsx](./src/hooks/useAuth.tsx).
- Timezone-sensitive UI should use Luxon and Europe/Stockholm.

Important surfaces:

- Public player app: `/`, `/today`, `/book`, `/openplay`, `/program/:sessionId`, `/my`, `/hub`.
- Desk OS: `/desk`.
- Admin OS: `/hub/admin`.
- Event lead operations: `/admin/event-leads`.
- Self check-in: `/checkin/:venueSlug`.
- Displays: `/display/venue`, `/display/openplay`, `/display/resource/:courtId`, `/display/device/:token`.

### Supabase

Supabase provides:

- PostgreSQL source-of-truth.
- Auth.
- Realtime subscriptions for live check-ins, bookings, chat, and display surfaces.
- Edge Functions for all server logic.
- Storage for generated PDFs/media where used.

All production data is scoped to venues. Staff permissions are enforced through `venue_staff`, `user_roles`, and service-role checks in Edge Functions.

### Edge Functions

Edge Functions are in [supabase/functions](./supabase/functions). They are Deno functions and are deployed with `--no-verify-jwt`; authentication is performed manually inside functions via `getAuthenticatedClient(req)` and Supabase Auth.

### Stripe

Stripe is used for:

- Court booking checkout.
- Activity/session registration checkout.
- Day pass checkout.
- Membership subscription checkout.
- Saved payment method setup.
- Webhook-finalized records, receipts, and ledger entries.

The webhook path is `api-stripe-webhook`. Webhook handling must remain idempotent.

### Zettle

Zettle Revenue MVP exists as a read/import integration:

- `zettle_connections` stores venue-level OAuth/API-key connection state.
- `zettle_purchases` stores imported purchases.
- `ledger_entries.source_type = 'zettle'` brings Zettle totals into Revenue Ledger.

Current scope is purchases only. Products, category mapping, settlements, and customer matching are not yet part of the MVP.

### Agent Architecture

Pickla has an early approve-first event operations agent. It is not a general autonomous framework yet.

Current agent behavior:

- Reads event lead, linked event, offer, schedule, resources, activity impact, opening hours, drift overrides, and resource blocks.
- Writes recommendations into `event_lead_activities` with `type = 'agent_recommendation'`.
- Admin sees recommendations in Agent Inbox and Event Lead.
- Staff can approve/reject/re-analyze.
- Approval can prepare safe internal drafts; it must not email, charge, refund, cancel activities, or confirm bookings automatically.

Key shared code:

- [supabase/functions/_shared/event_operations_agent.ts](./supabase/functions/_shared/event_operations_agent.ts)
- [supabase/functions/_shared/event_agents.ts](./supabase/functions/_shared/event_agents.ts)
- [supabase/functions/event-sales-agent/index.ts](./supabase/functions/event-sales-agent/index.ts)

## Core Systems

### Admin OS

Admin OS lives under `/hub/admin` and is wired in [src/pages/AdminPage.tsx](./src/pages/AdminPage.tsx).

It includes:

- Today overview.
- Calendar.
- Venue settings.
- Courts/resources.
- Schedule/activity sessions.
- Events and event leads.
- Venue operations/drift.
- Resource blocks.
- Products/pricing/memberships.
- Revenue Ledger.
- Staff/devices/links/content surfaces.

Admin OS is the strategic/operator view. Desk OS is the live arrival/action view.

### Desk OS

Desk OS lives at `/desk` in [src/pages/Index.tsx](./src/pages/Index.tsx).

Current direction: inline command cockpit, not passive dashboard.

It includes:

- Always-visible command bar for customer, booking code, receipt, phone, and booking search.
- Today actionable lists for arrivals, bookings, activity registrations, and check-ins.
- Operations suggestions for soon-starting bookings, pending payment, activity attendance gaps, stale check-ins, and unclear check-ins.
- Shared booking detail drawer.
- Shared Customer 360 drawer.
- Staff booking check-in.

### Operations Truth

Operations Truth is the shared read layer that makes operational objects visible across Calendar, Desk, and Admin Today.

It includes:

- Court bookings grouped by booking/session/access code.
- Activity sessions and registrations.
- Events.
- Venue operation overrides.
- Event/resource blocks.
- Check-in status.
- Payment/receipt evidence where available.

Important UI:

- [src/components/operations/OperationsBookingDrawer.tsx](./src/components/operations/OperationsBookingDrawer.tsx)
- [src/components/admin/shell/AdminCalendar.tsx](./src/components/admin/shell/AdminCalendar.tsx)
- [src/screens/TodayScreen.tsx](./src/screens/TodayScreen.tsx)
- [src/components/desk/shell/DeskToday.tsx](./src/components/desk/shell/DeskToday.tsx)

### Customer 360

Customer 360 is the staff view for one customer.

It shows:

- Name, email, phone.
- Membership/access status.
- Today access.
- Upcoming bookings.
- Activity registrations.
- Day passes.
- Memberships.
- Check-ins.
- Receipts and ledger evidence.
- Safe existing actions.

Entry points:

- Admin People/Customers.
- Desk command bar.
- Desk arrivals/check-ins.
- Operations booking drawer.
- Revenue Ledger rows when a user is known.

Main component: [src/components/customers/Customer360Drawer.tsx](./src/components/customers/Customer360Drawer.tsx).

### Self Check-in

Self check-in is customer-led venue entry.

Flow:

1. Customer scans a permanent venue QR, for example `/checkin/solna`.
2. If logged out, they log in/sign up and resume.
3. `api-checkins/self` resolves valid access.
4. Access can come from booking, activity registration, day pass, or membership.
5. A `venue_checkins` row is created/reused.
6. Desk sees the arrival.
7. If no access exists, the UI shows purchase options.

Staff-led check-in still exists for booking drawers and desk operations.

### Revenue Ledger

Revenue Ledger is the daily sales truth layer.

Current table: `ledger_entries`.

Properties:

- Append-only: updates/deletes are blocked by trigger.
- Idempotent by `(source_type, source_id)` and Stripe session where present.
- Stores venue, source, accounting date, occurred time, customer name, amount including VAT, VAT amount, payment status/method, Stripe session, receipt number, booking receipt, and metadata.

Current sources:

- Court bookings.
- Activity registrations.
- Day passes.
- Memberships.
- Zettle purchases.

Admin view: [src/components/admin/AdminRevenueLedger.tsx](./src/components/admin/AdminRevenueLedger.tsx).

### Event OS

Event OS covers B2B/private events from lead to offer to confirmed capacity.

Current chain:

1. Event lead is created by intake/public event flow.
2. Staff can edit operational schedule on linked `events`.
3. Agent can recommend package, schedule, resources, and risk.
4. Staff can approve a recommendation to prepare an internal offer draft.
5. Offers/PDF/email drafts can be generated.
6. Confirm booking is explicit.
7. Confirmed event resource allocations create `event_resource_blocks`.
8. Public booking availability respects those resource blocks.
9. Affected activities require explicit staff hide/cancel decisions through `activity_session_overrides`.

Important tables:

- `event_leads`
- `events`
- `event_offers`
- `event_lead_activities`
- `event_resource_catalog`
- `event_resource_allocations`
- `event_courts`
- `event_resource_blocks`

### Agent Inbox

Agent Inbox is the Today/Admin surface for agent recommendations.

Storage:

- `event_lead_activities.type = 'agent_recommendation'`
- JSON payload includes summary, risk, capacity status, conflicts, affected activities, and next action.

Phase 1 behavior:

- Recommendations are visible.
- Staff can approve/reject/re-analyze.
- High-risk or failed-capacity recommendations should block approval.
- Approval prepares safe internal drafts only.

### Calendar

Admin Calendar is a real operational calendar MVP, not a placeholder.

It shows:

- Activity sessions.
- Events.
- Venue operation overrides/drift.
- Event/resource blocks.
- Private court bookings.

It supports:

- Week/day views.
- Opening existing modules.
- Hide/cancel one activity occurrence through `activity_session_overrides`.
- Create drift override.
- Create one-off public activities/specialpass sessions.

Main component: [src/components/admin/shell/AdminCalendar.tsx](./src/components/admin/shell/AdminCalendar.tsx).

### Specialpass

Specialpass is implemented as a one-off activity/session, not as drift and not as a recurring series.

It supports:

- One-time public activity creation from Calendar.
- Title, date, time, price, capacity, type, description, visibility.
- Membership/day-pass behavior where standard pricing applies.
- Per-session pricing override in `activity_sessions.metadata`.
- Pricing modes:
  - `standard`
  - `fixed_ticket`
  - `member_discount`
- Channel pricing:
  - `online_price_sek`
  - `desk_price_sek`
  - `pricing_channel_mode = 'online_discount'`

Public listing/detail UI should respect metadata pricing mode and avoid showing inherited Open Play badges for specialpass overrides.

### Memberships

Memberships include:

- Stripe subscription checkout.
- Membership tiers.
- Entitlements such as court-hour quota, discounts, open play access, day pass benefits.
- Usage tracking for entitlement periods.
- Admin membership management and assignment surfaces.
- Customer 360 membership/access display.

Membership pricing must not be globally changed by specialpass/session pricing overrides.

## Current Production Status

Live today:

- Public booking and booking confirmation.
- Court availability with resource-block awareness.
- Public venue/opening-hours display with drift overrides.
- Activity/session listing and registration.
- Activity occurrence hiding/cancellation through overrides.
- Specialpass one-off public sessions with per-session pricing display.
- Membership checkout and entitlement logic.
- Day passes.
- Self check-in route and desk-visible check-ins.
- Staff check-in for bookings.
- Desk OS command/search/action surface.
- Admin OS Today, Calendar, Venue Operations, Resource Blocks, Revenue Ledger.
- Customer 360.
- Event lead intake, offer generation, PDF/email drafts, confirm-booking, event capacity blocks.
- Agent recommendations for event operations.
- Zettle purchases import into Revenue Ledger.
- Hub/chat/community surfaces.
- Venue/resource displays.
- Score/broadcast MVP.

Important production notes:

- Frontend is deployed by Vercel from `main`.
- Supabase project ref in this repo is `cqnjpudmsreubgviqptg`.
- Edge Functions need manual deploy.
- Migrations are applied manually and PostgREST schema cache should be reloaded after SQL editor changes.
- Do not commit Supabase `.temp` files.

## Edge Functions Overview

| Function | Purpose |
| --- | --- |
| `api-admin` | Admin OS aggregate API: venue/staff/courts/hours/pricing/products/schedule, Admin Today, Calendar, attention, Agent Inbox, venue operations, resource blocks, activity overrides, Revenue Ledger, Zettle connect/import. |
| `api-auth` | Auth-adjacent helper endpoints. |
| `api-bookings` | Public/admin booking API: checkout creation, public venue/courts, public booking, receipts/wellness, admin booking CRUD, availability and revenue helpers. |
| `api-checkins` | Self check-in, booking code check-in, staff check-in, today/ops feeds, player/event check-in helpers. |
| `api-corporate` | Corporate account and join/dashboard flows. |
| `api-customers` | Customer list/profile/create/update/recent and Customer 360 aggregation. |
| `api-day-passes` | Day pass flows and access support. |
| `api-event-public` | Public event/activity/session endpoints, registrations, event lead intake-facing flows. |
| `api-event-templates` | Event product/template catalog support. |
| `api-events` | Admin event CRUD, event plan sharing, public partner plan. |
| `api-link-preview` | Link preview helper. |
| `api-matches` | Match/community game endpoints. |
| `api-memberships` | Membership tiers, entitlement, and member-facing/admin membership operations. |
| `api-notifications` | Push subscription and notification sending. |
| `api-ops` | Ops Center and operational health/check-in visibility support. |
| `api-score` | Pickla Score MVP endpoints. |
| `api-stripe` | Stripe customer/payment-method/setup helpers. |
| `api-stripe-webhook` | Stripe webhook finalization for bookings, registrations, day passes, memberships, receipts, ledger entries. |
| `event-followup-agent` | Event lead follow-up automation support. |
| `event-intake-agent` | Event lead intake, list, and update support. |
| `event-offer-builder` | Offer generation helper. |
| `event-pdf-generator` | Event offer PDF generation. |
| `event-sales-agent` | Event sales workflow: recommendation, schedule patch, offer draft/PDF/email, send offer, booking preview, confirm booking. |

Shared helpers are in [supabase/functions/_shared](./supabase/functions/_shared).

## Database Domains

### Bookings

Core concepts:

- `bookings`: one row per court/resource booking row; multi-court bookings are grouped by Stripe session/access code.
- `venue_courts`: physical courts/resources used by public booking and displays.
- `booking_receipts`: receipt/evidence records.
- `access_code`: 4-digit venue/day code for booking check-in.
- `stripe_session_id`: payment idempotency/grouping key.

Booking availability must respect `event_resource_blocks`.

### Activities

Core concepts:

- `activity_sessions`: concrete/recurring public sessions and one-off specialpass sessions.
- `session_registrations`: paid/free/access-based registrations.
- `activity_session_overrides`: per-date hidden/cancelled state without modifying the recurring base session.
- `activity_session_interests`: soft intent/social proof.
- Activity pricing can be overridden per session through `activity_sessions.metadata`.

### Memberships

Core concepts:

- `membership_tiers`
- `memberships`
- `membership_entitlements`
- `membership_usage`
- Stripe customer/subscription IDs on member/payment records.

Memberships can grant quotas, discounts, and access benefits.

### Events

Core concepts:

- `event_leads`: inbound customer request and sales pipeline.
- `events`: operational event record; source of truth for schedule (`start_date`, `end_date`, `start_time`, `end_time`).
- `event_offers`: offer payload, send status, PDF/email draft data.
- `event_lead_activities`: timeline, agent recommendations, approval/rejection events.
- `event_resource_catalog`: bookable/plannable event resources.
- `event_resource_allocations`: proposed/confirmed planning allocations.
- `event_courts`: selected court resources.
- `event_resource_blocks`: actual operational capacity blocks.

### Check-ins

Core concepts:

- `venue_checkins`: live/recorded presence.
- `entry_type`: booking, activity/session registration, day pass, membership, manual/auto.
- `session_date`: Stockholm venue day.
- Check-ins are idempotent for active entitlement/user combinations.
- Desk should show current Stockholm day only, not stale previous-day presence as current.

### Ledger

Core concepts:

- `ledger_entries`: append-only daily sales truth.
- `source_type`: booking/activity/day_pass/membership/zettle/etc.
- `source_id`: source record/session id.
- `accounting_date`, `occurred_at`, amount/VAT/payment/receipt evidence.
- Zettle imports write both `zettle_purchases` and ledger entries.

There is no `ledger_entry_lines` table yet. No reversal/correction model yet.

### Customers

Core concepts:

- Supabase Auth users are the identity anchor.
- `player_profiles` stores customer profile fields.
- Customer 360 resolves linked operational records by `user_id`, receipts, Stripe session/receipt metadata where available.
- Zettle purchases generally do not include customer identity and are not auto-matched.

## Agent Roadmap

Current state: recommendation-first event operations agent.

Next phases:

1. Strengthen recommendation quality.
   - More reliable opening-hours checks.
   - Better resource alternatives.
   - Better conflict explanations.
   - Stronger event-type heuristics.
2. Consolidate Event OS workflow.
   - One decision path: Lead -> Agent Recommendation -> Approve -> Offer Draft Ready -> Send Offer -> Customer Accepts -> Confirm Booking.
   - Remove duplicate unsafe legacy controls where state says they are invalid.
3. Add explicit action contracts.
   - Recommendation payload should declare proposed actions as safe internal actions.
   - UI should show exactly what approval will do.
4. Add durable agent tables when recommendations outgrow `event_lead_activities`.
   - `agent_runs`
   - `agent_recommendations`
   - `agent_actions`
5. Add ledger/audit trail after operational truth is correct.
   - The ledger must log truth, not stale planned data.
6. Keep hard safety rules.
   - Agents never send customer email, charge, refund, cancel activities, delete data, or change confirmed bookings without explicit staff approval.

## Multi-venue Roadmap

The schema is already venue-scoped, but operational multi-venue maturity is incomplete.

Needed:

- Venue switcher consistency across Admin, Desk, Calendar, Ledger, and Customer 360.
- Per-venue opening hours, products, membership rules, Zettle connection, Stripe account/connect model if needed.
- Cross-venue customer history without leaking venue-private operational notes.
- Central HQ reporting across venue ledgers.
- Venue-specific displays, QR check-in surfaces, and device management.
- Multi-venue staff permissions and audit trail.
- Clear stage/prod separation for every external integration.

## Known Gaps

Product/ops gaps:

- Ledger has no line-item model, correction/reversal entries, export, or Fortnox integration.
- Zettle imports purchases only; no settlements, categories, products, or customer matching.
- Customer 360 is read-focused; no refund/cancellation/customer-service workflows beyond safe existing actions.
- Agent framework is intentionally minimal and stored in lead activities.
- Calendar MVP has no drag/drop and limited editing.
- Activity/session editing is still uneven across admin surfaces.
- Specialpass pricing display and checkout calculation must stay aligned as more pricing modes are added.
- Self check-in uses permanent venue QR; daily rotating token/geofence abuse prevention is not built.
- Operations Truth exists through multiple endpoints/components, not a formal single backend read model.
- Multi-venue HQ reporting is not done.

Technical gaps:

- Supabase generated types may lag the live schema after migrations.
- Some admin queries still rely on flat merging because PostgREST schema cache/FK embeds can fail after manual migrations.
- Lint has legacy repo-wide debt; build is the current minimum gate for most product changes.
- Migrations are manual; deploy/runbook discipline matters.
- Edge Function deployment is separate from frontend deployment.

## Development Workflow

### Commands

```bash
npm run dev          # Start local Vite dev server
npm run build        # Production build
npm run test         # Run Vitest once
npm run test:watch   # Run Vitest in watch mode
npm run lint         # ESLint check; may include legacy debt
npm run prod:check   # Tests + production build
npm run ops:agent    # Production ops/deploy checklist
```

### Local environment

Create `.env`:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_PROJECT_ID=...
```

Backend secrets live in Supabase Secrets, not frontend env:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- Zettle credentials as configured by `api-admin`

### Coding rules

- Make targeted changes.
- Use React Query and `apiGet`/`apiPost`/`apiPatch`/`apiDelete` for server state.
- Use Luxon for Stockholm calendar-day logic.
- Do not bypass Edge Functions with direct Supabase writes from UI except for established auth/realtime patterns.
- Do not change payment, membership, or booking logic as part of unrelated UI work.
- Never commit secrets.
- Never commit `supabase/.temp/*`.

### Deploy

Frontend:

```bash
git push
```

Vercel deploys from `main`.

Migrations:

1. Apply manually in Supabase SQL editor.
2. Reload PostgREST schema cache:

```sql
NOTIFY pgrst, 'reload schema';
```

Edge Functions:

```bash
supabase functions deploy <function-name> --no-verify-jwt --project-ref cqnjpudmsreubgviqptg
```

Production Stripe webhook:

```text
https://cqnjpudmsreubgviqptg.supabase.co/functions/v1/api-stripe-webhook
```

See [docs/production-readiness.md](./docs/production-readiness.md), [docs/launch-runbook.md](./docs/launch-runbook.md), and [docs/daily-operations-runbook.md](./docs/daily-operations-runbook.md) for operational runbooks.
