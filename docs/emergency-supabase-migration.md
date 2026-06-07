# Emergency Supabase Migration Runbook

This runbook is for disaster recovery when the current production Supabase project is restricted or unsafe to keep serving production traffic.

This is not a product redesign. Do the smallest safe steps first.

## Current Incident

- Current production project ref: `cqnjpudmsreubgviqptg`
- Incident root cause: excessive Edge Function invocations from repeated `api-score` polling on tablets/score displays.
- First mitigation: score polling is feature-flagged behind `VITE_ENABLE_SCORE_POLLING`.
- Emergency default should be `VITE_ENABLE_SCORE_POLLING=false`.

## Golden Rules

- Stop `api-score` polling before migrating traffic.
- Stage/test must move first.
- Do not point stage/test at production Stripe live keys.
- Do not point production at stage/test Supabase keys.
- Never mix old and new Supabase project refs, service role keys, anon keys, or Stripe webhook secrets.
- Never commit Supabase `.temp` files.
- Never commit secrets.

## Variables

Keep these in a private password manager or local shell only. Do not commit them.

```bash
OLD_SUPABASE_PROJECT_REF=cqnjpudmsreubgviqptg
OLD_DB_URL=postgresql://...
OLD_SUPABASE_URL=https://cqnjpudmsreubgviqptg.supabase.co
OLD_SUPABASE_ANON_KEY=...
OLD_SUPABASE_SERVICE_ROLE_KEY=...

NEW_SUPABASE_PROJECT_REF=...
NEW_DB_URL=postgresql://...
NEW_SUPABASE_URL=https://<new-project-ref>.supabase.co
NEW_SUPABASE_ANON_KEY=...
NEW_SUPABASE_SERVICE_ROLE_KEY=...
```

## Phase 1: Disable Score Polling

Set these env vars before deploying stage/prod:

```bash
VITE_ENABLE_SCORE_POLLING=false
```

When disabled:

- `api-score/match` does not auto-poll.
- `api-score/join-state` does not auto-poll.
- `api-score/device-state` does not auto-poll.
- `api-score/live-state` does not auto-poll.
- Initial one-time fetches can still run.
- Score mutations still work: `score`, `correct-last-turn`, `undo`, `end-match`, `rematch`, `walk-in`, `join-player`.

Verify locally:

```bash
rg -n "api-score|refetchInterval" src/pages/ScoreBroadcastPage.tsx src/pages/ScoreStartPage.tsx src/pages/ScoreMatchPage.tsx src/pages/DeviceDisplay.tsx
npm run build
```

## Phase 2: Inventory Current Supabase Project

### Database Schema And Data

Dump schema and data separately so failures are easier to isolate.

```bash
pg_dump "$OLD_DB_URL" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --file old-schema.sql

pg_dump "$OLD_DB_URL" \
  --data-only \
  --no-owner \
  --no-privileges \
  --file old-data.sql
```

For a full backup:

```bash
pg_dump "$OLD_DB_URL" \
  --format custom \
  --no-owner \
  --no-privileges \
  --file old-full.dump
```

### Auth Schema And Users

Supabase Auth users can be migrated by copying the `auth` schema tables, including `auth.users` and `auth.identities`, if done carefully.

Do not assume Auth migrates automatically with public schema dumps.

Recommended careful dump:

```bash
pg_dump "$OLD_DB_URL" \
  --schema auth \
  --data-only \
  --no-owner \
  --no-privileges \
  --file old-auth-data.sql
```

Before restoring Auth data:

- Confirm the new project is empty or intentionally prepared.
- Confirm Supabase Auth settings match the old project.
- Confirm email confirmation and provider settings match.
- Confirm redirect URLs include stage/test and production domains as needed.
- Restore into a test/stage project first and verify sign-in with existing users.

### RLS Policies, Functions, Triggers, Extensions

Include these in schema inventory:

```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
order by schemaname, tablename, policyname;

select n.nspname as schema, p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
order by 1, 2;

select event_object_schema, event_object_table, trigger_name
from information_schema.triggers
order by 1, 2, 3;

select extname from pg_extension order by extname;
```

### Storage Buckets And Policies

Inventory buckets and object policies:

```sql
select * from storage.buckets order by id;
select * from pg_policies where schemaname = 'storage' order by tablename, policyname;
```

Storage object data is not always covered by database dumps. Use Supabase dashboard or storage tooling to copy bucket contents.

### Edge Functions

List old functions:

```bash
supabase functions list --project-ref "$OLD_SUPABASE_PROJECT_REF"
```

Deploy functions to the new project:

```bash
supabase functions deploy api-admin --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-bookings --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-checkins --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-customers --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-day-passes --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-event-public --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-events --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-memberships --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-notifications --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-ops --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-score --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-stripe --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy api-stripe-webhook --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy event-offer-builder --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase functions deploy event-sales-agent --no-verify-jwt --project-ref "$NEW_SUPABASE_PROJECT_REF"
```

Adjust the list if `supabase functions list` shows additional deployed functions.

### Edge Function Secrets To Copy Manually

Copy secrets from the old project to the new project. Do not paste secrets into git.

Required/known secrets:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `RESEND_API_KEY`
- `GIPHY_API_KEY` if used by Edge Functions
- Any function-specific webhook signing secrets
- Any provider credentials used by current deployed functions

Supabase built-in values change per project and must use the new project values:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Set secrets:

