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

1. Create the Supabase stage project.
2. Apply all migrations in order.
3. Run `NOTIFY pgrst, 'reload schema';`.
4. Set Supabase Auth Site URL to `https://stage.playpickla.com`.
5. Add redirect URLs:
   - `https://stage.playpickla.com/**`
   - `https://stage.playpickla.com/auth/callback`
6. Deploy all edge functions with `--no-verify-jwt`.
7. Configure Stripe test webhook to:
   - `https://<stage-project-ref>.supabase.co/functions/v1/api-stripe-webhook`
8. Seed a realistic venue:
   - one venue slug
   - courts/resources
   - opening hours
   - access products
   - activity series/sessions
   - Founder membership tier and benefits
   - display devices
   - one venue admin/staff user
   - two customer users

## Stage Rules

- Never copy real customer PII into stage.
- Never use production Stripe keys in stage.
- Never use stage links for customer-facing operations.
- Every release candidate should pass the smoke test on stage before prod deploy.

