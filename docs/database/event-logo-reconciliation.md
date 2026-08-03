# Deferred event-logo content debt

This record covers exactly the four verified production references in
`event-logo-reconciliation.json`. Applying the secure bucket migration never
fetches remote files or rewrites content.

## Commerce R1 release decision

The product owner accepted these four stale references as temporary known
content debt. Commerce R1 must restore the secure bucket, but must not upload
replacement files or update any of the four database records. The references
remain unchanged until a separate content-remediation release is approved.

## Current recovery status

The two unique legacy source URLs were checked read-only on 2026-08-03. Their
project host (`cqnjpudmsreubgviqptg.supabase.co`) no longer resolved, so the
original bytes could not be recovered. No synthetic replacement assets are
included in the immutable release head.

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

## Future remediation

Production execution requires all of the following, in addition to the normal
release approval and backup gates:

1. Recover and independently verify both original SVG files, or obtain an
   explicit product-owner decision approving replacements.
2. Put the verified files in a private local directory using the manifest
   fixture filenames. Record their SHA-256 values in the release report.
3. Dry-run the tool against production and review all four planned changes.
4. Rehearse the exact four-row operation twice in a disposable production-schema
   clone and verify four objects, four audit rows and an idempotent second run.
5. Use `--apply --expect-target ptnvhbniiiapzbyofctg --allow-production` with
   `CONFIRM_PRODUCTION_EVENT_LOGO_RECONCILIATION=ptnvhbniiiapzbyofctg`.
6. Verify the four public URLs, four immutable audit rows and customer pages.

Do not execute this remediation as part of Commerce R1.
