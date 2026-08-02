# Commerce R1 production repair and release procedure

This is a future procedure only. It was not executed while building the
baseline. Do not run it until the five runtime dependencies on absent legacy
capabilities have explicit product/engineering decisions and this baseline
commit has been integrated into the approved release SHA.

## Fixed identifiers

```bash
export PROJECT_REF=ptnvhbniiiapzbyofctg
export PRE_RELEASE_FRONTEND_DEPLOYMENT=dpl_CSaQJYdqWzjgWAHH6ksxPQ3vhMAd
export ORIGINAL_COMMERCE_RC=fc5743665c509aaa037b014dc3daeaea0bf94fe3
export PRODUCTION_APP_BEFORE_RELEASE=e3e36505e2b169b7c1a4333e708aff276031aa38
```

Set and independently approve `APPROVED_RELEASE_SHA` after the baseline commit
and any required missing-capability decision are integrated:

```bash
export APPROVED_RELEASE_SHA='<approved immutable release sha>'
test -n "$APPROVED_RELEASE_SHA"
git cat-file -e "$APPROVED_RELEASE_SHA^{commit}"
```

Abort if the placeholder remains or the commit is not available locally.

## 1. Backup and immutable preflight

Hard gate: create a production database snapshot in the Supabase dashboard (or
verify PITR can restore to the immediately recorded timestamp). Record the
snapshot/PITR restore point and an operator independent from the releaser must
confirm it. There is intentionally no invented CLI command for a platform
snapshot.

Then run:

```bash
git fetch origin
test "$(git rev-parse origin/main)" = "$PRODUCTION_APP_BEFORE_RELEASE"
test "$(git rev-parse "$APPROVED_RELEASE_SHA")" = "$APPROVED_RELEASE_SHA"
git diff --check "$PRODUCTION_APP_BEFORE_RELEASE..$APPROVED_RELEASE_SHA"

supabase link --project-ref "$PROJECT_REF"
supabase migration list --linked
supabase db push --linked --dry-run
```

Abort unless:

- `origin/main` still equals the recorded pre-release commit;
- the eight historical versions match on both sides;
- the dry-run lists exactly the four Commerce migrations in the documented
  order and no baseline/legacy file;
- the snapshot/PITR restore point is independently confirmed;
- production Commerce/API/webhook error rates are at their normal baseline.

## 2. Migration-history treatment

No repair command and no baseline registration command are required or allowed.
Production already records `20260301000000`; that row is the preserved baseline
anchor. The other seven recorded versions also remain active by version.

Verification command:

```bash
supabase migration list --linked
```

Do not run `supabase migration repair`, do not bulk insert into
`supabase_migrations.schema_migrations`, and do not use `--include-all`.

## 3. Apply the four Commerce migrations

Supabase applies active pending files in timestamp order and records each file
only after it succeeds:

```bash
supabase db push --linked
supabase migration list --linked
supabase db push --linked --dry-run
```

Expected order:

1. `20260728190000_commerce_r1_activity_drafts.sql`
2. `20260728200000_commerce_r1b_account_later.sql`
3. `20260731100000_atomic_activity_pricing_holds.sql`
4. `20260731110000_commerce_day_pass_orders.sql`

The final dry-run must say the remote database is up to date. Abort before
function deployment on any migration error, unexpected pending version, failed
constraint validation or schema/API error. Do not attempt to reverse a
partially applied file by hand.

After successful migration, reload PostgREST schema cache through a reviewed
SQL session:

```sql
NOTIFY pgrst, 'reload schema';
```

Read-only invariant queries:

```sql
select version
from supabase_migrations.schema_migrations
where version in (
  '20260728190000',
  '20260728200000',
  '20260731100000',
  '20260731110000'
)
order by version;

select to_regprocedure(
  'public.acquire_activity_pricing_hold(uuid,uuid,date,uuid,uuid,text,uuid,text,integer,text,integer,jsonb,integer)'
) is not null as atomic_pricing_ready;

select to_regclass('public.commerce_events') is not null as commerce_events_ready;

select column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('session_registrations', 'access_entitlements', 'day_passes')
  and column_name in ('user_id', 'customer_id', 'commerce_order_id')
order by table_name, column_name;
```

## 4. Deploy Edge Functions

Deploy the webhook consumer before the API can create new Commerce sessions:

```bash
supabase functions deploy api-stripe-webhook \
  --no-verify-jwt \
  --project-ref "$PROJECT_REF"

supabase functions deploy api-commerce \
  --no-verify-jwt \
  --project-ref "$PROJECT_REF"

supabase functions list --project-ref "$PROJECT_REF"
```

Abort if either function is not ACTIVE, reports an unexpected version, cannot
boot, or emits new errors. `api-bookings` and `api-event-public` are not changed
between the current production app commit and this Commerce RC and are not
redeployed by this release.

## 5. Fast-forward frontend

Run one final immutable-main guard and then fast-forward only:

```bash
git fetch origin
test "$(git rev-parse origin/main)" = "$PRODUCTION_APP_BEFORE_RELEASE"
git merge-base --is-ancestor origin/main "$APPROVED_RELEASE_SHA"
git push origin "$APPROVED_RELEASE_SHA:refs/heads/main"
```

Wait until the Vercel production deployment created for
`APPROVED_RELEASE_SHA` is `READY`. Record its deployment ID before smoke tests.

## 6. Production smoke order

Stop on the first failure:

1. ordinary activity catalog and purchase;
2. Founder / included membership;
3. Early Bird display, true remaining and one atomic purchase;
4. Heldagspass using the Admin-configured price;
5. Hyrrack quantity, live total and pickup instruction;
6. guest purchase;
7. member purchase;
8. account-later and claim;
9. ticket and receipt;
10. check-in;
11. account-owned cancellation and refund lifecycle;
12. chat access under canonical permissions;
13. booking drawer;
14. duplicate checkout and webhook replay observation;
15. browser/runtime console, Commerce API and webhook error rates.

Monitor Commerce API, Stripe webhook, browser/runtime errors, Early Bird
allocation, Heldagspass, guest/account-later, check-in and cancellation for the
full agreed release window.

## 7. Abort, rollback and fix-forward

Before customer Commerce writes occur, a function/frontend failure can roll
back to the recorded pre-release deployment and function versions while leaving
the additive database schema in place:

- frontend rollback deployment:
  `dpl_CSaQJYdqWzjgWAHH6ksxPQ3vhMAd`;
- pre-release function versions:
  `api-stripe-webhook` 26 and `api-commerce` 3.

Use Vercel's audited rollback/promote operation for the recorded deployment and
redeploy the exact pre-release function sources only after verifying their
commit. Do not improvise function source from a working tree.

Do not roll back the four database migrations destructively. They change
nullability, constraints and ownership relationships and are designed to be
forward compatible with the pre-release code. If any live order, claim, day
pass, cancellation or webhook has used the new schema, database remediation is
fix-forward only with a new reviewed migration.

Restore the production snapshot/PITR point only for confirmed database
corruption or irreconcilable invariant failure, under a declared incident with
customer writes stopped. A smoke failure without database corruption uses
frontend/function rollback plus database fix-forward.
