-- Course V1: Format -> Series -> Session and Series -> Series Commitment.
--
-- The commitment is the durable commercial participation truth. Concrete
-- session_registrations remain an idempotent operational projection used by
-- Desk, Operations Week and the existing check-in machinery.

CREATE TABLE public.activity_formats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  age_group TEXT NOT NULL DEFAULT 'adult',
  level TEXT NOT NULL DEFAULT 'beginner',
  requires_instructor BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT activity_formats_name_not_blank CHECK (NULLIF(BTRIM(name), '') IS NOT NULL),
  CONSTRAINT activity_formats_age_group_check CHECK (age_group IN ('adult', 'youth', 'all_ages')),
  CONSTRAINT activity_formats_level_check CHECK (level IN ('intro', 'beginner', 'intermediate', 'advanced'))
);

CREATE UNIQUE INDEX idx_activity_formats_identity
  ON public.activity_formats (organization_id, lower(BTRIM(name)), age_group, level)
  WHERE is_active = true;

CREATE TRIGGER trg_activity_formats_updated_at
BEFORE UPDATE ON public.activity_formats
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.activity_formats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active activity formats"
  ON public.activity_formats FOR SELECT
  USING (
    is_active = true
    OR public.is_organization_member(auth.uid(), organization_id)
    OR public.is_super_admin()
  );

CREATE POLICY "Organization staff manage activity formats"
  ON public.activity_formats TO authenticated
  USING (
    public.is_organization_member(auth.uid(), organization_id)
    OR public.is_super_admin()
  )
  WITH CHECK (
    public.is_organization_member(auth.uid(), organization_id)
    OR public.is_super_admin()
  );

GRANT SELECT ON public.activity_formats TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.activity_formats TO authenticated;
GRANT ALL ON public.activity_formats TO service_role;

ALTER TABLE public.activity_series
  ADD COLUMN format_id UUID REFERENCES public.activity_formats(id) ON DELETE RESTRICT,
  ADD COLUMN registration_opens_at TIMESTAMPTZ,
  ADD COLUMN registration_closes_at TIMESTAMPTZ,
  ADD COLUMN capacity INTEGER,
  ADD COLUMN access_product_id UUID REFERENCES public.access_products(id) ON DELETE RESTRICT,
  ADD COLUMN recurrence_days INTEGER[],
  ADD COLUMN start_time TIME,
  ADD COLUMN end_time TIME,
  ADD COLUMN court_ids UUID[] NOT NULL DEFAULT '{}'::UUID[];

ALTER TABLE public.activity_series
  ADD CONSTRAINT activity_series_capacity_positive
    CHECK (capacity IS NULL OR capacity > 0) NOT VALID,
  ADD CONSTRAINT activity_series_registration_window_order
    CHECK (
      registration_opens_at IS NULL
      OR registration_closes_at IS NULL
      OR registration_closes_at > registration_opens_at
    ) NOT VALID,
  ADD CONSTRAINT activity_series_course_time_order
    CHECK (
      series_type <> 'course'
      OR (
        start_time IS NOT NULL
        AND end_time IS NOT NULL
        AND end_time > start_time
      )
    ) NOT VALID,
  ADD CONSTRAINT activity_series_course_dates_order
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date) NOT VALID;

ALTER TABLE public.activity_series VALIDATE CONSTRAINT activity_series_capacity_positive;
ALTER TABLE public.activity_series VALIDATE CONSTRAINT activity_series_registration_window_order;
ALTER TABLE public.activity_series VALIDATE CONSTRAINT activity_series_course_time_order;
ALTER TABLE public.activity_series VALIDATE CONSTRAINT activity_series_course_dates_order;

COMMENT ON COLUMN public.activity_series.capacity IS
  'Sellable Series capacity. It is independent of physical court capacity.';
COMMENT ON COLUMN public.activity_series.recurrence_days IS
  'Series schedule definition using PostgreSQL day-of-week numbers (Sunday 0). Concrete Course occurrences are generated as activity_sessions.';

ALTER TABLE public.activity_sessions
  ADD COLUMN closed_to_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN series_occurrence_index INTEGER;

ALTER TABLE public.activity_sessions
  ADD CONSTRAINT activity_sessions_series_occurrence_index_positive
    CHECK (series_occurrence_index IS NULL OR series_occurrence_index > 0) NOT VALID;
ALTER TABLE public.activity_sessions
  VALIDATE CONSTRAINT activity_sessions_series_occurrence_index_positive;

CREATE UNIQUE INDEX idx_activity_sessions_series_occurrence
  ON public.activity_sessions (series_id, series_occurrence_index)
  WHERE series_id IS NOT NULL AND series_occurrence_index IS NOT NULL;

COMMENT ON COLUMN public.activity_sessions.closed_to_public IS
  'Prevents a concrete occurrence from being purchased independently. Course Sessions are true so the Series remains the sellable object.';

-- Tighten the existing public activity boundary. Staff retain the same access;
-- closed Course occurrences remain available to operational projections only.
DROP POLICY IF EXISTS "Public can read active activity sessions" ON public.activity_sessions;
CREATE POLICY "Public can read active activity sessions"
  ON public.activity_sessions FOR SELECT
  USING (
    (is_active = true AND closed_to_public = false)
    OR public.is_venue_member(auth.uid(), venue_id)
    OR public.is_super_admin()
  );

CREATE TABLE public.dependent_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  guardian_customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL,
  birth_year SMALLINT,
  operational_note TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dependent_participants_first_name_not_blank CHECK (NULLIF(BTRIM(first_name), '') IS NOT NULL),
  CONSTRAINT dependent_participants_birth_year_check CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2200),
  CONSTRAINT dependent_participants_status_check CHECK (status IN ('active', 'archived'))
);

