# Launch Runbook

Use this for every production candidate and production deploy.

## Preflight

1. Pull latest main with rebase.
2. Confirm only intended files are dirty.
3. Run:

```bash
npm run prod:check
```

`prod:check` runs tests and production build. Full `npm run lint` currently has legacy repo-wide debt, so run targeted lint on touched files until that backlog is cleared.

4. Review whether the change includes:
   - frontend only
   - migrations
   - edge functions
   - Stripe webhook changes
   - Supabase Auth/Redirect changes

## Migration Deploy

1. Run migration SQL in Supabase SQL editor.
2. Run:

```sql
NOTIFY pgrst, 'reload schema';
```

3. If the migration changes public API shape, do not deploy frontend until the related edge function is deployed.

## Edge Function Deploy

Deploy only changed functions unless doing a full backend cutover.

```bash
supabase functions deploy <function-name> --no-verify-jwt --project-ref cqnjpudmsreubgviqptg
```

Common production functions:

- `api-bookings`
- `api-stripe-webhook`
- `api-stripe`
- `api-day-passes`
- `api-memberships`
- `api-checkins`
- `api-admin`
- `api-event-public`
- `api-score`

## Frontend Deploy

Frontend deploys automatically from Vercel on `main`.

After push:

1. Watch Vercel build.
2. Open `https://playpickla.com`.
3. Run the critical smoke set below.

## Critical Smoke Set

- Home/Today loads.
- Login works.
- `/my` loads for logged-in user.
- Booking availability loads for pickleball and darts.
- Free entitlement booking works for a Founder.
- Paid booking reaches Stripe Checkout.
- Booking cancellation releases courts.
- Desk loads and can search/check in a customer.
- Padda/device page loads.
- Score walk-in can start and record one turn.

## Stripe/Webhook Smoke

- Create one test/low-risk paid booking.
- Confirm booking rows exist and status is confirmed.
- Confirm no duplicate rows on webhook replay.
- Confirm receipt total and VAT are correct.
- Confirm `/my?booking=<ref>` opens the booking detail.

## Rollback

Frontend:

- Revert the commit and push, or redeploy the previous Vercel deployment.

Edge function:

- Re-deploy the last known good function from the previous commit.

Database:

- Prefer fix-forward migrations.
- Do not destructively revert production data without a written recovery plan.

## Incident Notes

For any production incident, record:

- time detected
- user impact
- affected venue
- affected booking/payment/customer ids
- action taken
- follow-up needed
