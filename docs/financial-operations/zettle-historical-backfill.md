# Zettle Historical Backfill

Use this when Zettle App totals show historical revenue that is missing from Pickla.

Example incident:

- Zettle App June: about `105 675 SEK`
- Pickla `zettle_purchases` June: about `37 326 SEK`
- Root cause: Zettle import started mid-month, so earlier dates were never imported.

Pulse is not the fix for this. Pulse reads Revenue Ledger. Revenue Ledger must be made complete first.

## Tool

Admin -> Revenue Ledger -> Zettle -> Historical Zettle Backfill

Inputs:

- Start date
- End date
- Expected total SEK
- Dry Run
- Run Backfill

Endpoint:

```text
POST api-admin/zettle-backfill
```

Example body:

```json
{
  "venueId": "...",
  "startDate": "2026-06-01",
  "endDate": "2026-06-30",
  "dryRun": true,
  "expectedTotalSek": 105675.44
}
```

## Rules

- Dry run first.
- Only run non-dry after comparing the dry-run `raw_total_sek` with the Zettle App expected total.
- Existing ledger rows are not overwritten.
- Existing Zettle purchases are not overwritten.
- Missing purchases are inserted into `zettle_purchases`.
- Missing ledger rows are inserted into `ledger_entries`.
- Re-running the same backfill must create zero duplicates.

## Response Fields

- `days_scanned`
- `purchases_found`
- `purchases_imported`
- `purchases_already_present`
- `ledger_rows_created`
- `ledger_rows_already_present`
- `failures`
- `raw_total_sek`
- `ledger_total_sek`
- `expected_total_sek`
- `expected_diff_sek`

Dry run returns `purchases_would_import` and `ledger_rows_would_create` instead of mutating data.

## Verification SQL

June Zettle raw total:

```sql
select
  count(*) as rows,
  sum(amount_inc_vat_minor) / 100.0 as sek
from public.zettle_purchases
where occurred_at >= timestamp with time zone '2026-06-01 00:00:00 Europe/Stockholm'
  and occurred_at < timestamp with time zone '2026-07-01 00:00:00 Europe/Stockholm';
```

June Zettle ledger total:

```sql
select
  count(*) as rows,
  sum(amount_inc_vat_minor) / 100.0 as sek
from public.ledger_entries
where source_type = 'zettle'
  and accounting_date >= date '2026-06-01'
  and accounting_date < date '2026-07-01';
```

Raw purchases missing ledger:

```sql
select
  count(*) as missing_rows,
  sum(zp.amount_inc_vat_minor) / 100.0 as missing_sek
from public.zettle_purchases zp
left join public.ledger_entries le
  on le.source_type = 'zettle'
 and le.source_id = zp.purchase_uuid
where zp.occurred_at >= timestamp with time zone '2026-06-01 00:00:00 Europe/Stockholm'
  and zp.occurred_at < timestamp with time zone '2026-07-01 00:00:00 Europe/Stockholm'
  and le.id is null;
```

Pulse revenue truth by source:

```sql
select
  source_type,
  payment_status,
  count(*) as rows,
  sum(amount_inc_vat_minor) / 100.0 as sek
from public.ledger_entries
where accounting_date >= date '2026-06-01'
  and accounting_date < date '2026-07-01'
group by source_type, payment_status
order by source_type, payment_status;
```

Duplicates check:

```sql
select
  source_type,
  source_id,
  count(*) as rows
from public.ledger_entries
where source_type = 'zettle'
group by source_type, source_id
having count(*) > 1;
```

Expected result: zero rows.

## Acceptance

After backfill:

- Zettle App June total equals Pickla `zettle_purchases` June total, or the difference is explained by refunds/voided purchases not included the same way.
- Pickla `ledger_entries source_type='zettle'` June total equals `zettle_purchases` June total.
- Pulse June updates naturally because ledger is now complete.