CREATE UNIQUE INDEX idx_dependent_participants_guardian_identity
  ON public.dependent_participants (
    guardian_customer_id,
    lower(BTRIM(first_name)),
    COALESCE(birth_year, 0)
  )
  WHERE status = 'active';

CREATE INDEX idx_dependent_participants_guardian
  ON public.dependent_participants (guardian_customer_id, status);

CREATE OR REPLACE FUNCTION public.enforce_dependent_participant_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_guardian_organization_id UUID;
BEGIN
  SELECT organization_id INTO v_guardian_organization_id
  FROM public.customers
  WHERE id = NEW.guardian_customer_id
    AND status = 'active'
    AND merged_into_id IS NULL;
  IF v_guardian_organization_id IS NULL THEN
    RAISE EXCEPTION 'dependent_guardian_not_active';
  END IF;
  IF v_guardian_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'dependent_guardian_organization_mismatch';
  END IF;
  NEW.first_name := BTRIM(NEW.first_name);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dependent_participant_boundary
BEFORE INSERT OR UPDATE ON public.dependent_participants
FOR EACH ROW EXECUTE FUNCTION public.enforce_dependent_participant_boundary();

ALTER TABLE public.dependent_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Guardians and staff read dependent participants"
  ON public.dependent_participants FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customers guardian
      WHERE guardian.id = guardian_customer_id
        AND guardian.auth_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.venues venue
      WHERE venue.organization_id = dependent_participants.organization_id
        AND public.is_venue_member(auth.uid(), venue.id)
    )
    OR public.is_super_admin()
  );

CREATE POLICY "Guardians manage own dependent participants"
  ON public.dependent_participants TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customers guardian
      WHERE guardian.id = guardian_customer_id
        AND guardian.auth_user_id = auth.uid()
    )
    OR public.is_super_admin()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers guardian
      WHERE guardian.id = guardian_customer_id
        AND guardian.auth_user_id = auth.uid()
    )
    OR public.is_super_admin()
  );

GRANT SELECT, INSERT, UPDATE ON public.dependent_participants TO authenticated;
GRANT ALL ON public.dependent_participants TO service_role;

