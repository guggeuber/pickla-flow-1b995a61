# Launch Runbook

Use this for every production candidate and production deploy.

## Preflight

1. Pull latest main with rebase.
2. Confirm only intended files are dirty.
3. Run:

```bash
npm run prod:check
npm run ops:agent -- --mode=deploy
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
supabase functions deploy <function-name> --no-verify-jwt --project-ref ptnvhbniiiapzbyofctg
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
4. Run the 15-minute Ops Agent watch from [observability-and-ops-agent.md](./observability-and-ops-agent.md).

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

## Post-Deploy Ops Watch

For 15 minutes after deploy:

- Watch Vercel for build/runtime errors.
- Check Supabase Edge Function logs for changed functions.
- Check Stripe webhook deliveries and retries.
- Open a known padda/device route and confirm it renders.
- Check one changed journey end-to-end.
- Classify the deploy:
  - Green: no customer-impacting issue found.
  - Yellow: issue exists with a safe workaround.
  - Red: customer-impacting issue without safe workaround. Contain or roll back.

If the deploy is yellow or red, write an incident note using the template in [observability-and-ops-agent.md](./observability-and-ops-agent.md).

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
- severity P0-P3
- user impact
- affected venue
- affected route/function
- affected booking/payment/customer ids
- containment
- action taken
- verification
- follow-up needed
