-- Safe auth identity repair: auth.users -> player_profiles -> customers -> customer_identities.
--
-- This replaces the previously rejected repair plan with strict identity rules:
-- - exact auth matches win
-- - email can only attach to an unclaimed canonical customer
-- - merged customers are canonicalized before linking
-- - customers with another auth user / auth identity are skipped for manual review
-- - repeated runs do not churn updated_at
-- - no customer_venue_profiles are created here

CREATE OR REPLACE FUNCTION public.ensure_customer_identity_for_auth_user_safe(_auth_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  auth_row auth.users%ROWTYPE;
  default_org_id uuid;
  resolved_customer_id uuid;
  candidate_customer_id uuid;
  canonical_auth_user_id uuid;
  conflicting_auth_identity text;
  source_conflicting_auth_identity text;
  existing_auth_identity_customer_id uuid;
  existing_email_identity_customer_id uuid;
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
    RAISE EXCEPTION 'Identity repair requires existing organization slug=pickla. Refusing to guess organization scope.';
  END IF;

  email_norm := lower(NULLIF(trim(auth_row.email), ''));
  display := COALESCE(
    NULLIF(trim(auth_row.raw_user_meta_data ->> 'display_name'), ''),
    NULLIF(trim(auth_row.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(auth_row.raw_user_meta_data ->> 'name'), ''),
    NULLIF(trim(auth_row.email), ''),
    'Pickla player'
  );
  verified_at := COALESCE(auth_row.email_confirmed_at, auth_row.phone_confirmed_at, auth_row.last_sign_in_at);

  INSERT INTO public.player_profiles (auth_user_id, display_name)
  VALUES (auth_row.id, display)
  ON CONFLICT (auth_user_id) DO NOTHING;

  UPDATE public.player_profiles p
  SET display_name = display,
      updated_at = now()
  WHERE p.auth_user_id = auth_row.id
    AND NULLIF(p.display_name, '') IS NULL
    AND p.display_name IS DISTINCT FROM display;

  -- 1. Prefer exact auth match and canonicalize if that customer was merged.
  SELECT COALESCE(c.merged_into_id, c.id)
  INTO resolved_customer_id
  FROM public.customers c
  WHERE c.auth_user_id = auth_row.id
  ORDER BY (c.merged_into_id IS NULL) DESC, c.created_at ASC
  LIMIT 1;

  -- 2. Auth identity match, canonicalized.
  IF resolved_customer_id IS NULL THEN
    SELECT COALESCE(c.merged_into_id, c.id)
    INTO candidate_customer_id
    FROM public.customer_identities ci
    JOIN public.customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = default_org_id
      AND ci.provider = 'auth'
      AND ci.provider_id = auth_row.id::text
    LIMIT 1;

    IF candidate_customer_id IS NOT NULL THEN
      resolved_customer_id := candidate_customer_id;
    END IF;
  END IF;

  -- Validate any auth-based resolution before trying email.
  IF resolved_customer_id IS NOT NULL THEN
    SELECT c.auth_user_id
    INTO canonical_auth_user_id
    FROM public.customers c
    WHERE c.id = resolved_customer_id;

    SELECT ci.provider_id
    INTO conflicting_auth_identity
    FROM public.customer_identities ci
    JOIN public.customers identity_customer ON identity_customer.id = ci.customer_id
    WHERE COALESCE(identity_customer.merged_into_id, identity_customer.id) = resolved_customer_id
      AND ci.provider = 'auth'
      AND ci.provider_id IS NOT NULL
      AND ci.provider_id <> auth_row.id::text
    LIMIT 1;

    IF canonical_auth_user_id IS NOT NULL AND canonical_auth_user_id <> auth_row.id THEN
      RAISE NOTICE 'Identity repair skipped auth user % (%): canonical customer % already belongs to auth user %',
        auth_row.id, auth_row.email, resolved_customer_id, canonical_auth_user_id;
      RETURN NULL;
    END IF;

    IF conflicting_auth_identity IS NOT NULL THEN
      RAISE NOTICE 'Identity repair skipped auth user % (%): canonical customer % already has auth identity %',
        auth_row.id, auth_row.email, resolved_customer_id, conflicting_auth_identity;
      RETURN NULL;
    END IF;
  END IF;

  -- 3. Email identity match. Only safe if canonical customer is unclaimed or same auth user.
  IF resolved_customer_id IS NULL AND email_norm IS NOT NULL THEN
    SELECT COALESCE(c.merged_into_id, c.id)
    INTO candidate_customer_id
    FROM public.customer_identities ci
    JOIN public.customers c ON c.id = ci.customer_id
    WHERE ci.organization_id = default_org_id
      AND ci.provider = 'email'
      AND ci.provider_id = email_norm
    LIMIT 1;

    IF candidate_customer_id IS NOT NULL THEN
      SELECT c.auth_user_id
      INTO canonical_auth_user_id
      FROM public.customers c
      WHERE c.id = candidate_customer_id;

      SELECT ci.provider_id
      INTO conflicting_auth_identity
      FROM public.customer_identities ci
      JOIN public.customers identity_customer ON identity_customer.id = ci.customer_id
      WHERE COALESCE(identity_customer.merged_into_id, identity_customer.id) = candidate_customer_id
        AND ci.provider = 'auth'
        AND ci.provider_id IS NOT NULL
        AND ci.provider_id <> auth_row.id::text
      LIMIT 1;

      IF canonical_auth_user_id IS NOT NULL AND canonical_auth_user_id <> auth_row.id THEN
        RAISE NOTICE 'Identity repair skipped auth user % (%): email identity belongs to customer % with auth user %',
          auth_row.id, auth_row.email, candidate_customer_id, canonical_auth_user_id;
        RETURN NULL;
      ELSIF conflicting_auth_identity IS NOT NULL THEN
        RAISE NOTICE 'Identity repair skipped auth user % (%): email identity belongs to customer % with auth identity %',
          auth_row.id, auth_row.email, candidate_customer_id, conflicting_auth_identity;
        RETURN NULL;
      ELSE
        resolved_customer_id := candidate_customer_id;
      END IF;
    END IF;
  END IF;

  -- 4. Direct email customer match. Only an unmerged, unclaimed customer with no other auth identity.
  IF resolved_customer_id IS NULL AND email_norm IS NOT NULL THEN
    SELECT c.id
    INTO candidate_customer_id
    FROM public.customers c
    WHERE c.organization_id = default_org_id
      AND c.email_normalized = email_norm
      AND c.merged_into_id IS NULL
    LIMIT 1;

    IF candidate_customer_id IS NOT NULL THEN
      SELECT c.auth_user_id
      INTO canonical_auth_user_id
      FROM public.customers c
      WHERE c.id = candidate_customer_id;

      SELECT ci.provider_id
      INTO conflicting_auth_identity
      FROM public.customer_identities ci
      JOIN public.customers identity_customer ON identity_customer.id = ci.customer_id
      WHERE COALESCE(identity_customer.merged_into_id, identity_customer.id) = candidate_customer_id
        AND ci.provider = 'auth'
        AND ci.provider_id IS NOT NULL
        AND ci.provider_id <> auth_row.id::text
      LIMIT 1;

      IF canonical_auth_user_id IS NOT NULL AND canonical_auth_user_id <> auth_row.id THEN
        RAISE NOTICE 'Identity repair skipped auth user % (%): same-email customer % belongs to auth user %',
          auth_row.id, auth_row.email, candidate_customer_id, canonical_auth_user_id;
        RETURN NULL;
      ELSIF conflicting_auth_identity IS NOT NULL THEN
        RAISE NOTICE 'Identity repair skipped auth user % (%): same-email customer % has auth identity %',
          auth_row.id, auth_row.email, candidate_customer_id, conflicting_auth_identity;
        RETURN NULL;
      ELSE
        resolved_customer_id := candidate_customer_id;
      END IF;
    END IF;
  END IF;

  -- 5. Create only when no safe customer exists. Unique indexes protect auth/email uniqueness.
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
        jsonb_build_object('source', 'auth_user_identity_repair_safe')
      )
      RETURNING id INTO resolved_customer_id;
    EXCEPTION WHEN unique_violation THEN
      -- Race or pre-existing data. Re-resolve using safe rules only.
      SELECT c.id
      INTO candidate_customer_id
      FROM public.customers c
      WHERE c.auth_user_id = auth_row.id
      LIMIT 1;

      IF candidate_customer_id IS NOT NULL THEN
        SELECT COALESCE(c.merged_into_id, c.id)
        INTO resolved_customer_id
        FROM public.customers c
        WHERE c.id = candidate_customer_id;
      ELSIF email_norm IS NOT NULL THEN
        SELECT c.id
        INTO candidate_customer_id
        FROM public.customers c
        WHERE c.organization_id = default_org_id
          AND c.email_normalized = email_norm
          AND c.merged_into_id IS NULL
          AND (c.auth_user_id IS NULL OR c.auth_user_id = auth_row.id)
          AND NOT EXISTS (
            SELECT 1
            FROM public.customer_identities ci
            JOIN public.customers identity_customer ON identity_customer.id = ci.customer_id
            WHERE COALESCE(identity_customer.merged_into_id, identity_customer.id) = c.id
              AND ci.provider = 'auth'
              AND ci.provider_id IS NOT NULL
              AND ci.provider_id <> auth_row.id::text
          )
        LIMIT 1;

        resolved_customer_id := candidate_customer_id;
      END IF;

      IF resolved_customer_id IS NULL THEN
        RAISE NOTICE 'Identity repair skipped auth user % (%): unique conflict could not be safely resolved',
          auth_row.id, auth_row.email;
        RETURN NULL;
      END IF;
    END;
  END IF;

  -- Final safety check before attaching.
  SELECT c.auth_user_id
  INTO canonical_auth_user_id
  FROM public.customers c
  WHERE c.id = resolved_customer_id;

  SELECT ci.provider_id
  INTO conflicting_auth_identity
  FROM public.customer_identities ci
  JOIN public.customers identity_customer ON identity_customer.id = ci.customer_id
  WHERE COALESCE(identity_customer.merged_into_id, identity_customer.id) = resolved_customer_id
    AND ci.provider = 'auth'
    AND ci.provider_id IS NOT NULL
    AND ci.provider_id <> auth_row.id::text
  LIMIT 1;

  IF canonical_auth_user_id IS NOT NULL AND canonical_auth_user_id <> auth_row.id THEN
    RAISE NOTICE 'Identity repair skipped auth user % (%): final customer % belongs to auth user %',
      auth_row.id, auth_row.email, resolved_customer_id, canonical_auth_user_id;
    RETURN NULL;
  END IF;

  IF conflicting_auth_identity IS NOT NULL THEN
    RAISE NOTICE 'Identity repair skipped auth user % (%): final customer % already has auth identity %',
      auth_row.id, auth_row.email, resolved_customer_id, conflicting_auth_identity;
    RETURN NULL;
  END IF;

  UPDATE public.customers c
  SET auth_user_id = CASE
        WHEN c.auth_user_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.customers other
            WHERE other.auth_user_id = auth_row.id
              AND other.id <> c.id
          )
        THEN auth_row.id
        ELSE c.auth_user_id
      END,
      display_name = CASE WHEN NULLIF(c.display_name, '') IS NULL THEN display ELSE c.display_name END,
      primary_email = CASE WHEN NULLIF(c.primary_email, '') IS NULL THEN NULLIF(trim(auth_row.email), '') ELSE c.primary_email END,
      email_normalized = CASE WHEN NULLIF(c.email_normalized, '') IS NULL THEN email_norm ELSE c.email_normalized END,
      updated_at = now()
  WHERE c.id = resolved_customer_id
    AND (
      (
        c.auth_user_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.customers other
          WHERE other.auth_user_id = auth_row.id
            AND other.id <> c.id
        )
      )
      OR NULLIF(c.display_name, '') IS NULL
      OR NULLIF(c.primary_email, '') IS NULL
      OR NULLIF(c.email_normalized, '') IS NULL
    );

  UPDATE public.player_profiles p
  SET customer_id = resolved_customer_id,
      updated_at = now()
  WHERE p.auth_user_id = auth_row.id
    AND p.customer_id IS DISTINCT FROM resolved_customer_id;

  SELECT ci.customer_id
  INTO existing_auth_identity_customer_id
  FROM public.customer_identities ci
  WHERE ci.organization_id = default_org_id
    AND ci.provider = 'auth'
    AND ci.provider_id = auth_row.id::text
  LIMIT 1;

  IF existing_auth_identity_customer_id IS NULL THEN
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
      jsonb_build_object('source', 'auth.users.id', 'repair', '20260703123000')
    )
    ON CONFLICT (organization_id, provider, provider_id)
      WHERE provider_id IS NOT NULL
    DO NOTHING;
  ELSIF existing_auth_identity_customer_id <> resolved_customer_id THEN
    UPDATE public.customer_identities ci
    SET customer_id = resolved_customer_id,
        updated_at = now()
    WHERE ci.organization_id = default_org_id
      AND ci.provider = 'auth'
      AND ci.provider_id = auth_row.id::text
      AND ci.customer_id IS DISTINCT FROM resolved_customer_id;
  END IF;

  IF email_norm IS NOT NULL THEN
    SELECT ci.customer_id
    INTO existing_email_identity_customer_id
    FROM public.customer_identities ci
    WHERE ci.organization_id = default_org_id
      AND ci.provider = 'email'
      AND ci.provider_id = email_norm
    LIMIT 1;

    IF existing_email_identity_customer_id IS NULL THEN
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
        jsonb_build_object('source', 'auth.users.email', 'repair', '20260703123000')
      )
      ON CONFLICT (organization_id, provider, provider_id)
        WHERE provider_id IS NOT NULL
      DO NOTHING;
    ELSIF existing_email_identity_customer_id <> resolved_customer_id THEN
      SELECT c.auth_user_id
      INTO canonical_auth_user_id
      FROM public.customers source_customer
      JOIN public.customers c ON c.id = COALESCE(source_customer.merged_into_id, source_customer.id)
      WHERE source_customer.id = existing_email_identity_customer_id;

      SELECT ci.provider_id
      INTO source_conflicting_auth_identity
      FROM public.customers source_customer
      JOIN public.customers canonical_customer ON canonical_customer.id = COALESCE(source_customer.merged_into_id, source_customer.id)
      JOIN public.customers identity_customer
        ON COALESCE(identity_customer.merged_into_id, identity_customer.id) = canonical_customer.id
      JOIN public.customer_identities ci ON ci.customer_id = identity_customer.id
      WHERE source_customer.id = existing_email_identity_customer_id
        AND ci.provider = 'auth'
        AND ci.provider_id IS NOT NULL
        AND ci.provider_id <> auth_row.id::text
      LIMIT 1;

      IF (canonical_auth_user_id IS NULL OR canonical_auth_user_id = auth_row.id)
        AND source_conflicting_auth_identity IS NULL THEN
        UPDATE public.customer_identities ci
        SET customer_id = resolved_customer_id,
            email = COALESCE(ci.email, auth_row.email),
            updated_at = now()
        WHERE ci.organization_id = default_org_id
          AND ci.provider = 'email'
          AND ci.provider_id = email_norm
          AND ci.customer_id IS DISTINCT FROM resolved_customer_id;
      ELSE
        RAISE NOTICE 'Identity repair did not move email identity % for auth user %: existing customer belongs to auth user % or auth identity %',
          email_norm, auth_row.id, canonical_auth_user_id, source_conflicting_auth_identity;
      END IF;
    END IF;
  END IF;

  RETURN resolved_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_customer_identity_for_auth_user_safe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_customer_identity_for_auth_user_safe(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.ensure_customer_identity_for_auth_user_safe(NEW.id);

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
  default_org_id uuid;
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
  SELECT id
  INTO default_org_id
  FROM public.organizations
  WHERE slug = 'pickla'
  LIMIT 1;

  IF default_org_id IS NULL THEN
    RAISE EXCEPTION 'Identity repair requires existing organization slug=pickla. Refusing to guess organization scope.';
  END IF;

  SELECT count(*)
  INTO before_without_profiles
  FROM auth.users u
  LEFT JOIN public.player_profiles p ON p.auth_user_id = u.id
  WHERE p.id IS NULL
    AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL);

  SELECT count(*)
  INTO before_without_customers
  FROM auth.users u
  WHERE (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.organization_id = default_org_id
        AND c.auth_user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_identities ci
      WHERE ci.organization_id = default_org_id
        AND ci.provider = 'auth'
        AND ci.provider_id = u.id::text
    );

  SELECT count(*)
  INTO before_profiles_without_customer
  FROM public.player_profiles p
  JOIN auth.users u ON u.id = p.auth_user_id
  WHERE p.customer_id IS NULL
    AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL);

  SELECT count(*)
  INTO before_customers_without_identity
  FROM public.customers c
  WHERE c.organization_id = default_org_id
    AND c.merged_into_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_identities ci
      JOIN public.customers identity_customer ON identity_customer.id = ci.customer_id
      WHERE ci.organization_id = default_org_id
        AND COALESCE(identity_customer.merged_into_id, identity_customer.id) = c.id
        AND ci.provider IN ('auth', 'email')
    );

  RAISE NOTICE 'Before safe identity repair: auth users without player_profiles=%, auth users without resolvable customers=%, player_profiles without customer_id=%, canonical customers without auth/email identity=%',
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
    PERFORM public.ensure_customer_identity_for_auth_user_safe(auth_row.id);
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
  WHERE (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.organization_id = default_org_id
        AND c.auth_user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_identities ci
      WHERE ci.organization_id = default_org_id
        AND ci.provider = 'auth'
        AND ci.provider_id = u.id::text
    );

  SELECT count(*)
  INTO after_profiles_without_customer
  FROM public.player_profiles p
  JOIN auth.users u ON u.id = p.auth_user_id
  WHERE p.customer_id IS NULL
    AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL);

  SELECT count(*)
  INTO after_customers_without_identity
  FROM public.customers c
  WHERE c.organization_id = default_org_id
    AND c.merged_into_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_identities ci
      JOIN public.customers identity_customer ON identity_customer.id = ci.customer_id
      WHERE ci.organization_id = default_org_id
        AND COALESCE(identity_customer.merged_into_id, identity_customer.id) = c.id
        AND ci.provider IN ('auth', 'email')
    );

  RAISE NOTICE 'After safe identity repair: auth users without player_profiles=%, auth users without resolvable customers=%, player_profiles without customer_id=%, canonical customers without auth/email identity=%',
    after_without_profiles,
    after_without_customers,
    after_profiles_without_customer,
    after_customers_without_identity;
END $$;

-- No customer_venue_profiles are created here.
-- There is no canonical default venue policy for arbitrary auth.users in code.
-- Venue profiles must be repaired separately from explicit signals such as
-- bookings, memberships, day passes, check-ins, receipts, or a chosen venue.

-- After applying manually, run:
-- NOTIFY pgrst, 'reload schema';