CREATE TABLE public.series_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  activity_series_id UUID NOT NULL REFERENCES public.activity_series(id) ON DELETE RESTRICT,
  commitment_type TEXT NOT NULL DEFAULT 'participant',
  participant_customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  dependent_participant_id UUID REFERENCES public.dependent_participants(id) ON DELETE RESTRICT,
  payer_customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  commerce_order_id UUID REFERENCES public.commerce_orders(id) ON DELETE RESTRICT,
  commerce_order_line_id UUID REFERENCES public.commerce_order_lines(id) ON DELETE RESTRICT,
  access_entitlement_id UUID REFERENCES public.access_entitlements(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  activated_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT series_commitments_type_check CHECK (commitment_type IN ('participant', 'resource')),
  CONSTRAINT series_commitments_status_check CHECK (status IN ('pending', 'active', 'cancelled', 'completed')),
  CONSTRAINT series_commitments_carrier_check CHECK (
    (commitment_type = 'participant' AND num_nonnulls(participant_customer_id, dependent_participant_id) = 1)
    OR (commitment_type = 'resource' AND participant_customer_id IS NULL AND dependent_participant_id IS NULL)
  ),
  CONSTRAINT series_commitments_activation_check CHECK (
    status <> 'active' OR activated_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX idx_series_commitments_active_customer
  ON public.series_commitments (activity_series_id, participant_customer_id)
  WHERE commitment_type = 'participant' AND status = 'active' AND participant_customer_id IS NOT NULL;

CREATE UNIQUE INDEX idx_series_commitments_active_dependent
  ON public.series_commitments (activity_series_id, dependent_participant_id)
  WHERE commitment_type = 'participant' AND status = 'active' AND dependent_participant_id IS NOT NULL;

CREATE UNIQUE INDEX idx_series_commitments_order_line
  ON public.series_commitments (commerce_order_line_id)
  WHERE commerce_order_line_id IS NOT NULL;

CREATE INDEX idx_series_commitments_series_status
  ON public.series_commitments (activity_series_id, status, activated_at);

COMMENT ON TABLE public.series_commitments IS
  'Canonical durable place/commitment in a Series. Never stores a copied list of Session IDs or price/payment truth.';

CREATE OR REPLACE FUNCTION public.enforce_series_commitment_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series RECORD;
  v_participant_organization_id UUID;
  v_dependent_organization_id UUID;
  v_payer_organization_id UUID;
BEGIN
  SELECT series.venue_id, venue.organization_id, series.series_type
  INTO v_series
  FROM public.activity_series series
  JOIN public.venues venue ON venue.id = series.venue_id
  WHERE series.id = NEW.activity_series_id;
  IF v_series.venue_id IS NULL THEN RAISE EXCEPTION 'series_commitment_series_missing'; END IF;
  IF NEW.venue_id <> v_series.venue_id OR NEW.organization_id <> v_series.organization_id THEN
    RAISE EXCEPTION 'series_commitment_scope_mismatch';
  END IF;

  IF NEW.participant_customer_id IS NOT NULL THEN
    SELECT organization_id INTO v_participant_organization_id
    FROM public.customers
    WHERE id = NEW.participant_customer_id AND status = 'active' AND merged_into_id IS NULL;
    IF v_participant_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'series_commitment_participant_scope_mismatch';
    END IF;
  END IF;
  IF NEW.dependent_participant_id IS NOT NULL THEN
    SELECT organization_id INTO v_dependent_organization_id
    FROM public.dependent_participants
    WHERE id = NEW.dependent_participant_id AND status = 'active';
    IF v_dependent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'series_commitment_dependent_scope_mismatch';
    END IF;
  END IF;
  IF NEW.payer_customer_id IS NOT NULL THEN
    SELECT organization_id INTO v_payer_organization_id
    FROM public.customers
    WHERE id = NEW.payer_customer_id AND status = 'active' AND merged_into_id IS NULL;
    IF v_payer_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'series_commitment_payer_scope_mismatch';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_series_commitment_boundary
BEFORE INSERT OR UPDATE ON public.series_commitments
FOR EACH ROW EXECUTE FUNCTION public.enforce_series_commitment_boundary();

ALTER TABLE public.series_commitments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers manage own series commitments"
  ON public.series_commitments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customers customer
      WHERE customer.auth_user_id = auth.uid()
        AND customer.id IN (participant_customer_id, payer_customer_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.dependent_participants dependent
      JOIN public.customers guardian ON guardian.id = dependent.guardian_customer_id
      WHERE dependent.id = dependent_participant_id
        AND guardian.auth_user_id = auth.uid()
    )
    OR public.is_venue_member(auth.uid(), venue_id)
    OR public.is_super_admin()
  );

CREATE POLICY "Venue staff manage series commitments"
  ON public.series_commitments TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

GRANT SELECT ON public.series_commitments TO authenticated;
GRANT INSERT, UPDATE ON public.series_commitments TO authenticated;
GRANT ALL ON public.series_commitments TO service_role;

ALTER TABLE public.session_registrations
  ADD COLUMN dependent_participant_id UUID REFERENCES public.dependent_participants(id) ON DELETE RESTRICT,
  ADD COLUMN series_commitment_id UUID REFERENCES public.series_commitments(id) ON DELETE CASCADE;

ALTER TABLE public.session_registrations
  DROP CONSTRAINT IF EXISTS session_registrations_owner_required;
ALTER TABLE public.session_registrations
  ADD CONSTRAINT session_registrations_owner_required
  CHECK (num_nonnulls(user_id, customer_id, dependent_participant_id) > 0) NOT VALID;
ALTER TABLE public.session_registrations VALIDATE CONSTRAINT session_registrations_owner_required;

CREATE UNIQUE INDEX idx_session_registrations_series_commitment
  ON public.session_registrations (activity_session_id, series_commitment_id)
  WHERE series_commitment_id IS NOT NULL;

ALTER TABLE public.venue_checkins
  ADD COLUMN dependent_participant_id UUID REFERENCES public.dependent_participants(id) ON DELETE SET NULL;

CREATE INDEX idx_venue_checkins_dependent
  ON public.venue_checkins (dependent_participant_id, session_date)
  WHERE dependent_participant_id IS NOT NULL;

ALTER TABLE public.commerce_order_lines
  ADD COLUMN activity_series_id UUID REFERENCES public.activity_series(id) ON DELETE SET NULL,
  ADD COLUMN series_commitment_id UUID REFERENCES public.series_commitments(id) ON DELETE SET NULL,
  ADD COLUMN dependent_participant_id UUID REFERENCES public.dependent_participants(id) ON DELETE SET NULL;

CREATE INDEX idx_commerce_order_lines_activity_series
  ON public.commerce_order_lines (activity_series_id)
  WHERE activity_series_id IS NOT NULL;

ALTER TABLE public.access_products
  DROP CONSTRAINT IF EXISTS access_products_kind_check;
ALTER TABLE public.access_products
  ADD CONSTRAINT access_products_kind_check CHECK (product_kind IN (
    'day_access', 'session_ticket', 'session_with_day_access', 'voucher',
    'membership', 'rental', 'merchandise', 'series_access'
  ));

ALTER TABLE public.access_entitlements
  ADD COLUMN dependent_participant_id UUID REFERENCES public.dependent_participants(id) ON DELETE RESTRICT;

ALTER TABLE public.access_entitlements
  DROP CONSTRAINT IF EXISTS access_entitlements_owner_required,
  DROP CONSTRAINT IF EXISTS access_entitlements_canonical_required,
  DROP CONSTRAINT IF EXISTS access_entitlements_type_check;

ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_owner_required
    CHECK (num_nonnulls(user_id, customer_id, dependent_participant_id) > 0) NOT VALID,
  ADD CONSTRAINT access_entitlements_canonical_required
    CHECK (
      model_version = 1 OR (
        num_nonnulls(customer_id, dependent_participant_id) = 1
        AND scope_type IS NOT NULL
        AND meter_type IS NOT NULL
        AND funding_type IS NOT NULL
        AND NULLIF(BTRIM(access_reason), '') IS NOT NULL
      )
    ) NOT VALID,
  ADD CONSTRAINT access_entitlements_type_check CHECK (entitlement_type IN (
    'day_access', 'session_ticket', 'membership_access', 'booking_access',
    'punch_card', 'partner_access', 'series_access'
  )) NOT VALID;

ALTER TABLE public.access_entitlements VALIDATE CONSTRAINT access_entitlements_owner_required;
ALTER TABLE public.access_entitlements VALIDATE CONSTRAINT access_entitlements_canonical_required;
ALTER TABLE public.access_entitlements VALIDATE CONSTRAINT access_entitlements_type_check;

CREATE INDEX idx_access_entitlements_dependent_active
  ON public.access_entitlements (venue_id, dependent_participant_id, status)
  WHERE dependent_participant_id IS NOT NULL;

DROP POLICY IF EXISTS "Users read own access entitlements" ON public.access_entitlements;
CREATE POLICY "Users read own access entitlements"
  ON public.access_entitlements FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.customers customer
      WHERE customer.id = access_entitlements.customer_id
        AND customer.auth_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.dependent_participants dependent
      JOIN public.customers guardian ON guardian.id = dependent.guardian_customer_id
      WHERE dependent.id = access_entitlements.dependent_participant_id
        AND guardian.auth_user_id = auth.uid()
    )
    OR public.is_venue_member(auth.uid(), venue_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Users and staff read entitlement scopes" ON public.access_entitlement_scopes;
CREATE POLICY "Users and staff read entitlement scopes"
  ON public.access_entitlement_scopes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.access_entitlements entitlement
      WHERE entitlement.id = access_entitlement_scopes.entitlement_id
        AND (
          entitlement.user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.customers customer
            WHERE customer.id = entitlement.customer_id
              AND customer.auth_user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1
            FROM public.dependent_participants dependent
            JOIN public.customers guardian ON guardian.id = dependent.guardian_customer_id
            WHERE dependent.id = entitlement.dependent_participant_id
              AND guardian.auth_user_id = auth.uid()
          )
          OR public.is_venue_member(auth.uid(), entitlement.venue_id)
          OR public.is_super_admin()
        )
    )
  );

