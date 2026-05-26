# Security Checklist

## Access Control

- Super admin access is limited to trusted operators only.
- Venue staff access is venue-scoped through `venue_staff`.
- Temporary staff/admin access has an owner and removal date.
- Shared tablets should use staff accounts created for that purpose, not personal super admin accounts.
- Staff should only open customer records for booking, membership, check-in, support, payment correction, or incident handling.
- Manual customer corrections should be logged with staff member, timestamp, before/after state, and reason.

## Temporary Admin Access

- Define owner, reason, venue/customer scope, and expiry before granting access.
- Grant the least privilege role that can solve the issue.
- Record approver, recipient, scope, and expiry.
- Remove access immediately after the task is complete or at the agreed expiry.
- Review temporary access after incidents or sensitive support cases.

## Edge Functions

All Supabase functions are deployed with `--no-verify-jwt`. Therefore:

- Public endpoints must only expose intentionally public/kiosk data.
- Staff/admin endpoints must call `getAuthenticatedClient(req)` and verify venue role.
- Customer endpoints must verify the logged-in user owns the requested data or has venue staff access.
- Webhooks must verify provider secrets/signatures.

## Public/Kiosk Surfaces

- `/display/device/:token` and related display routes should expose only operational status needed by the device.
- Device tokens should be treated as bearer secrets.
- Rotate device token if a padda is lost, retired, or exposed.
- Resource check-in should validate that a booking code belongs to that resource.

## Secrets

Keep separate production and stage secrets for:

- Supabase project refs and keys
- Stripe secret and webhook secret
- Resend key and webhook secret
- VAPID keys
- Giphy key if used

Never commit `.env` files with real secrets.

## Release Checks

- No debug endpoints exposed without protection.
- No production test keys in frontend environment.
- No stage keys in production.
- No admin routes reachable without auth.
- RLS is enabled on new tables unless they are intentionally service-role only.
- Realtime publications only include tables intended for live frontend use.
- Public legal pages `/privacy`, `/terms`, and `/cookies` render and are linked from customer flows.
- New customer data fields are reflected in [data-and-compliance.md](./data-and-compliance.md).