```bash
supabase secrets set STRIPE_SECRET_KEY=... --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase secrets set STRIPE_WEBHOOK_SECRET=... --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase secrets set VAPID_PUBLIC_KEY=... --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase secrets set VAPID_PRIVATE_KEY=... --project-ref "$NEW_SUPABASE_PROJECT_REF"
supabase secrets set RESEND_API_KEY=... --project-ref "$NEW_SUPABASE_PROJECT_REF"
```

Verify:

```bash
supabase secrets list --project-ref "$NEW_SUPABASE_PROJECT_REF"
```

## Phase 3: Restore To New Supabase Project

Restore schema first:

```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f old-schema.sql
```

Restore Auth data carefully if migrating existing users:

```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f old-auth-data.sql
```

Restore public/app data:

```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f old-data.sql
```

Reload PostgREST schema cache:

```sql
NOTIFY pgrst, 'reload schema';
```

Generate fresh TypeScript DB types:

```bash
supabase gen types typescript --project-id "$NEW_SUPABASE_PROJECT_REF" > src/integrations/supabase/types.ts
```

Run build:

```bash
npm run build
```

## Phase 4: Hardcoded Project Ref / URL Inventory

Old project ref: `cqnjpudmsreubgviqptg`

Known current repo references that must be reviewed before cutover:

- `src/pages/OpsCenterPage.tsx` fallback project ref.
- `scripts/deploy-stage-functions.sh` guard against prod ref.
- `scripts/ops-agent-check.mjs` hardcoded prod ref.
- `README.md` deploy examples.
- `AGENTS.md` production references.
- `docs/staging.md` and `docs/launch-runbook.md`.
- Function comments in `supabase/functions/api-notifications/index.ts` and `supabase/functions/api-stripe/index.ts`.
- Stripe webhook URL docs/comments.

Search commands:

```bash
rg -n "cqnjpudmsreubgviqptg|supabase\\.co|VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY" .
rg -n "https://[a-z0-9]+\\.supabase\\.co" .
```

Expected runtime configuration should come from env vars, not hardcoded production refs.

## Phase 5: Stage/Test Cutover First

Update only stage/test Vercel env vars first:

- `VITE_SUPABASE_URL=$NEW_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY=$NEW_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_PROJECT_ID=$NEW_SUPABASE_PROJECT_REF`
- `SUPABASE_SERVICE_ROLE_KEY=$NEW_SUPABASE_SERVICE_ROLE_KEY`
- `VITE_ENABLE_SCORE_POLLING=false`
- Any function/webhook URLs that point to Supabase project URLs.

Do not touch production yet.

Redeploy stage/test after env changes.

### Stage Test Checklist

- App loads.
- No 402 errors.
- No old Supabase project URL appears in network requests.
- Login works.
- Existing users can sign in if Auth migration succeeded.
- Booking page loads.
- Court availability loads.
- Create booking works.
- Payment flow starts in Stripe test mode.
- Stripe test webhook works or is safely disabled for test.
- Membership page loads.
- Admin login/check works.
- Check-ins load.
- Event sessions load.
- `api-score` no longer polls repeatedly.
- Idle tablets make zero repeated `api-score` calls.
- Manual score mutations still work.

## Phase 6: Stripe Webhooks

Production Stripe webhook path:

```text
https://<project-ref>.supabase.co/functions/v1/api-stripe-webhook
```

For stage/test, use Stripe test mode and the new stage/test project URL.

For production cutover, update Stripe live webhook only after stage is verified and production env vars are ready.

Webhook requirements:

- Deno-compatible implementation.
- Idempotent on retries.
- Uses the correct webhook signing secret for the target project/mode.
- Never mixes test webhook secret with live webhook secret.

## Phase 7: Production Cutover Plan

Only after stage/test is verified:

1. Put maintenance mode or manual booking pause in reach.
2. Take a fresh backup of the old project.
3. Pause high-risk traffic if needed.
4. Update production Vercel env vars:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_SUPABASE_PROJECT_ID`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `VITE_ENABLE_SCORE_POLLING=false`
5. Update Stripe live webhook URL to the new project.
6. Redeploy production.
7. Verify in incognito.
8. Monitor Supabase Edge Function logs immediately.
9. Monitor Stripe webhook delivery immediately.
10. Keep old project read-only/available until confidence is high.

## Final Production Cutover Checklist

- Stage/test passed all checklist items.
- New project has all migrations/schema/data.
- Auth users can sign in or a customer communication plan exists.
- Storage buckets and policies exist.
- Edge Functions deployed with `--no-verify-jwt`.
- Edge Function secrets set on new project.
- TypeScript DB types regenerated.
- Vercel stage/test env points to new project.
- Vercel prod env ready but not mixed with test Stripe.
- Stripe live webhook URL updated only at cutover.
- `VITE_ENABLE_SCORE_POLLING=false` in production.
- Network tab shows no `cqnjpudmsreubgviqptg` calls after cutover.
- No repeated `api-score` calls from idle tablets.

## Risks / Blockers

- Supabase Auth migration is sensitive. Copying `auth.users` and `auth.identities` incorrectly can break login.
- Storage object data may require separate copy outside database dumps.
- Stripe customer IDs and subscription IDs are environment-specific. Production must keep live IDs; stage/test must use test IDs.
- Webhook secrets differ between Stripe test and live mode.
- Realtime and RLS can appear healthy until specific user roles are tested.
- Existing installed PWAs/service workers may cache old assets briefly; verify after hard refresh/reinstall if needed.
- DNS/custom domains and Supabase Auth redirect URLs must be updated before production cutover.
