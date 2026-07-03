-- Urgent identity repair: auth.users -> player_profiles -> customers -> customer_identities.
--
-- Why:
-- The original auth trigger public.handle_new_user() only created player_profiles
-- and user_roles. After Foundation Phase 1B introduced Customer Master, that
-- trigger did not create customers/customer_identities. Some auth.users also
-- have no player_profiles at all, which makes confirmed users invisible to
-- Desk/Admin and prevents clean customer-scoped operations.
--
-- This migration is idempotent:
-- - no name guessing
-- - no membership changes
-- - no Stripe changes
-- - no venue profile creation for auth-only users without an explicit venue signal

CREATE OR REPLACE FUNCTION public.ensure_customer_identity_for_auth_user(_auth_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  auth_row auth.users%ROWTYPE;
  default_org_id uuid;
  resolved_customer_id uuid;
  resolved_profile_id uuid;
  email_norm text;
  display text;
  verified_at timestamptz;
BEGIN
  SELECT *
  INTO auth_row
  FROM auth.users
  WHERE id = _auth_user_id;

  IF auth_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id
  INTO default_org_id
  FROM public.organizations
  WHERE slug = 'pickla'
  LIMIT 1;

  IF default_org_id IS NULL THEN
    SELECT id
    INTO default_org_id
    FROM public.organizations
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF default_org_id IS NULL THEN
    INSERT INTO public.organizations (name, slug, legal_name, org_number, settings)
    VALUES ('Pickla', 'pickla', 'Pickla Solna AB', '556977-4481', '{"source":"identity_repair_fallback"}'::jsonb)
    ON CONFLICT (slug) DO UPDATE SET updated_at = now()
    RETURNING id INTO default_org_id;
  END IF;

  email_norm := lower(NULLIF(trim(auth_row.email), ''));
  display := COALESCE(
    NULLIF(trim(auth_row.raw_user_meta_data ->> 'display_name'), ''),
    NULLIF(trim(auth_row.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(auth_row.raw_user_meta_data ->> 'name'), ''),
    NULLIF(trim(auth_row.email), ''),
    'Pickla player'
  );
  verified_at := COALESCE(auth_row.email_confirmed_at, auth_row.phone_confirmed_at, auth_row.last_sign_in_at, now());

  INSERT INTO public.player_profiles (auth_user_id, display_name)
  VALUES (auth_row.id, display)
  ON CONFLICT (auth_user_id) DO UPDATE
    SET display_name = COALESCE(NULLIF(public.player_profiles.display_name, ''), EXCLUDED.display_name),
        updated_at = now()
  RETURNING id INTO resolved_profile_id;

  SELECT c.id
  INTO resolved_customer_id
  FROM public.customers c
  WHERE c.auth_user_id = auth_row.id
  LIMIT 1;

  IF resolved_customer_id IS NULL THEN
    SELECT ci.customer_id
    INTO resolved_customer_id
    FROM public.customer_identities ci
    WHERE ci.organization_id = default_org_id
      AND ci.provider = 'auth'
      AND ci.provider_id = auth_row.id::text
    LIMIT 1;
  END IF;

  IF resolved_customer_id IS NULL AND email_norm IS NOT NULL THEN
    SELECT ci.customer_id
    INTO resolved_customer_id
    FROM public.customer_identities ci
    WHERE ci.organization_id = default_org_id
      AND ci.provider = 'email'
      AND ci.provider_id = email_norm
    LIMIT 1;
  END IF;

  IF resolved_customer_id IS NULL AND email_norm IS NOT NULL THEN
    SELECT c.id
    INTO resolved_customer_id
    FROM public.customers c
    WHERE c.organization_id = default_org_id
      AND c.email_normalized = email_norm
      AND c.merged_into_id IS NULL
    LIMIT 1;
  END IF;

  IF resolved_customer_id IS NULL THEN
    BEGIN
      INSERT INTO public.customers (
        organization_id,
        auth_user_id,
        display_name,
        primary_email,
        email_normalized,
        status,
        metadata
      )
      VALUES (
        default_org_id,
        auth_row.id,
        display,
        NULLIF(trim(auth_row.email), ''),
        email_norm,
        'active',
        jsonb_build_object('source', 'auth_user_identity_repair')
      )
      RETURNING id INTO resolved_customer_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT c.id
      INTO resolved_customer_id
      FROM public.customers c
      WHERE c.auth_user_id = auth_row.id
         OR (
           email_norm IS NOT NULL
           AND c.organization_id = default_org_id
           AND c.email_normalized = email_norm
           AND c.merged_into_id IS NULL
         )
      LIMIT 1;
    END;
  END IF;

  IF resolved_customer_id IS NOT NULL THEN
    UPDATE public.customers c
    SET auth_user_id = COALESCE(c.auth_user_id, auth_row.id),
        display_name = COALESCE(NULLIF(c.display_name, ''), display),
        primary_email = COALESCE(NULLIF(c.primary_email, ''), NULLIF(trim(auth_row.email), '')),
        email_normalized = COALESCE(NULLIF(c.email_normalized, ''), email_norm),
        updated_at = now()
    WHERE c.id = resolved_customer_id;

    UPDATE public.player_profiles p
    SET customer_id = resolved_customer_id,
        updated_at = now()
    WHERE p.auth_user_id = auth_row.id
      AND (p.customer_id IS NULL OR p.customer_id = resolved_customer_id);

    INSERT INTO public.customer_identities (
      customer_id,
      organization_id,
      provider,
      provider_id,
      verified_at,
      metadata
    )
    VALUES (
      resolved_customer_id,
      default_org_id,
      'auth',
      auth_row.id::text,
      verified_at,
      jsonb_build_object('source', 'auth.users.id', 'repair', '20260703122000')
    )
    ON CONFLICT (organization_id, provider, provider_id)
      WHERE provider_id IS NOT NULL
    DO NOTHING;

    IF email_norm IS NOT NULL THEN
      INSERT INTO public.customer_identities (
        customer_id,
        organization_id,
        provider,
        provider_id,
        email,
        verified_at,
        metadata
      )
      VALUES (
        resolved_customer_id,
        default_org_id,
        'email',
        email_norm,
        auth_row.email,
        auth_row.email_confirmed_at,
        jsonb_build_object('source', 'auth.users.email', 'repair', '20260703122000')
      )
      ON CONFLICT (organization_id, provider, provider_id)
        WHERE provider_id IS NOT NULL
      DO NOTHING;
    END IF;
  END IF;

  RETURN resolved_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_customer_identity_for_auth_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_customer_identity_for_auth_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.ensure_customer_identity_for_auth_user(NEW.id);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DO $$
DECLARE
  before_without_profiles integer;
  before_without_customers integer;
  before_profiles_without_customer integer;
  before_customers_without_identity integer;
  after_without_profiles integer;
  after_without_customers integer;
  after_profiles_without_customer integer;
  after_customers_without_identity integer;
  auth_row record;
BEGIN
  SELECT count(*)
  INTO before_without_profiles
  FROM auth.users u
  LEFT JOIN public.player_profiles p ON p.auth_user_id = u.id
  WHERE p.id IS NULL
    AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL);

  SELECT count(*)
  INTO before_without_customers
  FROM auth.users u
  LEFT JOIN public.customers c ON c.auth_user_id = u.id
  WHERE c.id IS NULL
    AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL);

  SELECT count(*)
  INTO before_profiles_without_customer
  FROM public.player_profiles
  WHERE customer_id IS NULL;

  SELECT count(*)
  INTO before_customers_without_identity
  FROM public.customers c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.customer_identities ci
    WHERE ci.customer_id = c.id
      AND ci.provider IN ('auth', 'email')
  );

  RAISE NOTICE 'Before identity repair: auth users without player_profiles=%, auth users without customers=%, player_profiles without customer_id=%, customers without auth/email identity=%',
    before_without_profiles,
    before_without_customers,
    before_profiles_without_customer,
    before_customers_without_identity;

  FOR auth_row IN
    SELECT u.id
    FROM auth.users u
    WHERE u.email_confirmed_at IS NOT NULL
       OR u.phone_confirmed_at IS NOT NULL
       OR u.last_sign_in_at IS NOT NULL
  LOOP
    PERFORM public.ensure_customer_identity_for_auth_user(auth_row.id);
  END LOOP;

  SELECT count(*)
  INTO after_without_profiles
  FROM auth.users u
  LEFT JOIN public.player_profiles p ON p.auth_user_id = u.id
  WHERE p.id IS NULL
    AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL);

  SELECT count(*)
  INTO after_without_customers
  FROM auth.users u
  LEFT JOIN public.customers c ON c.auth_user_id = u.id
  WHERE c.id IS NULL
    AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL);

  SELECT count(*)
  INTO after_profiles_without_customer
  FROM public.player_profiles
  WHERE customer_id IS NULL;

  SELECT count(*)
  INTO after_customers_without_identity
  FROM public.customers c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.customer_identities ci
    WHERE ci.customer_id = c.id
      AND ci.provider IN ('auth', 'email')
  );

  RAISE NOTICE 'After identity repair: auth users without player_profiles=%, auth users without customers=%, player_profiles without customer_id=%, customers without auth/email identity=%',
    after_without_profiles,
    after_without_customers,
    after_profiles_without_customer,
    after_customers_without_identity;
END $$;

-- No customer_venue_profiles are created here for auth-only users.
-- There is no canonical default venue policy for arbitrary auth.users in code.
-- Venue profiles must be repaired separately from explicit signals such as
-- bookings, memberships, day passes, check-ins, receipts, or a chosen venue.

-- After applying manually, run:
-- NOTIFY pgrst, 'reload schema';
