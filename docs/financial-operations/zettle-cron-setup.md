# Zettle Revenue Sync Cron Setup

This runbook configures automated Zettle purchase import for production.

Target project:

- Supabase project ref: `ptnvhbniiiapzbyofctg`
- Edge Function endpoint: `https://ptnvhbniiiapzbyofctg.supabase.co/functions/v1/api-admin/zettle-sync`

The endpoint is protected by `CRON_SECRET` or `ZETTLE_SYNC_SECRET`. Do not hardcode the secret in migrations, repo files, screenshots, tickets, or shared notes.

## What This Does

Creates two Supabase Cron jobs:

- Hourly during opening hours: `15 8-23 * * *`
- Nightly catch-up: `35 2 * * *`

Both jobs call `api-admin/zettle-sync`. The import is idempotent:

- `zettle_purchases` is upserted by `venue_id,purchase_uuid`.
- `ledger_entries` uses `source_type='zettle'` and `source_id=purchase_uuid` with duplicate inserts ignored.
- Existing verified ledger rows are not overwritten.

## Prerequisites

1. `api-admin` must be deployed with `zettle-sync`.
2. The production Edge Function must have one of these Supabase secrets set:
   - `CRON_SECRET`
   - `ZETTLE_SYNC_SECRET`
3. Supabase Database extensions must be available:
   - `pg_cron`
   - `pg_net`
   - `supabase_vault`

## Secret Setup

Generate a long random value locally. Do not commit it.

Set it as an Edge Function secret:

```bash
supabase secrets set CRON_SECRET="<generated-secret>" --project-ref ptnvhbniiiapzbyofctg
```

Store the same value in Supabase Vault so SQL cron jobs can read it at runtime.

Preferred: Supabase Dashboard -> Vault -> New secret

- Name: `cron_secret`
- Secret: the same value used for `CRON_SECRET`
- Description: `Secret used by Supabase Cron to call api-admin/zettle-sync`

Alternative SQL Editor setup:

```sql
-- Paste the generated secret only while running this SQL manually.
-- Do not save this filled-in SQL in git or any shared document.
select vault.create_secret(
  '<PASTE_GENERATED_SECRET_HERE>',
  'cron_secret',
  'Secret used by Supabase Cron to call api-admin/zettle-sync'
);
```

Verify that the secret exists without printing it:

```sql
select
  name,
  description,
  created_at,
  updated_at,
  decrypted_secret is not null as has_secret
from vault.decrypted_secrets
where name = 'cron_secret';
```

## Install Extensions

Run in Supabase SQL Editor:

```sql
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
```

Verify:

```sql
select extname
from pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault')
order by extname;
```

## Create Cron Jobs

Run in Supabase SQL Editor after the Vault secret exists.

```sql
-- Remove existing jobs with the same names so re-running this setup is safe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'zettle-sync-hourly-opening-hours') then
    perform cron.unschedule('zettle-sync-hourly-opening-hours');
  end if;

  if exists (select 1 from cron.job where jobname = 'zettle-sync-nightly-catchup') then
    perform cron.unschedule('zettle-sync-nightly-catchup');
  end if;
end $$;

-- Hourly sync during opening hours.
select cron.schedule(
  'zettle-sync-hourly-opening-hours',
  '15 8-23 * * *',
  $$
  select net.http_post(
    url := 'https://ptnvhbniiiapzbyofctg.supabase.co/functions/v1/api-admin/zettle-sync?days=2',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_secret'
        limit 1
      )
    ),
    body := jsonb_build_object(
      'source', 'supabase_cron',
      'job', 'zettle-sync-hourly-opening-hours',
      'days', 2
    ),
    timeout_milliseconds := 30000
  );
  $$
);

-- Nightly catch-up in case Zettle, the network, or the Edge Function had a temporary failure.
select cron.schedule(
  'zettle-sync-nightly-catchup',
  '35 2 * * *',
  $$
  select net.http_post(
    url := 'https://ptnvhbniiiapzbyofctg.supabase.co/functions/v1/api-admin/zettle-sync?days=7',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_secret'
        limit 1
      )
    ),
    body := jsonb_build_object(
      'source', 'supabase_cron',
      'job', 'zettle-sync-nightly-catchup',
      'days', 7
    ),
    timeout_milliseconds := 30000
  );
  $$
);
```

## Verification SQL

List jobs:

```sql
select
  jobid,
  jobname,
  schedule,
  active,
  nodename,
  nodeport
from cron.job
where jobname in ('zettle-sync-hourly-opening-hours', 'zettle-sync-nightly-catchup')
order by jobname;
```

Check cron run history:

```sql
select
  j.jobname,
  r.status,
  r.return_message,
  r.start_time,
  r.end_time
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where j.jobname in ('zettle-sync-hourly-opening-hours', 'zettle-sync-nightly-catchup')
order by r.start_time desc
limit 30;
```

Check HTTP request results from `pg_net` if needed:

```sql
select
  id,
  status_code,
  error_msg,
  created
from net._http_response
order by created desc
limit 30;
```

Check last Zettle sync status:

```sql
select
  v.name as venue_name,
  z.status,
  z.last_import_started_at,
  z.last_import_finished_at,
  z.last_import_from,
  z.last_import_to,
  z.last_import_count,
  z.last_import_error
from public.zettle_connections z
left join public.venues v on v.id = z.venue_id
order by z.updated_at desc;
```

Check for duplicate Zettle ledger rows:

```sql
select
  source_id,
  count(*) as rows
from public.ledger_entries
where source_type = 'zettle'
group by source_id
having count(*) > 1
order by rows desc;
```

Expected result: zero rows.

## Manual Test

Trigger one run manually from SQL without waiting for the schedule:

```sql
select net.http_post(
  url := 'https://ptnvhbniiiapzbyofctg.supabase.co/functions/v1/api-admin/zettle-sync?days=2',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'cron_secret'
      limit 1
    )
  ),
  body := jsonb_build_object(
    'source', 'manual_sql_test',
    'days', 2
  ),
  timeout_milliseconds := 30000
) as request_id;
```

Then inspect:

```sql
select
  id,
  status_code,
  error_msg,
  content,
  created
from net._http_response
order by created desc
limit 5;
```

## Rollback

Unschedule both jobs:

```sql
select cron.unschedule('zettle-sync-hourly-opening-hours');
select cron.unschedule('zettle-sync-nightly-catchup');
```

This stops automation only. It does not delete Zettle purchases, ledger entries, or connection status.

## Notes

- Cron schedules run in UTC. The selected schedule is intentionally broad enough for Pickla Stockholm opening hours.
- The nightly catch-up imports seven Stockholm days and is safe to repeat.
- The manual Ledger/Admin `Sync now` button remains the fallback path.
- Pulse should be considered stale if the latest successful Zettle sync is old or if `last_import_error` is populated.
