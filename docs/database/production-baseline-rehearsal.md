# Production baseline rehearsal — 2026-08-02

## Inputs

- Commerce RC: `fc5743665c509aaa037b014dc3daeaea0bf94fe3`
- Current production application commit:
  `e3e36505e2b169b7c1a4333e708aff276031aa38`
- Local Supabase CLI: 2.72.7
- Local PostgreSQL image: 17.6
- Production capture: schema-only, read-only, through the Supabase pooler

## Capture safety

The captured dump contained no `COPY` statements, customer rows, auth users,
emails, URLs, UUID literals, credentials or secret material. Ownership and
Supabase-managed Storage internals were removed. Required extension locations,
the auth trigger, Storage bucket configuration and Storage policies were
verified with separate read-only catalog queries.

## Rehearsal A — empty database

Result: PASS with documented environment configuration dependencies.

- Reset from zero through `20260727120000`: passed.
- Canonical baseline contract: passed.
- Activity midnight SQL: passed.
- Product Engine / Commerce foundation SQL: passed.
- Production commit Vitest with exact lockfile: 34 files, 176 tests passed.
- Production commit production build: passed.
- Auth schema dependency: `on_auth_user_created` and
  `public.handle_new_user()` present.
- Local signup data dependency: canonical organization slug `pickla`; supplied
  by synthetic local `supabase/seed.sql` for normal developer resets.
- Venue and catalog data remain explicit environment configuration.

Contract coverage includes booking, activities, memberships, capacity,
Commerce foundation, receipts, Stripe event idempotency, check-in, chat, Admin,
Ops and Investor tables/functions currently present in production.

The five runtime dependencies on absent legacy capabilities are listed in
`production-baseline.md`. They already represent production capability gaps and
are not silently reconstructed by the baseline.

## Rehearsal B — production-schema clone/history

Result: PASS.

- Eight local versions matched the eight simulated remote history rows.
- The selected strategy executed no history repair DDL or data statement.
- Public schema dump before and after history list/dry-run: byte-identical.
- No application data mutation occurred; only read-only commands ran.
- Pre-Commerce dry-run listed exactly:

```text
20260728190000_commerce_r1_activity_drafts.sql
20260728200000_commerce_r1b_account_later.sql
20260731100000_atomic_activity_pricing_holds.sql
20260731110000_commerce_day_pass_orders.sql
```

## Rehearsal C — Commerce on the baseline

Result: PASS.

- The four Commerce migrations applied in timestamp order.
- PostgREST schema reload notification succeeded.
- Baseline contract remained green.
- Commerce SQL suites passed:
  - account-later/draft/customer ownership;
  - atomic Early Bird allocation;
  - configured day-pass purchase/ownership/revocation.
- Existing Activity Midnight and Product Engine SQL suites passed.
- Commerce API E2E: 13 groups passed, covering draft persistence, Hyrrack,
  guest/member flows, duplicate webhook, account-later/claim, check-in,
  Heldagspass, failed payment, abandon, capacity conflict, cancellation/refund,
  free cancellation and privacy-safe observability.
- Deno check passed for `api-commerce` and `api-stripe-webhook`.
- Full RC Vitest: 42 files, 229 tests passed.
- RC production build: passed.
- The final schema after preserving six original recorded migration files was
  byte-identical to the schema used by the successful API E2E run.
- Final dry-run result: `Remote database is up to date.`

## Reviewed Commerce schema delta

The normalized schema delta contained only effects represented in the four
reviewed files:

- authenticated draft scope/expiry/claim columns and unique active-draft
  index;
- customer-owned guest registrations and entitlements;
- claim and guest identity functions;
- privacy-safe `commerce_events`, indexes, RLS and grants;
- atomic Early Bird pricing-hold functions and hardened capacity RPC grants;
- Commerce-owned day-pass columns, ownership constraints and indexes.

No unrelated table, bucket, policy or function was created or removed.

## Known local tooling issue

Supabase Edge Runtime 1.70.0 could not autodetect the `api-commerce` entrypoint
and returned `BOOT_ERROR`. The repository's existing `FUNCTION_PORT` test path
was used to run the same function sources directly in Deno. Both functions
passed Deno check and the complete API E2E suite. This did not alter production
or the application sources.
