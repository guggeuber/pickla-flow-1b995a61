# Stage Environment

Stage must be isolated from production. Do not point Vercel previews or local experimental branches at the production Supabase project when testing booking, payment, membership, or customer data flows.

## Target Setup

- **Frontend:** `stage.playpickla.com` or a clearly named Vercel preview environment.
- **Backend:** separate Supabase project.
- **Stripe:** test mode keys and test webhook endpoint.
- **Email:** Resend test domain/sender or clearly labelled stage sender.
- **Data:** synthetic venue/customer data only.

## Stage Environment Variables

Vercel stage should use its own values:

```bash
VITE_SUPABASE_URL=https://<stage-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<stage-anon-or-publishable-key>
VITE_SUPABASE_PROJECT_ID=<stage-project-ref>
VITE_GIPHY_API_KEY=<optional-stage-key>
```

Supabase stage secrets:

```bash
STRIPE_SECRET_KEY=<stripe-test-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-test-webhook-secret>
VAPID_PUBLIC_KEY=<stage-vapid-public>
VAPID_PRIVATE_KEY=<stage-vapid-private>
RESEND_API_KEY=<stage-resend-key>
RESEND_WEBHOOK_SECRET=<stage-resend-webhook-secret>
```

## Stage Bring-up

Production Supabase project ref is `cqnjpudmsreubgviqptg`. Never use that ref for stage commands.

1. Create the Supabase stage project and write down its project ref.
2. Create or configure a Vercel stage project/domain, ideally `stage.playpickla.com`.
3. Add Vercel stage env vars from [../.env.stage.example](../.env.stage.example).
4. Apply all migrations to the stage database.
5. Run [../supabase/seed.stage.sql](../supabase/seed.stage.sql) in the stage SQL editor.
6. Create the optional auth users below in Supabase Auth, then rerun `seed.stage.sql` so roles/profiles/membership attach:
   - `stage-admin@playpickla.com`
   - `stage-founder@playpickla.com`
   - `stage-customer@playpickla.com`
7. Run `NOTIFY pgrst, 'reload schema';`.
8. Set Supabase Auth Site URL to `https://stage.playpickla.com`.
9. Add redirect URLs:
   - `https://stage.playpickla.com/**`
   - `https://stage.playpickla.com/auth/callback`
10. Set Supabase stage secrets listed above.
11. Deploy all edge functions with `--no-verify-jwt`:

```bash
scripts/deploy-stage-functions.sh <stage-project-ref>
```

The script refuses to deploy if the ref is the known production ref.

12. Configure Stripe test webhook to:
   - `https://<stage-project-ref>.supabase.co/functions/v1/api-stripe-webhook`
13. Configure Resend/test sender if email smoke tests are included.

## Stage Seed Contents

`supabase/seed.stage.sql` creates or updates:

- venue slug `pickla-arena-sthlm`
- opening hours
- 8 pickleball courts and 6 dart boards
- baseline pricing rules
- `access_products`
- `activity_series` and `activity_sessions`
- Founder and Play membership tiers
- Founder entitlements: 4 court-hours/week, unlimited Open Play, 4 guest vouchers/month
- Founder overage price through `membership_tier_pricing`
- stage display devices
- optional staff/customer/profile/membership assignments if the stage auth users exist

## Stage Verification

After deployment and seed:

1. Open `https://stage.playpickla.com/?v=pickla-arena-sthlm`.
2. Log in as `stage-admin@playpickla.com` and verify admin/desk access.
3. Log in as `stage-founder@playpickla.com` and verify Founder is visible on `/my`.
4. Run [smoke-tests.md](./smoke-tests.md) against stage.
5. Confirm Stripe Dashboard is in test mode and webhook delivery points at the stage project ref.
6. Confirm no production customer emails or phone numbers exist in stage.

## Stage Rules

- Never copy real customer PII into stage.
- Never use production Stripe keys in stage.
- Never use stage links for customer-facing operations.
- Every release candidate should pass the smoke test on stage before prod deploy.
