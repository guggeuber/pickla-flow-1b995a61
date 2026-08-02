# Canonical production database baseline

## Status

This baseline was captured read-only from the Pickla production database on
2026-08-02 while the Commerce R1 release candidate was at
`fc5743665c509aaa037b014dc3daeaea0bf94fe3`.

It exists because production was historically changed by manually executed SQL
without consistently recording the corresponding migration versions. Before
this baseline, the repository had 118 active migration files while production
recorded only eight versions. Replaying the 106 unrecorded legacy migrations is
not safe because most of their final effects already exist and several old
effects are absent or superseded.

The baseline is a representation of production reality, not an attempt to
reconstruct historical intent.

## Baseline artifact

- File: `supabase/migrations/20260301000000_production_schema_baseline.sql`
- SHA-256: `a06aacbcdedfd82afb4b0c1b092658c129ca2fe819678510c489d682863630ab`
- Lines: 15,738
- Public tables: 117
- Public functions: 63
- Public policies plus application-owned Storage policies: 256
- Public triggers plus the application-owned auth trigger: 82
- Types: 8
- Sequences: 1
- Explicit grants/revokes: 551

The artifact includes:

- `pgcrypto` and `uuid-ossp` in the `extensions` schema;
- the complete application-owned `public` schema;
- final constraints, indexes, functions, triggers, RLS state, policies and
  application grants;
- the application-owned `on_auth_user_created` trigger on `auth.users`;
- the canonical `investor-assets` Storage bucket configuration and its four
  policies.

It excludes:

- all customer, auth, payment and application content rows;
- secrets, credentials, tokens and environment identifiers;
- database ownership statements and non-portable platform ACL noise;
- Supabase-managed `auth` and `storage` table/function internals;
- publication state (production currently has no `public` or `storage` tables
  in `supabase_realtime`);
- legacy capabilities that are not present in production.

The single `INSERT` in the migration is the non-secret `investor-assets`
Storage bucket configuration. No object rows are copied.

## Selected history strategy

Strategy A is selected: preserve all eight versions already recorded in
production and build the baseline around them. No production migration-history
repair is required.

The earliest recorded version, `20260301000000`, is the baseline anchor. Its
old three-line extension migration is archived and the active file at that
version is the complete schema baseline. Supabase compares migration versions,
so production continues to regard that version as applied while a new database
uses it to build the schema from zero.

The other seven recorded versions are treated as follows:

| Version | Active treatment |
| --- | --- |
| `20260703120000` | Original migration retained and replayed safely |
| `20260703121000` | Original migration retained and replayed safely |
| `20260703123000` | Compatibility marker; original data repair archived |
| `20260703124000` | Original migration retained and replayed safely |
| `20260716120000` | Original security migration retained |
| `20260716121000` | Original security migration retained |
| `20260727120000` | Original constraint migration retained |

`20260703123000_repair_auth_user_identity_chain_safe.sql` is the only marker.
Its schema effects are already in the baseline, but its historical data repair
requires a pre-existing production organization with `slug = 'pickla'` and is
not a valid empty-database migration. The exact original remains in the archive.

## Active migration directory

The active directory contains exactly twelve files:

1. `20260301000000_production_schema_baseline.sql`
2. `20260703120000_lock_down_player_profiles.sql`
3. `20260703121000_stripe_events_idempotency.sql`
4. `20260703123000_repair_auth_user_identity_chain_safe.sql`
5. `20260703124000_subscription_invoice_receipts.sql`
6. `20260716120000_repair_active_personal_data_exposure.sql`
7. `20260716121000_repair_dormant_token_privilege_exposure.sql`
8. `20260727120000_activity_sessions_end_at_midnight.sql`
9. `20260728190000_commerce_r1_activity_drafts.sql`
10. `20260728200000_commerce_r1b_account_later.sql`
11. `20260731100000_atomic_activity_pricing_holds.sql`
12. `20260731110000_commerce_day_pass_orders.sql`

All 114 pre-Commerce migration files, including immutable copies of the eight
recorded files, are preserved under
`supabase/migrations_archive/production-pre-baseline/`. The exact inventory is
`docs/database/production-baseline-archive.txt`.

Archived files are evidence, not executable migrations. Never move one back to
the active directory or edit it to create a new change. A new change always gets
a new timestamp after the latest active migration.

## Empty database and local development

Baseline-only rehearsal:

```bash
supabase start
supabase db reset --local --version 20260727120000 --no-seed --yes
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -X -v ON_ERROR_STOP=1 \
  -f supabase/tests/production_baseline_contract.sql
```

A new developer creates the current post-Commerce database with:

```bash
supabase start
supabase db reset --local --yes
```

`supabase/seed.sql` inserts one synthetic local-only organization with the
canonical slug `pickla`. It is required for real local signup because
`public.handle_new_user()` resolves that organization. It is not copied from
production and `supabase db push` never applies seed data unless the operator
explicitly supplies `--include-seed`, which is prohibited for production.

Venue, catalog and product content remain environment configuration. A schema
reset does not and must not reconstruct production content.

## Missing legacy capabilities

The following objects are absent from production and intentionally excluded
from the baseline. Their absence must not be confused with a successful product
deprecation.

| Capability | Classification | Current source dependency |
| --- | --- | --- |
| `community-stories` bucket/policies | Currently required; separate blocker | `src/components/admin/AdminStories.tsx`, `src/components/community/StoriesCarousel.tsx`, `src/pages/LinkHub.tsx` |
| `event-logos` bucket/policies | Currently required; separate blocker | `src/components/admin/AdminEvents.tsx`, `src/components/admin/AdminTemplates.tsx`, `src/components/admin/AdminVenue.tsx` |
| `forum-images` bucket/policies | Currently required; separate blocker | `src/components/community/ForumFeed.tsx` |
| `event-offers` bucket | Currently required; separate blocker | `supabase/functions/event-pdf-generator/index.ts`, `supabase/functions/event-sales-agent/index.ts` |
| `event_products` table | Currently required; separate blocker | `src/components/EventLandingPage.tsx`, `src/components/admin/AdminEventProducts.tsx` |
| `customer_transactions` and follow-up columns | Deferred product capability | Documentation/finance roadmap only; no production runtime query found |

No missing capability is classified as dead or obsolete from the available
evidence. Before production baseline repair, product/engineering must choose for
each of the five runtime dependencies either to restore a reviewed capability in
a new migration or to remove/disable the dependent production code. Do not add
their old migrations to the baseline.

## Migration discipline after the baseline

Every production schema change must follow this sequence:

1. Create one new timestamped migration in `supabase/migrations`.
2. Rehearse it from a zero reset and a production-schema clone.
3. Run `supabase db push --linked --dry-run` and review the exact list.
4. Take/verify the production backup gate.
5. Apply through Supabase CLI so history is recorded with the DDL.
6. Verify schema and business invariants immediately.
7. Commit the migration and its contract test/runbook update together.

Manual untracked SQL is prohibited.

For a true emergency:

1. stop customer-facing writes if consistency is at risk;
2. create/verify a recoverable production snapshot;
3. write the emergency SQL as a normal timestamped migration first;
4. peer-review the SQL and explicit invariants;
5. apply it through the tracked migration path;
6. if the dashboard SQL editor is the only viable path, apply the exact file,
   immediately register only that exact version, verify equivalence, and commit
   the file before ending the incident;
7. record the incident in the production runbook.

Never bulk mark migrations as applied and never use `db push --include-all` to
repair historical drift.
