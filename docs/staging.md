# Stage Environment

> Status: active, isolated, persistent stage environment.

Stage is isolated from production. Never point stage or local payment tests at the production Supabase project, production Stripe account mode, or production customer data.

## Canonical Identity

- **Frontend:** `https://stage.playpickla.com`
- **Supabase branch:** `stage` (persistent)
- **Supabase project ref:** `anpxxnpevtxhiajxmfji`
- **Stripe:** TEST mode only
- **Data:** synthetic stage data only; never copy production customer PII

Production Supabase project ref is `ptnvhbniiiapzbyofctg`. It must never be used for stage migrations, function deployments, seeds, or payment tests.

## Runtime Contract

The stage frontend must resolve to the stage ref in its deployed environment:

```bash
VITE_SUPABASE_URL=https://anpxxnpevtxhiajxmfji.supabase.co
VITE_SUPABASE_PROJECT_ID=anpxxnpevtxhiajxmfji
VITE_PICKLA_ENVIRONMENT=stage
```

Secret values are managed in the stage projects and must not be committed or printed. Required stage-only backend secrets include Stripe TEST credentials, the stage webhook signing secret, recovery authentication, and `PICKLA_ENVIRONMENT=stage`. `PUBLIC_SITE_URL` must use the canonical stage origin.

Environment guards must reject a stage/live mismatch: the stage ref may use only Stripe TEST, and the production ref may use only Stripe live. Webhook events must also match the configured provider mode.

## Stripe TEST Webhook

The active stage-only destination is:

```text
https://anpxxnpevtxhiajxmfji.supabase.co/functions/v1/api-stripe-webhook
```

Verify in the Stripe Dashboard that the account is in TEST/sandbox mode, this destination is active, deliveries succeed, and no stage event is sent to the production endpoint.

## Maintenance

Do not create a replacement stage project while this persistent branch is healthy.

For a release candidate:

1. Verify the branch identity and migration ledger before mutation.
2. Apply only reviewed forward migrations; never reset or rewrite stage history.
3. Deploy only functions changed by the candidate, always with `--no-verify-jwt`.
4. Confirm `https://stage.playpickla.com/api/release` and deployed environment point to `anpxxnpevtxhiajxmfji`.
5. Run provider, recovery, smoke, PWA, CORS, and UI checks with synthetic identities.
6. Record migration counts, schema fingerprint, function version/hash, and Stripe TEST evidence.

The guarded deployment helper remains available:

```bash
scripts/deploy-stage-functions.sh anpxxnpevtxhiajxmfji
```

## Recovery Authentication

Recovery endpoints are authenticated stage operations. Verify both sides of the contract:

- unauthenticated requests are rejected;
- the configured stage recovery credential is accepted;
- secrets are never printed, committed, copied to frontend variables, or reused in production.

## Verification Checklist

- `stage.playpickla.com` resolves and uses the canonical stage origin.
- Supabase ref is exactly `anpxxnpevtxhiajxmfji`.
- Stripe Dashboard visibly shows TEST/sandbox mode.
- The active webhook URL is the stage function URL above.
- Migration ledger has unique versions and matches the reviewed candidate chain.
- Relevant Edge Functions have `verify_jwt=false`; authentication is handled explicitly by the functions.
- Recovery authentication rejects unauthenticated requests and accepts the stage credential.
- No production customer email, phone number, payment ID, Stripe customer ID, or other PII exists in stage.
- Production remains read-only during stage certification.

## Stage Seed

`supabase/seed.stage.sql` contains synthetic baseline data for local or stage setup. Treat it as additive setup material, not authority to reset the persistent stage database. Auth users are created separately in Supabase Auth and may then be linked by rerunning the relevant idempotent seed sections.