-- Extend the canonical entitlement boundary so a subordinate participant is a
-- valid right holder without creating an adult auth/social Customer identity.
CREATE OR REPLACE FUNCTION public.enforce_access_entitlement_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id UUID;
  v_customer_organization_id UUID;
  v_customer_user_id UUID;
  v_dependent_organization_id UUID;
BEGIN
  SELECT organization_id INTO v_organization_id
  FROM public.venues WHERE id = NEW.venue_id;
  IF v_organization_id IS NULL THEN RAISE EXCEPTION 'entitlement_venue_missing_organization'; END IF;

  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := v_organization_id;
  ELSIF NEW.organization_id <> v_organization_id THEN
    RAISE EXCEPTION 'entitlement_organization_mismatch';
  END IF;

  IF NEW.dependent_participant_id IS NOT NULL AND (NEW.customer_id IS NOT NULL OR NEW.user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'entitlement_owner_ambiguous';
  END IF;

  IF NEW.customer_id IS NULL AND NEW.dependent_participant_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT c.id INTO NEW.customer_id
    FROM public.customers c
    WHERE c.organization_id = v_organization_id
      AND c.auth_user_id = NEW.user_id
      AND c.status = 'active'
      AND c.merged_into_id IS NULL
    LIMIT 1;
    IF NEW.customer_id IS NULL THEN
      SELECT pp.customer_id INTO NEW.customer_id
      FROM public.player_profiles pp
      JOIN public.customers c ON c.id = pp.customer_id
      WHERE pp.auth_user_id = NEW.user_id
        AND c.organization_id = v_organization_id
        AND c.status = 'active'
        AND c.merged_into_id IS NULL
      LIMIT 1;
    END IF;
  END IF;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT organization_id, auth_user_id
    INTO v_customer_organization_id, v_customer_user_id
    FROM public.customers
    WHERE id = NEW.customer_id AND status = 'active' AND merged_into_id IS NULL;
    IF v_customer_organization_id IS NULL THEN RAISE EXCEPTION 'entitlement_customer_not_active'; END IF;
    IF v_customer_organization_id <> v_organization_id THEN RAISE EXCEPTION 'entitlement_customer_organization_mismatch'; END IF;
    IF NEW.user_id IS NOT NULL AND v_customer_user_id IS NOT NULL AND v_customer_user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'entitlement_user_customer_mismatch';
    END IF;
  END IF;

  IF NEW.dependent_participant_id IS NOT NULL THEN
    SELECT organization_id INTO v_dependent_organization_id
    FROM public.dependent_participants
    WHERE id = NEW.dependent_participant_id AND status = 'active';
    IF v_dependent_organization_id IS DISTINCT FROM v_organization_id THEN
      RAISE EXCEPTION 'entitlement_dependent_organization_mismatch';
    END IF;
  END IF;

  IF NEW.starts_at IS NULL AND NEW.valid_from IS NOT NULL THEN NEW.starts_at := NEW.valid_from; END IF;
  IF NEW.expires_at IS NULL AND NEW.valid_until IS NOT NULL THEN NEW.expires_at := NEW.valid_until; END IF;
  IF NEW.service_date IS NULL AND NEW.valid_date IS NOT NULL THEN NEW.service_date := NEW.valid_date; END IF;
  IF NEW.valid_from IS NULL AND NEW.starts_at IS NOT NULL THEN NEW.valid_from := NEW.starts_at; END IF;
  IF NEW.valid_until IS NULL AND NEW.expires_at IS NOT NULL THEN NEW.valid_until := NEW.expires_at; END IF;
  IF NEW.valid_date IS NULL AND NEW.service_date IS NOT NULL AND NEW.meter_type = 'valid_day' THEN NEW.valid_date := NEW.service_date; END IF;

  IF NEW.model_version = 2 THEN
    IF num_nonnulls(NEW.customer_id, NEW.dependent_participant_id) <> 1 THEN
      RAISE EXCEPTION 'canonical_entitlement_requires_one_participant';
    END IF;
    IF NEW.meter_type = 'occurrences' AND (NEW.uses_limit IS NULL OR NEW.uses_limit <= 0) THEN
      RAISE EXCEPTION 'occurrence_entitlement_requires_positive_limit';
    END IF;
    IF NEW.meter_type = 'exact_session' AND NEW.uses_limit IS NULL THEN NEW.uses_limit := 1; END IF;
    IF NEW.scope_type = 'exact_session' AND NEW.activity_session_id IS NULL THEN
      RAISE EXCEPTION 'exact_session_entitlement_requires_session';
    END IF;
    IF NEW.meter_type IN ('valid_day', 'one_per_day') AND NEW.service_date IS NULL THEN
      RAISE EXCEPTION 'day_meter_requires_service_date';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Series is a first-class capacity scope. session_date remains the existing
-- non-null hold dimension and is canonically anchored to Series.start_date.
ALTER TABLE public.capacity_holds
  DROP CONSTRAINT IF EXISTS capacity_holds_scope_type_check;
ALTER TABLE public.capacity_holds
  ADD CONSTRAINT capacity_holds_scope_type_check
  CHECK (scope_type IN ('activity_session', 'booking_group', 'activity_series'));

CREATE OR REPLACE FUNCTION public.capacity_lock_scope(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_session_date DATE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(COALESCE(p_venue_id::TEXT, '')),
    hashtext(COALESCE(p_scope_type, '') || ':' || COALESCE(p_scope_id, '') || ':' || COALESCE(p_session_date::TEXT, ''))
  );
  IF p_scope_type = 'activity_session' THEN
    PERFORM 1 FROM public.activity_sessions
    WHERE id = p_scope_id::UUID AND venue_id = p_venue_id FOR UPDATE;
  ELSIF p_scope_type = 'activity_series' THEN
    PERFORM 1 FROM public.activity_series
    WHERE id = p_scope_id::UUID AND venue_id = p_venue_id FOR UPDATE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.capacity_scope_capacity(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_capacity INTEGER DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE v_capacity INTEGER;
BEGIN
  IF p_scope_type = 'activity_session' THEN
    SELECT capacity INTO v_capacity FROM public.activity_sessions
    WHERE id = p_scope_id::UUID AND venue_id = p_venue_id;
    RETURN NULLIF(GREATEST(COALESCE(v_capacity, 0), 0), 0);
  ELSIF p_scope_type = 'activity_series' THEN
    SELECT capacity INTO v_capacity FROM public.activity_series
    WHERE id = p_scope_id::UUID AND venue_id = p_venue_id;
    RETURN NULLIF(GREATEST(COALESCE(v_capacity, 0), 0), 0);
  ELSIF p_scope_type = 'booking_group' THEN
    RETURN NULLIF(GREATEST(COALESCE(p_capacity, 0), 0), 0);
  END IF;
  RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.capacity_committed_count(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_session_date DATE,
  p_exclude_registration_id UUID DEFAULT NULL,
  p_exclude_participant_id UUID DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  IF p_scope_type = 'activity_session' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.session_registrations registration
    WHERE registration.venue_id = p_venue_id
      AND registration.activity_session_id = p_scope_id::UUID
      AND registration.session_date = p_session_date
      AND registration.status IN ('confirmed', 'checked_in', 'no_show')
      AND (p_exclude_registration_id IS NULL OR registration.id <> p_exclude_registration_id);
  ELSIF p_scope_type = 'booking_group' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.booking_participants participant
    WHERE participant.venue_id = p_venue_id
      AND participant.booking_group_key = p_scope_id
      AND participant.payment_status IN ('paid', 'free')
      AND (p_exclude_participant_id IS NULL OR participant.id <> p_exclude_participant_id);
  ELSIF p_scope_type = 'activity_series' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.series_commitments commitment
    WHERE commitment.venue_id = p_venue_id
      AND commitment.activity_series_id = p_scope_id::UUID
      AND commitment.commitment_type = 'participant'
      AND commitment.status = 'active';
  ELSE
    RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
  END IF;
  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_capacity_hold(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_session_date DATE,
  p_capacity INTEGER DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB,
  p_ttl_seconds INTEGER DEFAULT 600
) RETURNS TABLE(ok BOOLEAN, hold_id UUID, available_count INTEGER, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capacity INTEGER;
  v_committed INTEGER;
  v_holds INTEGER;
  v_existing public.capacity_holds%ROWTYPE;
BEGIN
  IF p_scope_type NOT IN ('activity_session', 'booking_group', 'activity_series') THEN
    RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
  END IF;
  PERFORM public.capacity_lock_scope(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  UPDATE public.capacity_holds
  SET status = 'expired', released_at = now(),
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object('release_reason', 'lazy_expired_before_acquire')
  WHERE venue_id = p_venue_id AND scope_type = p_scope_type AND scope_id = p_scope_id
    AND session_date = p_session_date AND status = 'active' AND expires_at <= now();

  SELECT * INTO v_existing FROM public.capacity_holds hold
  WHERE hold.venue_id = p_venue_id AND hold.scope_type = p_scope_type
    AND hold.scope_id = p_scope_id AND hold.session_date = p_session_date
    AND hold.status = 'active' AND hold.expires_at > now()
    AND (
      (NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NOT NULL AND hold.idempotency_key = NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''))
      OR (p_source_id IS NOT NULL AND hold.source_id = p_source_id)
      OR (p_user_id IS NOT NULL AND hold.user_id = p_user_id AND COALESCE(hold.source_type, '') = COALESCE(p_source_type, ''))
    )
  ORDER BY hold.created_at DESC LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    ok := true;
    hold_id := v_existing.id;
    v_capacity := public.capacity_scope_capacity(p_venue_id, p_scope_type, p_scope_id, p_capacity);
    v_committed := public.capacity_committed_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
    v_holds := public.capacity_active_holds_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
    available_count := CASE WHEN v_capacity IS NULL THEN NULL ELSE GREATEST(v_capacity - v_committed - v_holds, 0) END;
    reason := 'existing_hold';
    RETURN NEXT;
    RETURN;
  END IF;

  v_capacity := public.capacity_scope_capacity(p_venue_id, p_scope_type, p_scope_id, p_capacity);
  v_committed := public.capacity_committed_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  v_holds := public.capacity_active_holds_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  IF v_capacity IS NOT NULL AND (v_committed + v_holds) >= v_capacity THEN
    ok := false; hold_id := NULL; available_count := 0; reason := 'capacity_full';
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.capacity_holds (
    venue_id, scope_type, scope_id, session_date, user_id, customer_id,
    source_type, source_id, idempotency_key, expires_at, metadata
  ) VALUES (
    p_venue_id, p_scope_type, p_scope_id, p_session_date, p_user_id, p_customer_id,
    p_source_type, p_source_id, NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''),
    now() + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 600), 1)),
    COALESCE(p_metadata, '{}'::JSONB)
  ) RETURNING id INTO hold_id;
  ok := true;
  available_count := CASE WHEN v_capacity IS NULL THEN NULL ELSE GREATEST(v_capacity - v_committed - v_holds - 1, 0) END;
  reason := 'held';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_capacity_hold(UUID, TEXT, TEXT, DATE, INTEGER, UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_capacity_hold(UUID, TEXT, TEXT, DATE, INTEGER, UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_course_series_participation(p_series_id UUID)
RETURNS TABLE(inserted_count INTEGER, updated_count INTEGER, cancelled_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series public.activity_series%ROWTYPE;
BEGIN
  inserted_count := 0;
  updated_count := 0;
  cancelled_count := 0;
  SELECT * INTO v_series FROM public.activity_series WHERE id = p_series_id;
  IF v_series.id IS NULL THEN RAISE EXCEPTION 'course_series_not_found'; END IF;
  IF v_series.series_type <> 'course' THEN RETURN NEXT; RETURN; END IF;

  WITH projected AS (
    SELECT
      gen_random_uuid() AS id,
      session.venue_id,
      session.id AS activity_session_id,
      session.session_date,
      customer.auth_user_id AS user_id,
      commitment.participant_customer_id AS customer_id,
      commitment.dependent_participant_id,
      commitment.id AS series_commitment_id,
      jsonb_build_object(
        'series_commitment_id', commitment.id,
        'activity_series_id', commitment.activity_series_id,
        'access_reason', 'Kursplats',
        'participant_kind', CASE WHEN commitment.dependent_participant_id IS NULL THEN 'customer' ELSE 'dependent' END
      ) AS metadata
    FROM public.series_commitments commitment
    JOIN public.activity_sessions session
      ON session.series_id = commitment.activity_series_id
     AND session.closed_to_public = true
     AND session.is_active = true
     AND session.session_date IS NOT NULL
    LEFT JOIN public.customers customer ON customer.id = commitment.participant_customer_id
    WHERE commitment.activity_series_id = p_series_id
      AND commitment.commitment_type = 'participant'
      AND commitment.status = 'active'
  ), inserted AS (
    INSERT INTO public.session_registrations (
      id, venue_id, activity_session_id, session_date, user_id, customer_id,
      dependent_participant_id, series_commitment_id, status, price_paid_sek,
      source_type, source_id, metadata
    )
    SELECT id, venue_id, activity_session_id, session_date, user_id, customer_id,
      dependent_participant_id, series_commitment_id, 'confirmed', 0,
      'series_commitment', series_commitment_id, metadata
    FROM projected
    ON CONFLICT (activity_session_id, series_commitment_id)
      WHERE series_commitment_id IS NOT NULL
    DO NOTHING
    RETURNING 1
  ) SELECT COUNT(*)::INTEGER INTO inserted_count FROM inserted;

  WITH updated AS (
    UPDATE public.session_registrations registration
    SET session_date = session.session_date,
        venue_id = session.venue_id,
        user_id = customer.auth_user_id,
        customer_id = commitment.participant_customer_id,
        dependent_participant_id = commitment.dependent_participant_id,
        status = CASE
          WHEN registration.status IN ('checked_in', 'no_show') THEN registration.status
          ELSE 'confirmed'
        END,
        metadata = COALESCE(registration.metadata, '{}'::JSONB) || jsonb_build_object(
          'series_commitment_id', commitment.id,
          'activity_series_id', commitment.activity_series_id,
          'access_reason', 'Kursplats'
        ),
        updated_at = now()
    FROM public.series_commitments commitment
    JOIN public.activity_sessions session
      ON session.series_id = commitment.activity_series_id
     AND session.closed_to_public = true
     AND session.is_active = true
     AND session.session_date IS NOT NULL
    LEFT JOIN public.customers customer ON customer.id = commitment.participant_customer_id
    WHERE registration.series_commitment_id = commitment.id
      AND registration.activity_session_id = session.id
      AND commitment.activity_series_id = p_series_id
      AND commitment.status = 'active'
    RETURNING 1
  ) SELECT COUNT(*)::INTEGER INTO updated_count FROM updated;

  WITH cancelled AS (
    UPDATE public.session_registrations registration
    SET status = 'cancelled', updated_at = now()
    FROM public.series_commitments commitment
    WHERE registration.series_commitment_id = commitment.id
      AND commitment.activity_series_id = p_series_id
      AND registration.status = 'confirmed'
      AND (
        commitment.status <> 'active'
        OR NOT EXISTS (
          SELECT 1
          FROM public.activity_sessions session
          WHERE session.id = registration.activity_session_id
            AND session.is_active = true
        )
      )
    RETURNING 1
  ) SELECT COUNT(*)::INTEGER INTO cancelled_count FROM cancelled;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_course_series_participation(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_course_series_participation(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.generate_course_series_sessions(p_series_id UUID)
RETURNS SETOF public.activity_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series public.activity_series%ROWTYPE;
  v_requires_instructor BOOLEAN := false;
BEGIN
  SELECT * INTO v_series FROM public.activity_series WHERE id = p_series_id FOR UPDATE;
  IF v_series.id IS NULL OR v_series.series_type <> 'course' THEN RAISE EXCEPTION 'course_series_not_found'; END IF;
  IF v_series.start_date IS NULL OR v_series.end_date IS NULL OR v_series.start_time IS NULL OR v_series.end_time IS NULL THEN
    RAISE EXCEPTION 'course_series_schedule_incomplete';
  END IF;
  IF COALESCE(cardinality(v_series.recurrence_days), 0) = 0 THEN RAISE EXCEPTION 'course_series_recurrence_required'; END IF;
  IF v_series.capacity IS NULL OR v_series.capacity <= 0 THEN RAISE EXCEPTION 'course_series_capacity_required'; END IF;
  SELECT requires_instructor INTO v_requires_instructor FROM public.activity_formats WHERE id = v_series.format_id;

  RETURN QUERY
  WITH dates AS (
    SELECT day::DATE AS session_date,
      row_number() OVER (ORDER BY day)::INTEGER AS occurrence_index
    FROM generate_series(v_series.start_date, v_series.end_date, interval '1 day') day
    WHERE EXTRACT(DOW FROM day)::INTEGER = ANY(v_series.recurrence_days)
    ORDER BY day
    LIMIT COALESCE(v_series.total_sessions, 1000)
  ), inserted AS (
    INSERT INTO public.activity_sessions (
      venue_id, name, session_type, sport_type, recurrence_days, session_date,
      start_time, end_time, price_sek, capacity, court_ids, access_policy,
      is_active, metadata, series_id, product_key, publish_status, sort_order,
      requires_staffing, closed_to_public, series_occurrence_index
    )
    SELECT
      v_series.venue_id, v_series.name, 'course', v_series.sport_type, NULL, dates.session_date,
      v_series.start_time, v_series.end_time, 0, v_series.capacity, v_series.court_ids,
      jsonb_build_object('series_commitment_required', true),
      true, jsonb_build_object('generated_by', 'course_series', 'activity_series_id', v_series.id),
      v_series.id, NULL, 'published', dates.occurrence_index * 10,
      COALESCE(v_requires_instructor, false), true, dates.occurrence_index
    FROM dates
    ON CONFLICT (series_id, series_occurrence_index)
      WHERE series_id IS NOT NULL AND series_occurrence_index IS NOT NULL
    DO NOTHING
    RETURNING *
  ) SELECT * FROM inserted;

  PERFORM public.reconcile_course_series_participation(p_series_id);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_course_series_sessions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_course_series_sessions(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.commit_series_participant_capacity(
  p_venue_id UUID,
  p_activity_series_id UUID,
  p_participant_customer_id UUID DEFAULT NULL,
  p_dependent_participant_id UUID DEFAULT NULL,
  p_payer_customer_id UUID DEFAULT NULL,
  p_commerce_order_id UUID DEFAULT NULL,
  p_commerce_order_line_id UUID DEFAULT NULL,
  p_hold_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS TABLE(ok BOOLEAN, commitment_id UUID, entitlement_id UUID, available_count INTEGER, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series public.activity_series%ROWTYPE;
  v_organization_id UUID;
  v_hold public.capacity_holds%ROWTYPE;
  v_existing public.series_commitments%ROWTYPE;
  v_commitment public.series_commitments%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_entitlement public.access_entitlements%ROWTYPE;
  v_committed INTEGER;
  v_holds INTEGER;
  v_allow BOOLEAN := false;
  v_anchor_date DATE;
BEGIN
  IF num_nonnulls(p_participant_customer_id, p_dependent_participant_id) <> 1 THEN
    RAISE EXCEPTION 'course_participant_required';
  END IF;
  SELECT series.*
  INTO v_series
  FROM public.activity_series series
  WHERE series.id = p_activity_series_id
    AND series.venue_id = p_venue_id;

  SELECT venue.organization_id
  INTO v_organization_id
  FROM public.venues venue
  WHERE venue.id = p_venue_id;
  IF v_series.id IS NULL OR v_series.series_type <> 'course' THEN RAISE EXCEPTION 'course_series_not_found'; END IF;
  v_anchor_date := v_series.start_date;
  IF v_anchor_date IS NULL THEN RAISE EXCEPTION 'course_series_start_date_required'; END IF;

  PERFORM public.capacity_lock_scope(p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_anchor_date);
  IF p_commerce_order_line_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.series_commitments
    WHERE commerce_order_line_id = p_commerce_order_line_id;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    ok := true; commitment_id := v_existing.id; entitlement_id := v_existing.access_entitlement_id;
    available_count := GREATEST(COALESCE(v_series.capacity, 0) - public.capacity_committed_count(
      p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_anchor_date
    ), 0);
    reason := 'already_committed'; RETURN NEXT; RETURN;
  END IF;

  IF p_hold_id IS NOT NULL THEN
    SELECT * INTO v_hold FROM public.capacity_holds
    WHERE id = p_hold_id AND venue_id = p_venue_id
      AND scope_type = 'activity_series' AND scope_id = p_activity_series_id::TEXT
      AND session_date = v_anchor_date
    FOR UPDATE;
  END IF;
  v_committed := public.capacity_committed_count(p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_anchor_date);
  v_holds := public.capacity_active_holds_count(p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_anchor_date, v_hold.id);
  IF v_hold.id IS NOT NULL AND v_hold.status = 'active' AND v_hold.expires_at > now() THEN
    v_allow := true;
  ELSIF v_series.capacity IS NULL OR (v_committed + v_holds) < v_series.capacity THEN
    v_allow := true;
  END IF;
  IF NOT v_allow THEN
    IF v_hold.id IS NOT NULL THEN
      UPDATE public.capacity_holds SET status = 'conflict',
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object('conflict_reason', 'series_capacity_full_after_payment')
      WHERE id = v_hold.id;
    END IF;
    ok := false; commitment_id := NULL; entitlement_id := NULL; available_count := 0; reason := 'capacity_full';
    RETURN NEXT; RETURN;
  END IF;

  IF p_dependent_participant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dependent_participants dependent
    WHERE dependent.id = p_dependent_participant_id
      AND dependent.guardian_customer_id = p_payer_customer_id
      AND dependent.organization_id = v_organization_id
      AND dependent.status = 'active'
  ) THEN RAISE EXCEPTION 'course_dependent_guardian_mismatch'; END IF;

  INSERT INTO public.series_commitments (
    organization_id, venue_id, activity_series_id, commitment_type,
    participant_customer_id, dependent_participant_id, payer_customer_id,
    commerce_order_id, commerce_order_line_id, status, activated_at, metadata
  ) VALUES (
    v_organization_id, p_venue_id, p_activity_series_id, 'participant',
    p_participant_customer_id, p_dependent_participant_id, p_payer_customer_id,
    p_commerce_order_id, p_commerce_order_line_id, 'active', now(), COALESCE(p_metadata, '{}'::JSONB)
  ) RETURNING * INTO v_commitment;

  IF p_participant_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM public.customers WHERE id = p_participant_customer_id;
  END IF;

  INSERT INTO public.access_entitlements (
    organization_id, venue_id, customer_id, user_id, dependent_participant_id,
    entitlement_type, status, source_type, source_id, metadata, model_version,
    scope_type, meter_type, starts_at, expires_at, funding_type, funder,
    access_reason, requires_consumption, consumption_trigger, no_show_policy,
    constitution_version, scope_schema_version, resolution_priority,
    scarcity_class, resolution_origin_priority, issuance_key
  ) VALUES (
    v_organization_id, p_venue_id, p_participant_customer_id, v_customer.auth_user_id,
    p_dependent_participant_id, 'series_access', 'active', 'series_commitment', v_commitment.id,
    jsonb_build_object('activity_series_id', p_activity_series_id, 'commerce_order_id', p_commerce_order_id),
    2, 'activity_series', 'unlimited',
    (v_series.start_date::TIMESTAMP AT TIME ZONE 'Europe/Stockholm'),
    ((v_series.end_date + 1)::TIMESTAMP AT TIME ZONE 'Europe/Stockholm'),
    'commerce_purchase', 'self_prepaid', 'Kursplats', false,
    'on_commitment', 'do_not_consume', 1, 1, 10, 'scarce', 0,
    'series_commitment:' || v_commitment.id::TEXT
  ) RETURNING * INTO v_entitlement;

  INSERT INTO public.access_entitlement_scopes (
    entitlement_id, organization_id, scope_kind, activity_series_id,
    valid_from, valid_until
  ) VALUES (
    v_entitlement.id, v_organization_id, 'activity_series', p_activity_series_id,
    v_entitlement.starts_at, v_entitlement.expires_at
  );

  UPDATE public.series_commitments SET access_entitlement_id = v_entitlement.id
  WHERE id = v_commitment.id;
  IF p_commerce_order_line_id IS NOT NULL THEN
    UPDATE public.commerce_order_lines SET series_commitment_id = v_commitment.id
    WHERE id = p_commerce_order_line_id AND commerce_order_id = p_commerce_order_id;
  END IF;
  IF v_hold.id IS NOT NULL THEN
    UPDATE public.capacity_holds SET status = 'committed', committed_at = COALESCE(committed_at, now())
    WHERE id = v_hold.id AND status = 'active';
  END IF;
  PERFORM public.reconcile_course_series_participation(p_activity_series_id);

  ok := true; commitment_id := v_commitment.id; entitlement_id := v_entitlement.id;
  available_count := GREATEST(COALESCE(v_series.capacity, 0) - v_committed - 1, 0);
  reason := 'committed'; RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_series_participant_capacity(UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_series_participant_capacity(UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_course_series_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'activity_sessions' THEN
    IF TG_OP <> 'DELETE' AND NEW.series_id IS NOT NULL THEN
      PERFORM public.reconcile_course_series_participation(NEW.series_id);
    END IF;
    IF TG_OP <> 'INSERT' AND OLD.series_id IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.series_id IS DISTINCT FROM NEW.series_id) THEN
      PERFORM public.reconcile_course_series_participation(OLD.series_id);
    END IF;
  ELSE
    PERFORM public.reconcile_course_series_participation(COALESCE(NEW.activity_series_id, OLD.activity_series_id));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_course_session_reconcile
AFTER INSERT OR UPDATE OF session_date, is_active, series_id OR DELETE ON public.activity_sessions
FOR EACH ROW EXECUTE FUNCTION public.reconcile_course_series_trigger();

CREATE TRIGGER trg_course_commitment_reconcile
AFTER INSERT OR UPDATE OF status OR DELETE ON public.series_commitments
FOR EACH ROW EXECUTE FUNCTION public.reconcile_course_series_trigger();

COMMENT ON FUNCTION public.commit_series_participant_capacity(UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, JSONB) IS
  'Atomically turns one existing Series capacity hold into one active Series Commitment and one non-consuming Series entitlement.';
