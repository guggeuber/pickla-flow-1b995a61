# Operations Health V1

Operations Health is the foundation layer for integration freshness.

It is intentionally not a dashboard and not a metrics API. It answers one question:

> Can this operational source be trusted right now?

## Model

Each integration reports one status row per venue:

- `integration_key`
- `status`: `OK`, `FAILED`, `NEVER_SYNCED`
- `last_successful_sync_at`
- `last_failed_sync_at`
- `message`
- `metadata`

The backing table is:

- `public.operations_integration_health`

Zettle also stores the same explicit fields on `public.zettle_connections`:

- `last_successful_sync_at`
- `last_failed_sync_at`
- `last_sync_status`

These fields mean system synchronization health. They are not the same thing as imported data windows.

## Important Separation

Zettle import windows:

- `last_import_from`
- `last_import_to`

These describe which Zettle purchase time range was requested/imported.

Zettle sync health:

- `last_successful_sync_at`
- `last_failed_sync_at`
- `last_sync_status`

These describe when the integration process itself last succeeded or failed.

Pulse and future reports must use sync health, not import windows, when explaining freshness.

## API

Read-only endpoint:

```text
GET api-ops/health?venueId=...
```

Returned systems:

- `stripe`
- `zettle`
- `bookings`
- `checkins`
- `pulse`

Each system returns:

```json
{
  "status": "OK",
  "last_successful_sync_at": "2026-07-07T08:15:00.000Z",
  "last_failed_sync_at": null,
  "message": null
}
```

Systems that have not registered health yet return `NEVER_SYNCED` with a message that no reporter is registered.

## Current Reporter

Zettle is the first live reporter.

`api-admin/zettle-sync` writes:

- `zettle_connections.last_successful_sync_at`
- `zettle_connections.last_failed_sync_at`
- `zettle_connections.last_sync_status`
- `operations_integration_health`

Manual Zettle sync uses the same import helper and updates the same health fields.

## Future Reporters

Future integrations should write to `operations_integration_health` instead of creating bespoke status fields:

- Stripe
- Meta
- Email
- Cron
- AI Agents

Do not put business metrics in this table. Use it only for operational truth.
