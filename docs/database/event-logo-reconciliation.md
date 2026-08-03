# Event-logo reconciliation

This runbook covers exactly the four verified production references in
`event-logo-reconciliation.json`. It is intentionally separate from the bucket
migration: applying schema must never fetch remote files or rewrite content.

## Current recovery status

The two unique legacy source URLs were checked read-only on 2026-08-03. Their
project host (`cqnjpudmsreubgviqptg.supabase.co`) no longer resolved, so the
original bytes could not be recovered during release preparation. The four
references must not be updated in production until the original files are
recovered from a controlled backup or an owner approves and supplies exact
replacement files.

The files under `supabase/tests/fixtures/event-logos/` are synthetic rehearsal
assets only. They must never be used as production replacements.

## Safety model

`scripts/reconcile-event-logos.mjs`:

- accepts only the four allow-listed records;
- verifies each current URL still equals the audited legacy URL before write;
- uploads one deterministic object per record;
- updates the row with an optimistic old-URL predicate;
- appends old URL, new URL/path, actor, content hash and timestamp to the
  append-only `audit_log`;
- uses a deterministic request id so a retry cannot append a second audit row;
- defaults to dry-run and requires an exact target-ref acknowledgement;
- has an additional explicit guard for the production project.

## Disposable-clone rehearsal

After seeding the four fixture rows into a local clone:

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SERVICE_ROLE_KEY" \
node scripts/reconcile-event-logos.mjs \
  --apply \
  --expect-target local \
  --actor-user-id 90000000-0000-4000-8000-000000000009 \
  --asset-dir supabase/tests/fixtures/event-logos
```

Run the exact command a second time. The second run must report all four rows as
already reconciled, retain exactly four objects and exactly four audit rows.

## Future production execution

Production execution requires all of the following, in addition to the normal
release approval and backup gates:

1. Recover and independently verify both original SVG files, or obtain an
   explicit product-owner decision approving replacements.
2. Put the verified files in a private local directory using the manifest
   fixture filenames. Record their SHA-256 values in the release report.
3. Dry-run the tool against production and review all four planned changes.
4. Use `--apply --expect-target ptnvhbniiiapzbyofctg --allow-production` with
   `CONFIRM_PRODUCTION_EVENT_LOGO_RECONCILIATION=ptnvhbniiiapzbyofctg`.
5. Verify the four public URLs, four immutable audit rows and customer pages.

Never point the tool at an unreviewed manifest or use the synthetic fixtures in
production.
