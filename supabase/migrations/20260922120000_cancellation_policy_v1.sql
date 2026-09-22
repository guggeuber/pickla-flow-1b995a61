-- Cancellation Policy V1
--
-- One immutable purchase-time policy snapshot, one server evaluation and one
-- atomic participation/capacity command. Provider refunds remain durable R2A
-- commands and are deliberately independent of capacity release.

CREATE TABLE public.cancellation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  policy_key TEXT NOT NULL,
  policy_family TEXT NOT NULL CHECK (policy_family IN (
    'occurrence_ticket', 'booking_participant', 'court_booking',
    'managed_course', 'league_team', 'event'
  )),
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, policy_key)
);

CREATE TABLE public.cancellation_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES public.cancellation_policies(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  lifecycle_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN ('draft', 'published', 'retired')),
  preset_key TEXT NOT NULL CHECK (preset_key IN (
    'standard_12h', 'court_24h', 'course_48h', 'league_registration_close',
    'event_24h', 'event_non_refundable'
  )),
  rules JSONB NOT NULL,
  copy_sv JSONB NOT NULL,
  copy_en JSONB NOT NULL,
  copy_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (copy_schema_version = 1),
  change_note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  UNIQUE (policy_id, version),
  CHECK (
    jsonb_typeof(rules) = 'object'
    AND rules->>'cancel_anchor' IN ('start_at', 'registration_close_at')
    AND (rules->>'cancel_offset_minutes')::INTEGER = 0
    AND rules->>'refund_mode' IN ('automatic', 'none')
    AND (rules->>'refund_percentage')::INTEGER IN (0, 100)
    AND rules->>'refund_comparison' = 'strict_before'
    AND rules->>'entitlement_restore_mode' IN ('measurable_before_refund_deadline', 'none')
  ),
  CHECK (
    (lifecycle_status = 'published' AND published_at IS NOT NULL)
    OR lifecycle_status <> 'published'
  )
);

CREATE UNIQUE INDEX cancellation_policy_one_published_version
  ON public.cancellation_policy_versions (policy_id)
  WHERE lifecycle_status = 'published';

CREATE TABLE public.cancellation_policy_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  policy_family TEXT NOT NULL CHECK (policy_family IN (
    'occurrence_ticket', 'booking_participant', 'court_booking',
    'managed_course', 'league_team', 'event'
  )),
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'family_default', 'access_product', 'activity_series', 'event'
  )),
  subject_id UUID,
  policy_version_id UUID NOT NULL REFERENCES public.cancellation_policy_versions(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  CHECK (
    (subject_type = 'family_default' AND subject_id IS NULL)
    OR (subject_type <> 'family_default' AND subject_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX cancellation_policy_active_binding
  ON public.cancellation_policy_bindings (
    venue_id, policy_family, subject_type, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::UUID)
  ) WHERE is_active;

-- A durable schema/config boundary, not an inferred deploy timestamp.  Only
-- these seven terms-bearing authorities are in Policy V1. Membership and
-- merchandise deliberately have no row and therefore remain outside V1.
CREATE TABLE public.cancellation_policy_cutovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  authority_key TEXT NOT NULL CHECK (authority_key IN (
    'occurrence_ticket', 'booking_participant', 'court_booking',
    'managed_course', 'league_team', 'refundable_event',
    'non_refundable_event'
  )),
  policy_family TEXT NOT NULL CHECK (policy_family IN (
    'occurrence_ticket', 'booking_participant', 'court_booking',
    'managed_course', 'league_team', 'event'
  )),
  preset_key TEXT NOT NULL CHECK (preset_key IN (
    'standard_12h', 'court_24h', 'course_48h', 'league_registration_close',
    'event_24h', 'event_non_refundable'
  )),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  enabled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, authority_key),
  UNIQUE (id, venue_id)
);

CREATE TABLE public.cancellation_policy_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  policy_family TEXT NOT NULL CHECK (policy_family IN (
    'occurrence_ticket', 'booking_participant', 'court_booking',
    'managed_course', 'league_team', 'event'
  )),
  policy_version_id UUID NOT NULL REFERENCES public.cancellation_policy_versions(id) ON DELETE RESTRICT,
  cutover_id UUID NOT NULL,
  authority_key TEXT NOT NULL CHECK (authority_key IN (
    'occurrence_ticket', 'booking_participant', 'court_booking',
    'managed_course', 'league_team', 'refundable_event',
    'non_refundable_event'
  )),
  policy_key TEXT NOT NULL,
  policy_version INTEGER,
  provenance TEXT NOT NULL CHECK (provenance IN (
    'family_default', 'access_product', 'activity_series', 'event'
  )),
  purchase_reference_type TEXT NOT NULL,
  purchase_reference_id UUID NOT NULL,
  start_at TIMESTAMPTZ,
  registration_close_at TIMESTAMPTZ,
  cancel_deadline_at TIMESTAMPTZ,
  refund_deadline_at TIMESTAMPTZ,
  rules JSONB NOT NULL,
  copy_sv JSONB NOT NULL,
  copy_en JSONB NOT NULL,
  copy_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (copy_schema_version = 1),
  payer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payer_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  payment_provenance JSONB NOT NULL DEFAULT '{}'::JSONB,
  funding_provenance JSONB NOT NULL DEFAULT '{}'::JSONB,
  resolved_from_binding_id UUID REFERENCES public.cancellation_policy_bindings(id) ON DELETE RESTRICT,
  terms_accepted_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_reference_type, purchase_reference_id),
  FOREIGN KEY (cutover_id, venue_id)
    REFERENCES public.cancellation_policy_cutovers(id, venue_id) ON DELETE RESTRICT
);

CREATE TABLE public.cancellation_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  policy_mode TEXT NOT NULL CHECK (policy_mode IN ('policy_v1', 'legacy')),
  snapshot_id UUID REFERENCES public.cancellation_policy_snapshots(id) ON DELETE RESTRICT,
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'activity_registration', 'booking_participant', 'court_booking',
    'series_commitment', 'league_team_entry'
  )),
  subject_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_mode TEXT NOT NULL CHECK (actor_mode IN ('customer', 'staff_override')),
  staff_reason TEXT,
  evaluated_at TIMESTAMPTZ NOT NULL,
  state_revision TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  reason_code TEXT NOT NULL,
  refund_mode TEXT NOT NULL CHECK (refund_mode IN ('automatic_full', 'none', 'manual_legacy')),
  refund_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'SEK',
  entitlement_restore_mode TEXT NOT NULL CHECK (entitlement_restore_mode IN ('measurable', 'none', 'not_applicable')),
  capacity_release_mode TEXT NOT NULL DEFAULT 'immediate'
    CHECK (capacity_release_mode = 'immediate'),
  checkin_preserved BOOLEAN NOT NULL DEFAULT false,
  decision JSONB NOT NULL,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, request_id),
  CHECK (
    (policy_mode = 'policy_v1' AND snapshot_id IS NOT NULL)
    OR (policy_mode = 'legacy' AND snapshot_id IS NULL)
  ),
  CHECK (actor_mode <> 'staff_override' OR length(btrim(COALESCE(staff_reason, ''))) BETWEEN 3 AND 500)
);

ALTER TABLE public.commerce_order_lines
  ADD COLUMN cancellation_policy_snapshot_id UUID
  REFERENCES public.cancellation_policy_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE public.bookings
  ADD COLUMN cancellation_policy_snapshot_id UUID
  REFERENCES public.cancellation_policy_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE public.bookings
  ADD COLUMN cancellation_policy_legacy_purchase_at TIMESTAMPTZ,
  ADD CONSTRAINT bookings_cancellation_contract_identity CHECK (
    num_nonnulls(cancellation_policy_snapshot_id,cancellation_policy_legacy_purchase_at) <= 1
  );
ALTER TABLE public.booking_participants
  ADD COLUMN cancellation_policy_snapshot_id UUID
  REFERENCES public.cancellation_policy_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE public.session_registrations
  ADD COLUMN cancellation_policy_snapshot_id UUID
  REFERENCES public.cancellation_policy_snapshots(id) ON DELETE RESTRICT;

-- The physical booking command predates Policy V1. Replace it in place so the
-- snapshot supplied by every new court flow is inserted atomically with the
-- booking instead of being silently discarded by the JSON command boundary.
CREATE OR REPLACE FUNCTION public.claim_physical_bookings(
  p_venue_id UUID,
  p_claims JSONB
) RETURNS SETOF public.bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_claim JSONB; v_result JSONB; v_booking public.bookings%ROWTYPE;
  v_court_ids UUID[]; v_snapshot_id UUID; v_booking_id UUID;
  v_legacy_purchase_at TIMESTAMPTZ;
BEGIN
  IF p_venue_id IS NULL OR jsonb_typeof(p_claims) <> 'array'
     OR jsonb_array_length(p_claims)=0 OR jsonb_array_length(p_claims)>32 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_physical_booking_claim';
  END IF;
  SELECT array_agg(DISTINCT (claim->>'venue_court_id')::UUID ORDER BY (claim->>'venue_court_id')::UUID)
  INTO v_court_ids FROM jsonb_array_elements(p_claims) claim
  WHERE NULLIF(claim->>'venue_court_id','') IS NOT NULL;
  IF cardinality(COALESCE(v_court_ids,'{}'::UUID[]))=0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_claims) claim
    WHERE NULLIF(claim->>'venue_id','')::UUID IS DISTINCT FROM p_venue_id
      OR NULLIF(claim->>'venue_court_id','') IS NULL
      OR NULLIF(claim->>'user_id','') IS NULL
      OR NULLIF(claim->>'start_time','') IS NULL
      OR NULLIF(claim->>'end_time','') IS NULL
      OR num_nonnulls(NULLIF(claim->>'cancellation_policy_snapshot_id',''),
        NULLIF(claim->>'cancellation_policy_legacy_purchase_at','')) <> 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='physical_booking_claim_identity_invalid';
  END IF;
  PERFORM public.lock_physical_resources(p_venue_id,v_court_ids);
  FOR v_claim IN SELECT value FROM jsonb_array_elements(p_claims)
  LOOP
    v_snapshot_id := NULLIF(v_claim->>'cancellation_policy_snapshot_id','')::UUID;
    v_legacy_purchase_at := NULLIF(v_claim->>'cancellation_policy_legacy_purchase_at','')::TIMESTAMPTZ;
    IF v_snapshot_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.cancellation_policy_snapshots snapshot
        JOIN public.cancellation_policy_cutovers cutover ON cutover.id=snapshot.cutover_id
        WHERE snapshot.id=v_snapshot_id AND snapshot.venue_id=p_venue_id
          AND snapshot.policy_family='court_booking'
          AND snapshot.authority_key='court_booking'
          AND snapshot.terms_accepted_at >= cutover.enabled_at
      ) THEN RAISE EXCEPTION 'cancellation_policy_snapshot_mismatch'; END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.cancellation_policy_cutovers cutover
      WHERE cutover.venue_id=p_venue_id AND cutover.authority_key='court_booking'
        AND v_legacy_purchase_at < cutover.enabled_at
    ) THEN
      RAISE EXCEPTION 'cancellation_policy_snapshot_required_after_cutover:court_booking';
    END IF;
    v_result := public.check_physical_availability(
      p_venue_id,ARRAY[(v_claim->>'venue_court_id')::UUID],
      (v_claim->>'start_time')::TIMESTAMPTZ,(v_claim->>'end_time')::TIMESTAMPTZ
    );
    IF NOT COALESCE((v_result->>'available')::BOOLEAN,false) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='physical_availability_conflict',DETAIL=v_result::TEXT;
    END IF;
    v_booking_id := COALESCE(NULLIF(v_claim->>'id','')::UUID,gen_random_uuid());
    INSERT INTO public.bookings (
      id, venue_id, venue_court_id, user_id, start_time, end_time, status,
      total_price, currency, notes, booked_by, booking_ref,
      corporate_package_id, access_code, access_code_expires_at,
      stripe_session_id, membership_id, included_court_hours,
      paid_court_hours, membership_usage_entitlement_type,
      membership_usage_period_start, membership_usage_period_end, customer_id,
      participation_funding_mode, participation_funding_source_type,
      participation_funding_source_id, participation_funder,
      cancellation_policy_snapshot_id,cancellation_policy_legacy_purchase_at
    ) VALUES (
      v_booking_id,p_venue_id,(v_claim->>'venue_court_id')::UUID,(v_claim->>'user_id')::UUID,
      (v_claim->>'start_time')::TIMESTAMPTZ,(v_claim->>'end_time')::TIMESTAMPTZ,
      COALESCE(NULLIF(v_claim->>'status',''),'confirmed')::public.booking_status,
      NULLIF(v_claim->>'total_price','')::NUMERIC,COALESCE(NULLIF(v_claim->>'currency',''),'SEK'),
      v_claim->>'notes',NULLIF(v_claim->>'booked_by','')::UUID,NULLIF(v_claim->>'booking_ref',''),
      NULLIF(v_claim->>'corporate_package_id','')::UUID,NULLIF(v_claim->>'access_code',''),
      NULLIF(v_claim->>'access_code_expires_at','')::TIMESTAMPTZ,
      NULLIF(v_claim->>'stripe_session_id',''),NULLIF(v_claim->>'membership_id','')::UUID,
      COALESCE(NULLIF(v_claim->>'included_court_hours','')::NUMERIC,0),
      COALESCE(NULLIF(v_claim->>'paid_court_hours','')::NUMERIC,0),
      NULLIF(v_claim->>'membership_usage_entitlement_type',''),
      NULLIF(v_claim->>'membership_usage_period_start','')::DATE,
      NULLIF(v_claim->>'membership_usage_period_end','')::DATE,
      NULLIF(v_claim->>'customer_id','')::UUID,
      COALESCE(NULLIF(v_claim->>'participation_funding_mode',''),'unresolved'),
      NULLIF(v_claim->>'participation_funding_source_type',''),
      NULLIF(v_claim->>'participation_funding_source_id',''),
      NULLIF(v_claim->>'participation_funder',''),v_snapshot_id,v_legacy_purchase_at
    ) RETURNING * INTO v_booking;
    RETURN NEXT v_booking;
  END LOOP;
END;
$$;

CREATE INDEX cancellation_snapshots_venue_created
  ON public.cancellation_policy_snapshots (venue_id, created_at DESC);
CREATE INDEX cancellation_decisions_subject
  ON public.cancellation_decisions (subject_type, subject_id, created_at DESC);
CREATE INDEX commerce_order_lines_cancellation_snapshot
  ON public.commerce_order_lines (cancellation_policy_snapshot_id)
  WHERE cancellation_policy_snapshot_id IS NOT NULL;
CREATE INDEX bookings_cancellation_snapshot
  ON public.bookings (cancellation_policy_snapshot_id)
  WHERE cancellation_policy_snapshot_id IS NOT NULL;
CREATE INDEX booking_participants_cancellation_snapshot
  ON public.booking_participants (cancellation_policy_snapshot_id)
  WHERE cancellation_policy_snapshot_id IS NOT NULL;
CREATE INDEX session_registrations_cancellation_snapshot
  ON public.session_registrations (cancellation_policy_snapshot_id)
  WHERE cancellation_policy_snapshot_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.attach_registration_cancellation_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_snapshot_id UUID;
BEGIN
  IF NEW.cancellation_policy_snapshot_id IS NULL
    AND NULLIF(NEW.metadata->>'cancellation_policy_snapshot_id','') IS NOT NULL THEN
    v_snapshot_id := (NEW.metadata->>'cancellation_policy_snapshot_id')::UUID;
    IF NOT EXISTS (SELECT 1 FROM public.cancellation_policy_snapshots snapshot
      WHERE snapshot.id=v_snapshot_id AND snapshot.venue_id=NEW.venue_id
        AND snapshot.policy_family='occurrence_ticket') THEN
      RAISE EXCEPTION 'registration_cancellation_snapshot_mismatch';
    END IF;
    NEW.cancellation_policy_snapshot_id := v_snapshot_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER attach_registration_cancellation_snapshot
  BEFORE INSERT OR UPDATE OF metadata ON public.session_registrations
  FOR EACH ROW EXECUTE FUNCTION public.attach_registration_cancellation_snapshot();

CREATE OR REPLACE FUNCTION public.enforce_new_booking_cancellation_contract()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_enabled_at TIMESTAMPTZ;
BEGIN
  IF NEW.status::TEXT <> 'confirmed' THEN RETURN NEW; END IF;
  SELECT enabled_at INTO v_enabled_at FROM public.cancellation_policy_cutovers
  WHERE venue_id=NEW.venue_id AND authority_key='court_booking';
  IF v_enabled_at IS NULL THEN RAISE EXCEPTION 'cancellation_policy_family_not_enabled:court_booking'; END IF;
  IF NEW.cancellation_policy_snapshot_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cancellation_policy_snapshots snapshot
      WHERE snapshot.id=NEW.cancellation_policy_snapshot_id
        AND snapshot.venue_id=NEW.venue_id
        AND snapshot.authority_key='court_booking'
        AND snapshot.terms_accepted_at >= v_enabled_at
    ) THEN RAISE EXCEPTION 'cancellation_policy_snapshot_mismatch'; END IF;
  ELSIF NEW.cancellation_policy_legacy_purchase_at IS NULL
    OR NEW.cancellation_policy_legacy_purchase_at >= v_enabled_at THEN
    RAISE EXCEPTION 'cancellation_policy_snapshot_required_after_cutover:court_booking';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_new_booking_cancellation_contract
  BEFORE INSERT OR UPDATE OF status,cancellation_policy_snapshot_id,cancellation_policy_legacy_purchase_at
  ON public.bookings FOR EACH ROW
  EXECUTE FUNCTION public.enforce_new_booking_cancellation_contract();

-- R2A stays the only refund command/reconciliation engine. Cancellation adds
-- a receipt target for legacy booking/co-player payments and a decision link.
ALTER TABLE public.commerce_refunds
  ALTER COLUMN commerce_order_id DROP NOT NULL,
  ADD COLUMN booking_receipt_id UUID REFERENCES public.booking_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN cancellation_decision_id UUID REFERENCES public.cancellation_decisions(id) ON DELETE RESTRICT;
ALTER TABLE public.commerce_refunds
  DROP CONSTRAINT commerce_refunds_refund_type_check,
  DROP CONSTRAINT commerce_refunds_commerce_order_id_idempotency_key_key;
ALTER TABLE public.commerce_refunds
  ADD CONSTRAINT commerce_refunds_refund_type_check CHECK (
    refund_type IN ('quantity', 'goodwill', 'external_unallocated', 'policy')
  ),
  ADD CONSTRAINT commerce_refunds_target_check CHECK (
    num_nonnulls(commerce_order_id, booking_receipt_id) = 1
  ),
  ADD CONSTRAINT commerce_refunds_policy_decision_check CHECK (
    (refund_type = 'policy' AND cancellation_decision_id IS NOT NULL)
    OR (refund_type <> 'policy' AND cancellation_decision_id IS NULL)
  );
CREATE UNIQUE INDEX commerce_refunds_order_idempotency
  ON public.commerce_refunds (commerce_order_id, idempotency_key)
  WHERE commerce_order_id IS NOT NULL;
CREATE UNIQUE INDEX commerce_refunds_receipt_idempotency
  ON public.commerce_refunds (booking_receipt_id, idempotency_key)
  WHERE booking_receipt_id IS NOT NULL;
CREATE UNIQUE INDEX commerce_refunds_cancellation_decision_once
  ON public.commerce_refunds (cancellation_decision_id)
  WHERE cancellation_decision_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reject_cancellation_immutable_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'cancellation_record_is_immutable';
END;
$$;

CREATE TRIGGER cancellation_policy_versions_immutable
  BEFORE UPDATE OR DELETE ON public.cancellation_policy_versions
  FOR EACH ROW WHEN (OLD.lifecycle_status = 'published')
  EXECUTE FUNCTION public.reject_cancellation_immutable_mutation();
CREATE TRIGGER cancellation_policy_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.cancellation_policy_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.reject_cancellation_immutable_mutation();
CREATE TRIGGER cancellation_decisions_immutable
  BEFORE UPDATE OR DELETE ON public.cancellation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_cancellation_immutable_mutation();

CREATE OR REPLACE FUNCTION public.ensure_cancellation_policy_presets(p_venue_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_preset RECORD;
  v_policy_id UUID;
  v_version_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id) THEN
    RAISE EXCEPTION 'cancellation_policy_venue_not_found';
  END IF;

  FOR v_preset IN
    SELECT * FROM (VALUES
      ('standard_12h', 'occurrence_ticket', 'Standard 12 h',
       jsonb_build_object('cancel_anchor','start_at','cancel_offset_minutes',0,'refund_mode','automatic','refund_percentage',100,'refund_anchor','start_at','refund_offset_minutes',720,'refund_comparison','strict_before','entitlement_restore_mode','measurable_before_refund_deadline','customer_locks',jsonb_build_array('checked_in')),
       jsonb_build_object('title','Avbokning Standard 12 h','summary','Avboka fram till start. Full återbetalning och återställning av mätbar rättighet endast strikt tidigare än 12 timmar före start.','late','Inom 12 timmar återbetalas inte avgiften. Platsen släpps direkt.','boundary','Exakt 12 timmar före start räknas som sen avbokning.'),
       jsonb_build_object('title','Standard 12-hour cancellation','summary','Cancel until start. Full refund and measurable entitlement restoration only strictly earlier than 12 hours before start.','late','Within 12 hours the fee is not refunded. The place is released immediately.','boundary','Exactly 12 hours before start counts as a late cancellation.')),
      ('court_24h', 'court_booking', 'Court 24 h',
       jsonb_build_object('cancel_anchor','start_at','cancel_offset_minutes',0,'refund_mode','automatic','refund_percentage',100,'refund_anchor','start_at','refund_offset_minutes',1440,'refund_comparison','strict_before','entitlement_restore_mode','measurable_before_refund_deadline','customer_locks',jsonb_build_array('checked_in')),
       jsonb_build_object('title','Banbokning 24 h','summary','Avboka fram till bokningsstart. Full återbetalning och återställning av inkluderade medlemstimmar endast strikt tidigare än 24 timmar före start.','late','Inom 24 timmar återbetalas inte betalning eller inkluderade timmar. Banan släpps direkt.','boundary','Exakt 24 timmar före start räknas som sen avbokning.'),
       jsonb_build_object('title','Court booking 24-hour cancellation','summary','Cancel until booking start. Full refund and restoration of included member hours only strictly earlier than 24 hours before start.','late','Within 24 hours payment and included hours are not restored. The court is released immediately.','boundary','Exactly 24 hours before start counts as a late cancellation.')),
      ('course_48h', 'managed_course', 'Course 48 h',
       jsonb_build_object('cancel_anchor','start_at','cancel_offset_minutes',0,'refund_mode','automatic','refund_percentage',100,'refund_anchor','start_at','refund_offset_minutes',2880,'refund_comparison','strict_before','entitlement_restore_mode','none','customer_locks',jsonb_build_array('course_started','checked_in')),
       jsonb_build_object('title','Kursplats 48 h','summary','Hela kursplatsen kan avbokas före kursstart. Full återbetalning endast strikt tidigare än 48 timmar före första kurstillfället.','late','Från 48 timmar före kursstart ges ingen återbetalning. Efter kursstart kan platsen inte avbokas i självservice.','boundary','Exakt 48 timmar före kursstart räknas som sen avbokning.'),
       jsonb_build_object('title','Course place 48-hour cancellation','summary','The whole course place can be cancelled before the course starts. Full refund only strictly earlier than 48 hours before the first course occurrence.','late','From 48 hours before course start there is no refund. After the course starts the place cannot be self-cancelled.','boundary','Exactly 48 hours before course start counts as a late cancellation.')),
      ('league_registration_close', 'league_team', 'League registration close',
       jsonb_build_object('cancel_anchor','registration_close_at','cancel_offset_minutes',0,'refund_mode','automatic','refund_percentage',100,'refund_anchor','registration_close_at','refund_offset_minutes',0,'refund_comparison','strict_before','entitlement_restore_mode','none','customer_locks',jsonb_build_array('registration_closed','fixtures_published','league_started')),
       jsonb_build_object('title','Seriespel – anmälningsstängning','summary','Laget kan avbokas med full återbetalning strikt före anmälningsstängning.','late','Vid eller efter anmälningsstängning är självservice låst. Publicerat spelschema eller startat seriespel låser också avbokning.','boundary','Exakt vid anmälningsstängning är avbokning låst.'),
       jsonb_build_object('title','League – registration close','summary','The team can be cancelled with a full refund strictly before registration closes.','late','At or after registration close, self-service is locked. Published fixtures or a started league also lock cancellation.','boundary','Exactly at registration close cancellation is locked.')),
      ('event_24h', 'event', 'Event 24 h',
       jsonb_build_object('cancel_anchor','start_at','cancel_offset_minutes',0,'refund_mode','automatic','refund_percentage',100,'refund_anchor','start_at','refund_offset_minutes',1440,'refund_comparison','strict_before','entitlement_restore_mode','none','customer_locks',jsonb_build_array('checked_in')),
       jsonb_build_object('title','Event 24 h','summary','Avboka fram till eventstart. Full återbetalning endast strikt tidigare än 24 timmar före start.','late','Inom 24 timmar ges ingen återbetalning. Platsen släpps direkt.','boundary','Exakt 24 timmar före start räknas som sen avbokning.'),
       jsonb_build_object('title','Event 24-hour cancellation','summary','Cancel until the event starts. Full refund only strictly earlier than 24 hours before start.','late','Within 24 hours there is no refund. The place is released immediately.','boundary','Exactly 24 hours before start counts as a late cancellation.')),
      ('event_non_refundable', 'event', 'Event non-refundable',
       jsonb_build_object('cancel_anchor','start_at','cancel_offset_minutes',0,'refund_mode','none','refund_percentage',0,'refund_anchor','start_at','refund_offset_minutes',0,'refund_comparison','strict_before','entitlement_restore_mode','none','customer_locks',jsonb_build_array('checked_in')),
       jsonb_build_object('title','Event – ej återbetalningsbart','summary','Biljetten kan avbokas fram till eventstart, men avgiften återbetalas inte.','late','Platsen släpps direkt när du avbokar.','boundary','Ingen tidpunkt ger rätt till automatisk återbetalning.'),
       jsonb_build_object('title','Event – non-refundable','summary','The ticket can be cancelled until the event starts, but the fee is not refunded.','late','The place is released immediately when you cancel.','boundary','No time qualifies for an automatic refund.'))
    ) AS presets(policy_key, policy_family, name, rules, copy_sv, copy_en)
  LOOP
    INSERT INTO public.cancellation_policies (venue_id, policy_key, policy_family, name)
    VALUES (p_venue_id, v_preset.policy_key, v_preset.policy_family, v_preset.name)
    ON CONFLICT (venue_id, policy_key) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_policy_id;

    INSERT INTO public.cancellation_policy_versions (
      policy_id, version, lifecycle_status, preset_key, rules, copy_sv, copy_en,
      change_note, published_at
    ) VALUES (
      v_policy_id, 1, 'published', v_preset.policy_key, v_preset.rules,
      v_preset.copy_sv, v_preset.copy_en, 'Cancellation Policy V1 initial preset', now()
    ) ON CONFLICT (policy_id, version) DO NOTHING;

    SELECT id INTO v_version_id FROM public.cancellation_policy_versions
    WHERE policy_id = v_policy_id AND version = 1;

    IF v_preset.policy_family <> 'event' THEN
      INSERT INTO public.cancellation_policy_bindings (
        venue_id, policy_family, subject_type, subject_id, policy_version_id
      ) VALUES (
        p_venue_id, v_preset.policy_family, 'family_default', NULL, v_version_id
      ) ON CONFLICT (
        venue_id, policy_family, subject_type,
        (COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::UUID))
      ) WHERE is_active DO NOTHING;
    END IF;
    IF v_preset.policy_key = 'standard_12h' THEN
      INSERT INTO public.cancellation_policy_bindings (
        venue_id, policy_family, subject_type, subject_id, policy_version_id
      ) VALUES (
        p_venue_id, 'booking_participant', 'family_default', NULL, v_version_id
      ) ON CONFLICT (
        venue_id, policy_family, subject_type,
        (COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::UUID))
      ) WHERE is_active DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO public.cancellation_policy_cutovers (
    venue_id, authority_key, policy_family, preset_key, enabled_at
  )
  SELECT p_venue_id, authority_key, policy_family, preset_key, now()
  FROM (VALUES
    ('occurrence_ticket', 'occurrence_ticket', 'standard_12h'),
    ('booking_participant', 'booking_participant', 'standard_12h'),
    ('court_booking', 'court_booking', 'court_24h'),
    ('managed_course', 'managed_course', 'course_48h'),
    ('league_team', 'league_team', 'league_registration_close'),
    ('refundable_event', 'event', 'event_24h'),
    ('non_refundable_event', 'event', 'event_non_refundable')
  ) AS enabled(authority_key, policy_family, preset_key)
  ON CONFLICT (venue_id, authority_key) DO NOTHING;
END;
$$;

DO $$ DECLARE v_venue RECORD;
BEGIN
  FOR v_venue IN SELECT id FROM public.venues LOOP
    PERFORM public.ensure_cancellation_policy_presets(v_venue.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_cancellation_policies_for_new_venue()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.ensure_cancellation_policy_presets(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER ensure_cancellation_policies_after_venue_insert
  AFTER INSERT ON public.venues FOR EACH ROW
  EXECUTE FUNCTION public.ensure_cancellation_policies_for_new_venue();

CREATE OR REPLACE FUNCTION public.create_cancellation_policy_snapshot(
  p_venue_id UUID,
  p_policy_family TEXT,
  p_purchase_reference_type TEXT,
  p_purchase_reference_id UUID,
  p_start_at TIMESTAMPTZ,
  p_registration_close_at TIMESTAMPTZ DEFAULT NULL,
  p_access_product_id UUID DEFAULT NULL,
  p_activity_series_id UUID DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_payer_user_id UUID DEFAULT NULL,
  p_payer_customer_id UUID DEFAULT NULL,
  p_payment_provenance JSONB DEFAULT '{}'::JSONB,
  p_funding_provenance JSONB DEFAULT '{}'::JSONB
) RETURNS public.cancellation_policy_snapshots
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing public.cancellation_policy_snapshots%ROWTYPE;
  v_binding public.cancellation_policy_bindings%ROWTYPE;
  v_version public.cancellation_policy_versions%ROWTYPE;
  v_policy public.cancellation_policies%ROWTYPE;
  v_cutover public.cancellation_policy_cutovers%ROWTYPE;
  v_authority_key TEXT;
  v_anchor TIMESTAMPTZ;
  v_refund_anchor TIMESTAMPTZ;
  v_snapshot public.cancellation_policy_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO v_existing FROM public.cancellation_policy_snapshots
  WHERE purchase_reference_type = p_purchase_reference_type
    AND purchase_reference_id = p_purchase_reference_id;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing; END IF;
  IF p_policy_family NOT IN (
    'occurrence_ticket', 'booking_participant', 'court_booking',
    'managed_course', 'league_team', 'event'
  ) THEN RAISE EXCEPTION 'invalid_cancellation_policy_family'; END IF;

  SELECT binding.* INTO v_binding
  FROM public.cancellation_policy_bindings binding
  JOIN public.cancellation_policy_versions version ON version.id = binding.policy_version_id
  WHERE binding.venue_id = p_venue_id
    AND binding.policy_family = p_policy_family
    AND binding.is_active
    AND version.lifecycle_status = 'published'
    AND (
      (binding.subject_type = 'event' AND binding.subject_id = p_event_id)
      OR (binding.subject_type = 'activity_series' AND binding.subject_id = p_activity_series_id)
      OR (binding.subject_type = 'access_product' AND binding.subject_id = p_access_product_id)
      OR binding.subject_type = 'family_default'
    )
  ORDER BY CASE binding.subject_type
    WHEN 'event' THEN 1 WHEN 'activity_series' THEN 2
    WHEN 'access_product' THEN 3 ELSE 4 END
  LIMIT 1;
  IF v_binding.id IS NULL THEN
    RAISE EXCEPTION 'cancellation_policy_missing_for_new_sale:%', p_policy_family;
  END IF;

  SELECT * INTO v_version FROM public.cancellation_policy_versions WHERE id = v_binding.policy_version_id;
  SELECT * INTO v_policy FROM public.cancellation_policies WHERE id = v_version.policy_id;
  v_authority_key := CASE
    WHEN p_policy_family = 'event' AND v_version.preset_key = 'event_24h' THEN 'refundable_event'
    WHEN p_policy_family = 'event' AND v_version.preset_key = 'event_non_refundable' THEN 'non_refundable_event'
    ELSE p_policy_family
  END;
  SELECT * INTO v_cutover
  FROM public.cancellation_policy_cutovers cutover
  WHERE cutover.venue_id = p_venue_id
    AND cutover.authority_key = v_authority_key
    AND cutover.policy_family = p_policy_family
    AND cutover.preset_key = v_version.preset_key
    AND cutover.schema_version = 1;
  IF v_cutover.id IS NULL THEN
    RAISE EXCEPTION 'cancellation_policy_family_not_enabled:%', v_authority_key;
  END IF;
  v_anchor := CASE v_version.rules->>'cancel_anchor'
    WHEN 'registration_close_at' THEN p_registration_close_at ELSE p_start_at END;
  v_refund_anchor := CASE v_version.rules->>'refund_anchor'
    WHEN 'registration_close_at' THEN p_registration_close_at ELSE p_start_at END;
  IF v_anchor IS NULL THEN RAISE EXCEPTION 'cancellation_policy_anchor_missing'; END IF;
  IF v_version.rules->>'refund_mode' = 'automatic' AND v_refund_anchor IS NULL THEN
    RAISE EXCEPTION 'cancellation_refund_anchor_missing';
  END IF;

  INSERT INTO public.cancellation_policy_snapshots (
    venue_id, policy_family, policy_version_id, cutover_id, authority_key,
    policy_key, policy_version,
    provenance, purchase_reference_type, purchase_reference_id,
    start_at, registration_close_at, cancel_deadline_at, refund_deadline_at,
    rules, copy_sv, copy_en, copy_schema_version, payer_user_id, payer_customer_id,
    payment_provenance, funding_provenance, resolved_from_binding_id,
    terms_accepted_at
  ) VALUES (
    p_venue_id, p_policy_family, v_version.id, v_cutover.id, v_authority_key,
    v_policy.policy_key, v_version.version,
    v_binding.subject_type, p_purchase_reference_type, p_purchase_reference_id,
    p_start_at, p_registration_close_at,
    v_anchor - make_interval(mins => (v_version.rules->>'cancel_offset_minutes')::INTEGER),
    CASE WHEN v_version.rules->>'refund_mode' = 'automatic'
      THEN v_refund_anchor - make_interval(mins => (v_version.rules->>'refund_offset_minutes')::INTEGER)
      ELSE NULL END,
    v_version.rules, v_version.copy_sv, v_version.copy_en, v_version.copy_schema_version,
    p_payer_user_id, p_payer_customer_id, COALESCE(p_payment_provenance, '{}'::JSONB),
    COALESCE(p_funding_provenance, '{}'::JSONB), v_binding.id, now()
  ) RETURNING * INTO v_snapshot;
  RETURN v_snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancellation_subject_state(
  p_subject_type TEXT,
  p_subject_id UUID,
  p_actor_user_id UUID,
  p_staff_override BOOLEAN DEFAULT false,
  p_now TIMESTAMPTZ DEFAULT now(),
  p_staff_refund_choice TEXT DEFAULT 'policy',
  p_staff_restore_choice TEXT DEFAULT 'policy'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_snapshot public.cancellation_policy_snapshots%ROWTYPE;
  v_venue_id UUID; v_owner_user_id UUID; v_owner_customer_id UUID;
  v_status TEXT; v_updated_at TIMESTAMPTZ; v_checked_in BOOLEAN := false;
  v_amount INTEGER := 0; v_currency TEXT := 'SEK'; v_order_id UUID;
  v_receipt_id UUID; v_payment_intent TEXT;
  v_fixtures_published TIMESTAMPTZ; v_series_started BOOLEAN := false;
  v_allowed BOOLEAN; v_reason TEXT; v_refund_amount INTEGER := 0;
  v_refund_mode TEXT := 'none'; v_restore TEXT := 'not_applicable';
  v_revision TEXT; v_customer_user_id UUID; v_line_id UUID; v_scope_revision TEXT;
  v_policy_mode TEXT := 'policy_v1'; v_policy_family TEXT; v_policy_key TEXT;
  v_policy_version INTEGER; v_provenance TEXT; v_authority_key TEXT;
  v_purchase_at TIMESTAMPTZ; v_cutover_at TIMESTAMPTZ; v_start_at TIMESTAMPTZ;
  v_registration_close_at TIMESTAMPTZ; v_cancel_deadline_at TIMESTAMPTZ;
  v_refund_deadline_at TIMESTAMPTZ; v_rules JSONB; v_copy_sv JSONB; v_copy_en JSONB;
  v_payer_user_id UUID; v_payer_customer_id UUID; v_funding JSONB := '{}'::JSONB;
  v_included_court_hours NUMERIC := 0; v_group_stripe_session TEXT;
BEGIN
  IF p_staff_refund_choice NOT IN ('policy','full','none') THEN
    RAISE EXCEPTION 'invalid_staff_refund_choice';
  END IF;
  IF p_staff_restore_choice NOT IN ('policy','restore','none') THEN
    RAISE EXCEPTION 'invalid_staff_restore_choice';
  END IF;
  IF NOT p_staff_override AND (p_staff_refund_choice <> 'policy' OR p_staff_restore_choice <> 'policy') THEN
    RAISE EXCEPTION 'customer_cannot_override_cancellation_consequence';
  END IF;

  IF p_subject_type = 'activity_registration' THEN
    SELECT COALESCE(line.cancellation_policy_snapshot_id, registration.cancellation_policy_snapshot_id), registration.venue_id, registration.user_id,
      registration.customer_id, registration.status, registration.updated_at,
      order_row.id, line.line_total_inc_vat_minor, order_row.currency,
      order_row.booking_receipt_id, order_row.stripe_payment_intent_id, line.id,
      COALESCE(order_row.checkout_frozen_at, order_row.paid_at, order_row.created_at,
        registration.registered_at),
      ((registration.session_date::TEXT || 'T' || COALESCE(session.start_time::TEXT,'00:00:00'))::TIMESTAMP
        AT TIME ZONE 'Europe/Stockholm')
    INTO v_snapshot.id, v_venue_id, v_owner_user_id, v_owner_customer_id,
      v_status, v_updated_at, v_order_id, v_amount, v_currency, v_receipt_id,
      v_payment_intent, v_line_id, v_purchase_at, v_start_at
    FROM public.session_registrations registration
    LEFT JOIN public.commerce_order_lines line ON line.session_registration_id = registration.id
      AND line.commerce_kind = 'participation'
    LEFT JOIN public.commerce_orders order_row ON order_row.id = line.commerce_order_id
    JOIN public.activity_sessions session ON session.id = registration.activity_session_id
    WHERE registration.id = p_subject_id
    ORDER BY line.created_at DESC NULLS LAST LIMIT 1;
    v_policy_family := 'occurrence_ticket';
    v_checked_in := v_status IN ('checked_in','no_show') OR EXISTS (
      SELECT 1 FROM public.entitlement_consumptions consumption
      WHERE consumption.registration_id = p_subject_id AND consumption.event_type = 'use'
        AND NOT EXISTS (SELECT 1 FROM public.entitlement_consumptions reversal
          WHERE reversal.reverses_consumption_id = consumption.id AND reversal.event_type = 'reversal')
    );
    IF v_order_id IS NULL THEN
      SELECT receipt.id, receipt.stripe_payment_intent_id,
        round(COALESCE(receipt.total_inc_vat_sek,receipt.total_inc_vat::NUMERIC,0)*100)::INTEGER,
        receipt.currency
      INTO v_receipt_id,v_payment_intent,v_amount,v_currency
      FROM public.session_registrations registration
      LEFT JOIN public.booking_receipts receipt ON receipt.stripe_session_id=registration.stripe_session_id
      WHERE registration.id=p_subject_id
      ORDER BY receipt.created_at DESC NULLS LAST LIMIT 1;
    END IF;
  ELSIF p_subject_type = 'series_commitment' THEN
    SELECT line.cancellation_policy_snapshot_id, commitment.venue_id,
      customer.auth_user_id, commitment.payer_customer_id, commitment.status,
      commitment.updated_at, order_row.id, line.line_total_inc_vat_minor,
      order_row.currency, order_row.booking_receipt_id, order_row.stripe_payment_intent_id,
      line.id, COALESCE(order_row.checkout_frozen_at, order_row.paid_at,
        order_row.created_at, commitment.created_at),
      ((series.start_date::TEXT || 'T' || COALESCE(series.start_time::TEXT,'00:00:00'))::TIMESTAMP
        AT TIME ZONE 'Europe/Stockholm'), series.registration_closes_at
    INTO v_snapshot.id, v_venue_id, v_owner_user_id, v_owner_customer_id,
      v_status, v_updated_at, v_order_id, v_amount, v_currency, v_receipt_id,
      v_payment_intent, v_line_id, v_purchase_at, v_start_at,
      v_registration_close_at
    FROM public.series_commitments commitment
    LEFT JOIN public.customers customer ON customer.id = commitment.payer_customer_id
    LEFT JOIN public.commerce_order_lines line ON line.id = commitment.commerce_order_line_id
    LEFT JOIN public.commerce_orders order_row ON order_row.id = commitment.commerce_order_id
    JOIN public.activity_series series ON series.id = commitment.activity_series_id
    WHERE commitment.id = p_subject_id;
    v_policy_family := 'managed_course';
    SELECT EXISTS (SELECT 1 FROM public.session_registrations registration
      WHERE registration.series_commitment_id = p_subject_id
        AND registration.status IN ('checked_in','no_show')) INTO v_checked_in;
  ELSIF p_subject_type = 'league_team_entry' THEN
    SELECT line.cancellation_policy_snapshot_id, season.venue_id, customer.auth_user_id,
      entry.payer_customer_id, entry.status, entry.updated_at, order_row.id,
      line.line_total_inc_vat_minor, order_row.currency, order_row.booking_receipt_id,
      order_row.stripe_payment_intent_id, line.id, season.fixtures_published_at,
      (p_now >= ((series.start_date::TEXT || 'T' || COALESCE(series.start_time::TEXT,'00:00:00'))::TIMESTAMP AT TIME ZONE 'Europe/Stockholm')),
      COALESCE(order_row.checkout_frozen_at, order_row.paid_at,
        order_row.created_at, entry.created_at),
      ((series.start_date::TEXT || 'T' || COALESCE(series.start_time::TEXT,'00:00:00'))::TIMESTAMP
        AT TIME ZONE 'Europe/Stockholm'), series.registration_closes_at
    INTO v_snapshot.id, v_venue_id, v_owner_user_id, v_owner_customer_id,
      v_status, v_updated_at, v_order_id, v_amount, v_currency, v_receipt_id,
      v_payment_intent, v_line_id, v_fixtures_published, v_series_started
      , v_purchase_at, v_start_at, v_registration_close_at
    FROM public.league_team_entries entry
    JOIN public.league_seasons season ON season.id = entry.league_season_id
    JOIN public.activity_series series ON series.id = season.activity_series_id
    LEFT JOIN public.customers customer ON customer.id = entry.payer_customer_id
    LEFT JOIN public.commerce_order_lines line ON line.id = entry.commerce_order_line_id
    LEFT JOIN public.commerce_orders order_row ON order_row.id = entry.commerce_order_id
    WHERE entry.id = p_subject_id;
    v_policy_family := 'league_team';
  ELSIF p_subject_type = 'court_booking' THEN
    SELECT booking.cancellation_policy_snapshot_id, booking.venue_id,
      COALESCE(booking.user_id, booking.booked_by), booking.customer_id,
      booking.status::TEXT, booking.updated_at, booking.currency,
      receipt.id, receipt.stripe_payment_intent_id,
      round(COALESCE(receipt.total_inc_vat_sek, receipt.total_inc_vat::NUMERIC, booking.total_price, 0) * 100)::INTEGER,
      COALESCE(booking.cancellation_policy_legacy_purchase_at,booking.created_at),
      booking.start_time, booking.included_court_hours,
      booking.stripe_session_id
    INTO v_snapshot.id, v_venue_id, v_owner_user_id, v_owner_customer_id,
      v_status, v_updated_at, v_currency, v_receipt_id, v_payment_intent, v_amount
      , v_purchase_at, v_start_at, v_included_court_hours, v_group_stripe_session
    FROM public.bookings booking
    LEFT JOIN public.booking_receipts receipt ON receipt.stripe_session_id = booking.stripe_session_id
    WHERE booking.id = p_subject_id ORDER BY receipt.created_at DESC NULLS LAST LIMIT 1;
    v_policy_family := 'court_booking';
    SELECT string_agg(concat_ws(':', booking.id::TEXT, booking.status::TEXT,
      COALESCE(booking.updated_at::TEXT,'')), '|' ORDER BY booking.id)
    INTO v_scope_revision
    FROM public.bookings booking
    WHERE (v_snapshot.id IS NOT NULL AND booking.cancellation_policy_snapshot_id = v_snapshot.id)
      OR (v_snapshot.id IS NULL AND booking.cancellation_policy_snapshot_id IS NULL
        AND ((v_group_stripe_session IS NOT NULL AND booking.stripe_session_id = v_group_stripe_session)
          OR (v_group_stripe_session IS NULL AND booking.id = p_subject_id)));
    v_checked_in := EXISTS (
      SELECT 1 FROM public.venue_checkins checkin
      JOIN public.access_entitlements entitlement ON entitlement.id = checkin.entitlement_id
      WHERE checkin.checked_out_at IS NULL
        AND entitlement.source_type IN ('booking','court_booking')
        AND entitlement.source_id = p_subject_id
    );
  ELSIF p_subject_type = 'booking_participant' THEN
    SELECT participant.cancellation_policy_snapshot_id, participant.venue_id,
      participant.user_id, participant.customer_id, participant.payment_status,
      participant.updated_at, participant.currency, participant.booking_receipt_id,
      receipt.stripe_payment_intent_id, participant.price_minor, participant.checked_in_at IS NOT NULL
      , participant.created_at, booking.start_time
    INTO v_snapshot.id, v_venue_id, v_owner_user_id, v_owner_customer_id,
      v_status, v_updated_at, v_currency, v_receipt_id, v_payment_intent,
      v_amount, v_checked_in
      , v_purchase_at, v_start_at
    FROM public.booking_participants participant
    JOIN public.bookings booking ON booking.id = participant.booking_id
    LEFT JOIN public.booking_receipts receipt ON receipt.id = participant.booking_receipt_id
    WHERE participant.id = p_subject_id;
    v_policy_family := 'booking_participant';
  ELSE
    RAISE EXCEPTION 'unsupported_cancellation_subject';
  END IF;

  IF v_venue_id IS NULL THEN RAISE EXCEPTION 'cancellation_subject_not_found'; END IF;
  IF v_owner_user_id IS NULL AND v_owner_customer_id IS NOT NULL THEN
    SELECT auth_user_id INTO v_customer_user_id FROM public.customers WHERE id = v_owner_customer_id;
    v_owner_user_id := v_customer_user_id;
  END IF;
  IF NOT p_staff_override AND (p_actor_user_id IS NULL OR v_owner_user_id IS DISTINCT FROM p_actor_user_id) THEN
    RAISE EXCEPTION 'cancellation_owner_mismatch';
  END IF;

  IF v_snapshot.id IS NOT NULL THEN
    SELECT * INTO v_snapshot FROM public.cancellation_policy_snapshots WHERE id = v_snapshot.id;
    SELECT cutover.enabled_at INTO v_cutover_at
    FROM public.cancellation_policy_cutovers cutover
    WHERE cutover.id = v_snapshot.cutover_id
      AND cutover.venue_id = v_snapshot.venue_id
      AND cutover.authority_key = v_snapshot.authority_key
      AND cutover.policy_family = v_snapshot.policy_family;
    IF v_cutover_at IS NULL OR v_snapshot.terms_accepted_at < v_cutover_at THEN
      RAISE EXCEPTION 'cancellation_policy_snapshot_cutover_mismatch';
    END IF;
    v_policy_mode := 'policy_v1';
    v_policy_family := v_snapshot.policy_family;
    v_policy_key := v_snapshot.policy_key;
    v_policy_version := v_snapshot.policy_version;
    v_provenance := v_snapshot.provenance;
    v_authority_key := v_snapshot.authority_key;
    v_cancel_deadline_at := v_snapshot.cancel_deadline_at;
    v_refund_deadline_at := v_snapshot.refund_deadline_at;
    v_rules := v_snapshot.rules;
    v_copy_sv := v_snapshot.copy_sv;
    v_copy_en := v_snapshot.copy_en;
    v_payer_user_id := v_snapshot.payer_user_id;
    v_payer_customer_id := v_snapshot.payer_customer_id;
    v_funding := v_snapshot.funding_provenance;
  ELSE
    v_authority_key := v_policy_family;
    SELECT cutover.enabled_at INTO v_cutover_at
    FROM public.cancellation_policy_cutovers cutover
    WHERE cutover.venue_id = v_venue_id
      AND cutover.authority_key = v_authority_key
      AND cutover.policy_family = v_policy_family;
    IF v_cutover_at IS NULL THEN
      RAISE EXCEPTION 'cancellation_policy_family_not_enabled:%', v_authority_key;
    END IF;
    IF v_purchase_at IS NULL OR v_purchase_at >= v_cutover_at THEN
      RAISE EXCEPTION 'cancellation_policy_snapshot_required_after_cutover:%', v_authority_key;
    END IF;

    -- This is an operational dispatch marker, never a contractual snapshot.
    -- It preserves the code behavior that existed before Policy V1 and says
    -- explicitly that historical policy details were not captured.
    v_policy_mode := 'legacy';
    v_policy_key := 'legacy-preserved';
    v_policy_version := NULL;
    v_provenance := 'pre_cutover_runtime';
    v_cancel_deadline_at := CASE
      WHEN v_policy_family IN ('court_booking','booking_participant') THEN NULL
      WHEN v_policy_family = 'league_team' THEN v_registration_close_at
      ELSE v_start_at
    END;
    v_refund_deadline_at := CASE
      WHEN v_policy_family IN ('occurrence_ticket','managed_course','league_team')
        THEN v_cancel_deadline_at
      ELSE NULL
    END;
    v_rules := jsonb_build_object(
      'contract_mode','legacy','policy_details','unavailable',
      'refund_mode',CASE
        WHEN v_policy_family IN ('occurrence_ticket','managed_course','league_team') THEN 'automatic'
        ELSE 'none' END,
      'legacy_manual_refund',v_policy_family = 'booking_participant',
      'entitlement_restore_mode',CASE WHEN v_policy_family = 'court_booking'
        THEN 'legacy_measurable' ELSE 'none' END
    );
    v_copy_sv := jsonb_build_object(
      'title','Legacy policy',
      'summary','Köpt före Policy V1. Policyuppgifter saknas; endast den bevarade legacy-konsekvensen visas.',
      'late','Inga nya Policy V1-villkor tillämpas retroaktivt.',
      'boundary','Kontakta Pickla om de historiska villkoren behöver granskas.'
    );
    v_copy_en := jsonb_build_object(
      'title','Legacy policy',
      'summary','Purchased before Policy V1. Policy details are unavailable; only the preserved legacy consequence is shown.',
      'late','No new Policy V1 terms are applied retroactively.',
      'boundary','Contact Pickla if the historical terms need review.'
    );
    v_payer_user_id := v_owner_user_id;
    v_payer_customer_id := v_owner_customer_id;
    IF v_policy_family = 'court_booking' THEN
      v_funding := jsonb_build_object('meter_type',CASE
        WHEN COALESCE(v_included_court_hours,0) > 0 THEN 'court_hours' ELSE 'unlimited' END);
    END IF;
  END IF;

  v_revision := encode(extensions.digest(concat_ws('|', p_subject_type, p_subject_id::TEXT,
    COALESCE(v_status,''), COALESCE(v_updated_at::TEXT,''), v_policy_mode,
    COALESCE(v_snapshot.id::TEXT,'legacy:' || v_cutover_at::TEXT),
    COALESCE(v_cancel_deadline_at::TEXT,''), COALESCE(v_refund_deadline_at::TEXT,''),
    COALESCE(v_fixtures_published::TEXT,''), v_checked_in::TEXT, COALESCE(v_scope_revision,''),
    p_staff_override::TEXT, p_staff_refund_choice, p_staff_restore_choice), 'sha256'::TEXT), 'hex');

  v_allowed := true;
  v_reason := 'allowed';
  IF v_status IN ('cancelled','withdrawn') THEN
    v_allowed := false; v_reason := 'already_cancelled';
  ELSIF NOT p_staff_override AND v_policy_mode = 'policy_v1' AND v_checked_in THEN
    v_allowed := false; v_reason := 'checked_in_locked';
  ELSIF NOT p_staff_override AND p_subject_type = 'league_team_entry'
    AND (v_fixtures_published IS NOT NULL OR v_series_started) THEN
    v_allowed := false; v_reason := CASE WHEN v_fixtures_published IS NOT NULL THEN 'fixtures_published' ELSE 'league_started' END;
  ELSIF NOT p_staff_override AND v_cancel_deadline_at IS NOT NULL
    AND p_now >= v_cancel_deadline_at THEN
    v_allowed := false; v_reason := CASE WHEN v_policy_family = 'managed_course' THEN 'course_started' ELSE 'cancellation_closed' END;
  END IF;

  IF v_allowed AND v_status NOT IN ('cancelled','withdrawn')
    AND v_rules->>'refund_mode' = 'automatic'
    AND v_refund_deadline_at IS NOT NULL
    AND p_now < v_refund_deadline_at
    AND v_amount > 0 THEN
    v_refund_mode := 'automatic_full'; v_refund_amount := v_amount;
  ELSIF v_policy_mode = 'legacy' AND v_policy_family = 'booking_participant'
    AND v_amount > 0 THEN
    v_refund_mode := 'manual_legacy';
  END IF;
  IF v_allowed AND (
      (v_policy_mode = 'legacy' AND v_policy_family = 'court_booking')
      OR (v_policy_mode = 'policy_v1' AND p_now < COALESCE(v_refund_deadline_at,'-infinity'::TIMESTAMPTZ)
        AND v_rules->>'entitlement_restore_mode' = 'measurable_before_refund_deadline')
    ) THEN
    v_restore := CASE
      WHEN v_funding->>'meter_type' IN ('court_hours','occurrences') THEN 'measurable'
      ELSE 'not_applicable'
    END;
  ELSE v_restore := 'none'; END IF;

  IF p_staff_override AND v_allowed THEN
    IF p_staff_refund_choice = 'full' AND v_amount > 0 THEN
      v_refund_mode := 'automatic_full'; v_refund_amount := v_amount;
    ELSIF p_staff_refund_choice = 'none' THEN
      v_refund_mode := 'none'; v_refund_amount := 0;
    END IF;
    IF p_staff_restore_choice = 'restore' THEN
      v_restore := CASE
        WHEN v_funding->>'meter_type' IN ('court_hours','occurrences') THEN 'measurable'
        ELSE 'not_applicable'
      END;
    ELSIF p_staff_restore_choice = 'none' THEN
      v_restore := 'none';
    END IF;
    v_reason := 'operator_override_cutoff';
  ELSIF v_allowed AND v_status NOT IN ('cancelled','withdrawn') THEN
    v_reason := CASE
      WHEN v_policy_mode = 'legacy' THEN 'legacy_cancellation_allowed'
      WHEN v_rules->>'refund_mode' = 'none' THEN 'refund_not_due_non_refundable'
      WHEN v_refund_mode = 'automatic_full' THEN 'customer_cancelled_before_refund_cutoff'
      ELSE 'customer_cancelled_after_refund_cutoff'
    END;
  END IF;

  RETURN jsonb_build_object(
    'subject_type', p_subject_type, 'subject_id', p_subject_id,
    'venue_id', v_venue_id, 'policy_mode', v_policy_mode,
    'snapshot_id', v_snapshot.id, 'authority_key', v_authority_key,
    'policy_family', v_policy_family, 'policy_key', v_policy_key,
    'policy_version', v_policy_version, 'provenance', v_provenance,
    'legacy_policy_details_available', v_policy_mode <> 'legacy',
    'purchase_at', v_purchase_at, 'cutover_at', v_cutover_at,
    'copy_sv', v_copy_sv, 'copy_en', v_copy_en,
    'evaluated_at', p_now, 'state_revision', v_revision, 'decision_revision', v_revision,
    'allowed', v_allowed, 'can_cancel', v_allowed, 'reason_code', v_reason,
    'already_cancelled', v_status IN ('cancelled','withdrawn'),
    'checked_in', v_checked_in, 'checkin_preserved', p_staff_override AND v_checked_in,
    'cancel_deadline_at', v_cancel_deadline_at,
    'refund_deadline_at', v_refund_deadline_at,
    'refund_mode', v_refund_mode, 'refund_eligible', v_refund_mode = 'automatic_full',
    'refund_amount_minor', v_refund_amount,
    'currency', COALESCE(v_currency,'SEK'), 'entitlement_restore_mode', v_restore,
    'entitlement_effect', v_restore, 'capacity_release_mode', 'immediate',
    'capacity_effect', CASE WHEN v_allowed THEN 'release_immediately' ELSE 'none' END,
    'customer_message_key', v_reason,
    'customer_message_params', jsonb_build_object('refund_amount_minor',v_refund_amount,
      'currency',COALESCE(v_currency,'SEK'),'refund_deadline_at',v_refund_deadline_at,
      'cancel_deadline_at',v_cancel_deadline_at),
    'commerce_order_id', v_order_id, 'commerce_order_line_id', v_line_id,
    'booking_receipt_id', v_receipt_id, 'stripe_payment_intent_id', v_payment_intent,
    'payer_user_id', v_payer_user_id, 'payer_customer_id', v_payer_customer_id,
    'rules', v_rules
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_cancellation_policy_v1(
  p_subject_type TEXT,
  p_subject_id UUID,
  p_actor_user_id UUID,
  p_expected_state_revision TEXT,
  p_request_id TEXT,
  p_staff_override BOOLEAN DEFAULT false,
  p_staff_reason TEXT DEFAULT NULL,
  p_provider_environment TEXT DEFAULT 'test',
  p_provider_account_key TEXT DEFAULT 'platform',
  p_staff_refund_choice TEXT DEFAULT 'policy',
  p_staff_restore_choice TEXT DEFAULT 'policy'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_preview JSONB; v_decision public.cancellation_decisions%ROWTYPE;
  v_existing public.cancellation_decisions%ROWTYPE; v_refund public.commerce_refunds%ROWTYPE;
  v_commitment public.series_commitments%ROWTYPE;
  v_line public.commerce_order_lines%ROWTYPE; v_booking public.bookings%ROWTYPE;
  v_consumption RECORD;
  v_refund_amount INTEGER; v_vat INTEGER; v_group_snapshot UUID; v_group_stripe_session TEXT;
  v_restored NUMERIC := 0;
  v_refund_id UUID := gen_random_uuid();
  v_request TEXT := NULLIF(btrim(COALESCE(p_request_id,'')), '');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_staff_reason,'')), '');
BEGIN
  IF v_request IS NULL THEN RAISE EXCEPTION 'cancellation_request_id_required'; END IF;
  IF p_staff_override AND (v_reason IS NULL OR length(v_reason) < 3) THEN
    RAISE EXCEPTION 'staff_override_reason_required';
  END IF;
  IF p_provider_environment NOT IN ('test','live') THEN RAISE EXCEPTION 'invalid_provider_environment'; END IF;

  SELECT * INTO v_existing FROM public.cancellation_decisions
  WHERE subject_type = p_subject_type AND subject_id = p_subject_id AND request_id = v_request;
  IF v_existing.id IS NOT NULL THEN
    SELECT * INTO v_refund FROM public.commerce_refunds WHERE cancellation_decision_id = v_existing.id;
    RETURN v_existing.decision || jsonb_build_object(
      'decision_id',v_existing.id,'idempotent',true,'refund_id',v_refund.id,
      'refund_status',v_refund.status,'provider_request',v_refund.provider_request
    );
  END IF;

  -- Row-level serialization precedes the second, authoritative evaluation.
  IF p_subject_type = 'activity_registration' THEN
    PERFORM 1 FROM public.session_registrations WHERE id = p_subject_id FOR UPDATE;
  ELSIF p_subject_type = 'series_commitment' THEN
    PERFORM 1 FROM public.series_commitments WHERE id = p_subject_id FOR UPDATE;
  ELSIF p_subject_type = 'league_team_entry' THEN
    PERFORM 1 FROM public.league_team_entries WHERE id = p_subject_id FOR UPDATE;
  ELSIF p_subject_type = 'court_booking' THEN
    SELECT cancellation_policy_snapshot_id, stripe_session_id
    INTO v_group_snapshot, v_group_stripe_session
    FROM public.bookings WHERE id = p_subject_id;
    PERFORM 1 FROM public.bookings
    WHERE (v_group_snapshot IS NOT NULL AND cancellation_policy_snapshot_id = v_group_snapshot)
      OR (v_group_snapshot IS NULL AND cancellation_policy_snapshot_id IS NULL
        AND ((v_group_stripe_session IS NOT NULL AND stripe_session_id = v_group_stripe_session)
          OR (v_group_stripe_session IS NULL AND id = p_subject_id)))
    ORDER BY id FOR UPDATE;
  ELSIF p_subject_type = 'booking_participant' THEN
    PERFORM 1 FROM public.booking_participants WHERE id = p_subject_id FOR UPDATE;
  ELSE RAISE EXCEPTION 'unsupported_cancellation_subject'; END IF;

  -- A concurrent retry can pass the optimistic check before the first caller
  -- commits. Re-check after the subject lock so one request id always returns
  -- the already-applied decision instead of racing the unique constraint.
  SELECT * INTO v_existing FROM public.cancellation_decisions
  WHERE subject_type = p_subject_type AND subject_id = p_subject_id AND request_id = v_request;
  IF v_existing.id IS NOT NULL THEN
    SELECT * INTO v_refund FROM public.commerce_refunds WHERE cancellation_decision_id = v_existing.id;
    RETURN v_existing.decision || jsonb_build_object(
      'decision_id',v_existing.id,'idempotent',true,'refund_id',v_refund.id,
      'refund_status',v_refund.status,'provider_request',v_refund.provider_request
    );
  END IF;

  v_preview := public.cancellation_subject_state(
    p_subject_type, p_subject_id, p_actor_user_id, p_staff_override, now(),
    p_staff_refund_choice, p_staff_restore_choice
  );
  IF v_preview->>'state_revision' IS DISTINCT FROM p_expected_state_revision THEN
    RAISE EXCEPTION 'stale_cancellation_preview';
  END IF;
  IF COALESCE((v_preview->>'allowed')::BOOLEAN,false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'cancellation_not_allowed:%', v_preview->>'reason_code';
  END IF;

  INSERT INTO public.cancellation_decisions (
    venue_id, policy_mode, snapshot_id, subject_type, subject_id, request_id, actor_user_id,
    actor_mode, staff_reason, evaluated_at, state_revision, allowed, reason_code,
    refund_mode, refund_amount_minor, currency, entitlement_restore_mode,
    checkin_preserved, decision
  ) VALUES (
    (v_preview->>'venue_id')::UUID, v_preview->>'policy_mode',
    NULLIF(v_preview->>'snapshot_id','')::UUID,
    p_subject_type, p_subject_id, v_request, p_actor_user_id,
    CASE WHEN p_staff_override THEN 'staff_override' ELSE 'customer' END,
    v_reason, (v_preview->>'evaluated_at')::TIMESTAMPTZ,
    v_preview->>'state_revision', true, v_preview->>'reason_code',
    v_preview->>'refund_mode', (v_preview->>'refund_amount_minor')::INTEGER,
    v_preview->>'currency', v_preview->>'entitlement_restore_mode',
    COALESCE((v_preview->>'checkin_preserved')::BOOLEAN,false), v_preview
  ) RETURNING * INTO v_decision;

  -- Participation/capacity truth is committed before and independently of
  -- provider refund execution. This transaction also prepares the durable R2A
  -- refund command when the immutable policy decision requires one.
  IF p_subject_type = 'activity_registration' THEN
    PERFORM public.cancel_activity_registration_participation(
      p_subject_id, NULLIF(v_preview->>'commerce_order_id','')::UUID,
      p_actor_user_id, CASE WHEN p_staff_override THEN 'staff' ELSE 'system' END,
      CASE WHEN p_staff_override THEN v_reason ELSE 'cancellation_policy_v1' END,
      v_request, NULL, now()
    );
    IF v_preview->>'entitlement_restore_mode' = 'measurable' THEN
      FOR v_consumption IN SELECT consumption.id
        FROM public.entitlement_consumptions consumption
        WHERE consumption.registration_id = p_subject_id AND consumption.event_type = 'use'
      LOOP
        PERFORM public.reverse_entitlement_consumption(
          v_consumption.id, 'cancellation-v1:' || v_decision.id::TEXT,
          'Cancellation Policy V1 before refund deadline', now(), p_actor_user_id
        );
      END LOOP;
    END IF;
  ELSIF p_subject_type = 'series_commitment' THEN
    SELECT * INTO v_commitment FROM public.series_commitments WHERE id = p_subject_id;
    PERFORM public.capacity_lock_scope(v_commitment.venue_id, 'activity_series',
      v_commitment.activity_series_id::TEXT,
      (SELECT start_date FROM public.activity_series WHERE id = v_commitment.activity_series_id));
    UPDATE public.series_commitments SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at,now()),
      metadata = metadata || jsonb_build_object('cancellation_decision_id',v_decision.id,'cancel_request_id',v_request),
      updated_at = now() WHERE id = p_subject_id AND status <> 'cancelled';
    UPDATE public.access_entitlements SET status = 'revoked',
      metadata = metadata || jsonb_build_object('cancellation_decision_id',v_decision.id)
      WHERE id = v_commitment.access_entitlement_id AND status <> 'revoked';
    SELECT * INTO v_line FROM public.commerce_order_lines WHERE id = v_commitment.commerce_order_line_id;
    UPDATE public.capacity_holds SET status = 'released', released_at = COALESCE(released_at,now()),
      metadata = metadata || jsonb_build_object('release_reason','cancellation_policy_v1','cancellation_decision_id',v_decision.id)
      WHERE id = v_line.capacity_hold_id AND status IN ('active','committed');
    PERFORM public.reconcile_course_series_participation(v_commitment.activity_series_id);
  ELSIF p_subject_type = 'league_team_entry' THEN
    PERFORM public.cancel_league_team_entry(p_subject_id,p_actor_user_id,v_request,
      CASE WHEN p_staff_override THEN v_reason ELSE 'cancellation_policy_v1' END,true);
  ELSIF p_subject_type = 'court_booking' THEN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_subject_id;
    v_group_snapshot := v_booking.cancellation_policy_snapshot_id;
    v_group_stripe_session := v_booking.stripe_session_id;
    IF v_preview->>'entitlement_restore_mode' = 'measurable' THEN
      WITH restoration AS (
        SELECT user_id, venue_id, membership_usage_period_start AS period_start,
          sum(included_court_hours) AS restore_value
        FROM public.bookings
        WHERE status <> 'cancelled' AND (
          (v_group_snapshot IS NOT NULL AND cancellation_policy_snapshot_id = v_group_snapshot)
          OR (v_group_snapshot IS NULL AND cancellation_policy_snapshot_id IS NULL
            AND ((v_group_stripe_session IS NOT NULL AND stripe_session_id = v_group_stripe_session)
              OR (v_group_stripe_session IS NULL AND id = p_subject_id)))
        )
          AND included_court_hours > 0 AND membership_usage_period_start IS NOT NULL
        GROUP BY user_id, venue_id, membership_usage_period_start
      )
      UPDATE public.membership_usage usage SET
        used_value = GREATEST(usage.used_value - restoration.restore_value,0), updated_at = now()
      FROM restoration WHERE usage.user_id = restoration.user_id
        AND usage.venue_id = restoration.venue_id
        AND usage.entitlement_type = 'court_hours_per_week'
        AND usage.period_start = restoration.period_start;
      SELECT COALESCE(sum(included_court_hours),0) INTO v_restored FROM public.bookings
        WHERE status <> 'cancelled' AND (
          (v_group_snapshot IS NOT NULL AND cancellation_policy_snapshot_id = v_group_snapshot)
          OR (v_group_snapshot IS NULL AND cancellation_policy_snapshot_id IS NULL
            AND ((v_group_stripe_session IS NOT NULL AND stripe_session_id = v_group_stripe_session)
              OR (v_group_stripe_session IS NULL AND id = p_subject_id)))
        );
    END IF;
    UPDATE public.bookings SET status = 'cancelled', updated_at = now(),
      notes = concat_ws(E'\n',NULLIF(notes,''),'cancellation_decision:' || v_decision.id::TEXT)
      WHERE status <> 'cancelled' AND (
        (v_group_snapshot IS NOT NULL AND cancellation_policy_snapshot_id = v_group_snapshot)
        OR (v_group_snapshot IS NULL AND cancellation_policy_snapshot_id IS NULL
          AND ((v_group_stripe_session IS NOT NULL AND stripe_session_id = v_group_stripe_session)
            OR (v_group_stripe_session IS NULL AND id = p_subject_id)))
      );
  ELSIF p_subject_type = 'booking_participant' THEN
    PERFORM public.cancel_booking_participant_capacity(p_subject_id,p_actor_user_id,
      jsonb_build_object('cancellation_decision_id',v_decision.id,'cancel_request_id',v_request,
        'staff_override',p_staff_override,'staff_reason',v_reason));
  END IF;

  v_refund_amount := (v_preview->>'refund_amount_minor')::INTEGER;
  IF v_preview->>'refund_mode' = 'automatic_full' AND v_refund_amount > 0 THEN
    IF NULLIF(v_preview->>'stripe_payment_intent_id','') IS NULL THEN
      RAISE EXCEPTION 'cancellation_refund_payment_intent_missing';
    END IF;
    v_vat := round(v_refund_amount * 6::NUMERIC / 106)::INTEGER;
    INSERT INTO public.commerce_refunds (
      id,
      commerce_order_id, booking_receipt_id, cancellation_decision_id,
      idempotency_key, refund_type, amount_inc_vat_minor, vat_amount_minor,
      currency, provider_environment, provider_account_key,
      provider_idempotency_key, provider_request, actor_user_id, reason
    ) VALUES (
      v_refund_id,
      NULLIF(v_preview->>'commerce_order_id','')::UUID,
      CASE WHEN NULLIF(v_preview->>'commerce_order_id','') IS NULL
        THEN NULLIF(v_preview->>'booking_receipt_id','')::UUID ELSE NULL END,
      v_decision.id, 'cancellation-v1:' || v_decision.id::TEXT, 'policy',
      v_refund_amount, v_vat, v_preview->>'currency', p_provider_environment,
      p_provider_account_key, 'commerce-r2a-policy-refund-' || v_decision.id::TEXT,
      jsonb_build_object('payment_intent',v_preview->>'stripe_payment_intent_id',
        'amount',v_refund_amount,'reason','requested_by_customer','metadata',jsonb_build_object(
          'commerce_refund_id',v_refund_id,'cancellation_decision_id',v_decision.id,'subject_type',p_subject_type,
          'subject_id',p_subject_id,'payer_user_id',v_preview->>'payer_user_id')),
      p_actor_user_id, CASE WHEN p_staff_override THEN v_reason ELSE 'Cancellation Policy V1' END
    ) RETURNING * INTO v_refund;
  END IF;

  UPDATE public.cancellation_decisions SET applied_at = now(),
    decision = decision || jsonb_build_object('applied_at',now(),'refund_id',v_refund.id,
      'restored_court_hours',v_restored)
  WHERE id = v_decision.id;
  -- The table is immutable to external writers; this function is the only
  -- intended transition and the trigger must be bypassed locally.
  -- (The update above is replaced below by a guarded trigger exception.)

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) SELECT venue.organization_id, v_decision.venue_id, p_actor_user_id,
    CASE WHEN p_staff_override THEN 'user' ELSE 'user' END,
    CASE WHEN p_staff_override THEN 'cancellation.staff_override_applied' ELSE 'cancellation.customer_applied' END,
    'cancellation_decisions', v_decision.id::TEXT, v_request, NULL,
    v_preview, jsonb_build_object('subject_type',p_subject_type,'subject_id',p_subject_id,
      'refund_id',v_refund.id,'refund_status',v_refund.status,'capacity_released',true,
      'checkin_preserved',v_preview->'checkin_preserved','staff_reason',v_reason)
  FROM public.venues venue WHERE venue.id = v_decision.venue_id;

  RETURN v_preview || jsonb_build_object(
    'decision_id',v_decision.id,'idempotent',false,'applied',true,
    'refund_id',v_refund.id,'refund_status',v_refund.status,
    'provider_request',v_refund.provider_request,'restored_court_hours',v_restored
  );
END;
$$;

-- Permit exactly the internal applied_at/decision completion update while
-- keeping all business inputs immutable.
DROP TRIGGER cancellation_decisions_immutable ON public.cancellation_decisions;
CREATE OR REPLACE FUNCTION public.guard_cancellation_decision_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'cancellation_record_is_immutable'; END IF;
  IF OLD.applied_at IS NULL AND NEW.applied_at IS NOT NULL
    AND (to_jsonb(NEW) - ARRAY['applied_at','decision']) = (to_jsonb(OLD) - ARRAY['applied_at','decision'])
    AND NEW.decision @> OLD.decision THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'cancellation_record_is_immutable';
END;
$$;
CREATE TRIGGER cancellation_decisions_immutable
  BEFORE UPDATE OR DELETE ON public.cancellation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_cancellation_decision_update();

-- Extend R2A reconciliation for receipt-targeted policy refunds, while all
-- existing commerce-order refunds continue through the proven pre-V1 body.
ALTER FUNCTION public.commerce_r2a_reconcile_refund(UUID, TEXT, TEXT, JSONB, TEXT)
  RENAME TO commerce_r2a_reconcile_refund_pre_cancellation_v1;

CREATE OR REPLACE FUNCTION public.reconcile_receipt_policy_refund(
  p_refund_id UUID,
  p_provider_refund_id TEXT,
  p_provider_status TEXT,
  p_provider_response JSONB,
  p_error TEXT DEFAULT NULL
) RETURNS public.commerce_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_refund public.commerce_refunds%ROWTYPE; v_receipt public.booking_receipts%ROWTYPE;
  v_before public.commerce_refunds%ROWTYPE; v_status TEXT;
BEGIN
  SELECT * INTO v_refund FROM public.commerce_refunds WHERE id = p_refund_id FOR UPDATE;
  IF v_refund.id IS NULL OR v_refund.booking_receipt_id IS NULL THEN RAISE EXCEPTION 'receipt_policy_refund_not_found'; END IF;
  IF p_provider_status NOT IN ('pending','succeeded','failed') THEN RAISE EXCEPTION 'invalid_refund_status'; END IF;
  IF NULLIF(btrim(COALESCE(p_provider_refund_id,'')),'') IS NULL THEN RAISE EXCEPTION 'provider_refund_id_required'; END IF;
  IF v_refund.provider_refund_id IS NOT NULL AND v_refund.provider_refund_id <> p_provider_refund_id THEN
    RAISE EXCEPTION 'provider_refund_identity_mismatch';
  END IF;
  IF v_refund.status = 'failed' OR (v_refund.status = 'succeeded' AND p_provider_status <> 'failed')
    OR v_refund.status = p_provider_status THEN RETURN v_refund; END IF;
  v_before := v_refund;
  SELECT * INTO v_receipt FROM public.booking_receipts WHERE id = v_refund.booking_receipt_id FOR UPDATE;
  IF v_receipt.id IS NULL THEN RAISE EXCEPTION 'booking_receipt_not_found'; END IF;

  UPDATE public.commerce_refunds SET provider_refund_id = COALESCE(provider_refund_id,p_provider_refund_id),
    status = p_provider_status, provider_response = COALESCE(p_provider_response,'{}'::JSONB),
    last_error = CASE WHEN p_provider_status='failed' THEN COALESCE(NULLIF(left(p_error,1000),''),'Stripe refund failed') ELSE NULL END,
    provider_succeeded_at = CASE WHEN p_provider_status='succeeded' THEN COALESCE(provider_succeeded_at,now()) ELSE provider_succeeded_at END,
    provider_failed_at = CASE WHEN p_provider_status='failed' THEN COALESCE(provider_failed_at,now()) ELSE provider_failed_at END,
    provider_monitor_until = CASE WHEN p_provider_status='succeeded' THEN COALESCE(provider_monitor_until,now()+interval '30 days') WHEN p_provider_status='failed' THEN NULL ELSE provider_monitor_until END,
    recovery_after = CASE WHEN p_provider_status IN ('pending','succeeded') THEN now()+interval '5 minutes' ELSE now()+interval '1 day' END,
    completed_at = CASE WHEN p_provider_status IN ('succeeded','failed') THEN now() ELSE completed_at END
  WHERE id = p_refund_id RETURNING * INTO v_refund;

  IF p_provider_status = 'succeeded' THEN
    INSERT INTO public.ledger_entries (
      venue_id, customer_id, source_type, source_id, accounting_date, occurred_at,
      customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status,
      payment_method, receipt_number, booking_receipt_id, metadata
    ) VALUES (
      v_receipt.venue_id, v_receipt.customer_id, 'commerce_refund', v_refund.id::TEXT,
      (now() AT TIME ZONE 'Europe/Stockholm')::DATE, now(), v_receipt.customer_name,
      v_refund.amount_inc_vat_minor, v_refund.vat_amount_minor, 'refunded','stripe',
      v_receipt.receipt_number,v_receipt.id,jsonb_build_object('commerce_refund_id',v_refund.id,
        'stripe_refund_id',p_provider_refund_id,'refund_type','policy','financial_direction','refund')
    ) ON CONFLICT (source_type,source_id) DO NOTHING;
    v_status := CASE WHEN v_refund.amount_inc_vat_minor >= round(COALESCE(v_receipt.total_inc_vat_sek,v_receipt.total_inc_vat::NUMERIC,0)*100)
      THEN 'refunded' ELSE 'partially_refunded' END;
    UPDATE public.booking_receipts SET payment_status=v_status,
      metadata=metadata||jsonb_build_object('refund_financial_state',v_status,'last_reconciled_refund_id',v_refund.id),updated_at=now()
      WHERE id=v_receipt.id;
  ELSIF p_provider_status = 'failed' THEN
    INSERT INTO public.ops_incidents (venue_id,severity,title,status,affected_route,affected_ids,impact,containment,verification,metadata)
    VALUES (v_receipt.venue_id,'P2','Stripe cancellation refund failed','open','/admin',v_refund.id::TEXT,
      'Capacity was released correctly, but the customer refund requires attention.',
      'Do not recreate participation. Resolve the financial obligation through the refund recovery queue.',
      'Confirm provider refund status before resolving.',jsonb_build_object('incident_type','commerce_refund_provider_failed',
        'commerce_refund_id',v_refund.id,'booking_receipt_id',v_receipt.id,'stripe_refund_id',p_provider_refund_id,
        'physical_truth_changed',false)) ON CONFLICT DO NOTHING;
    UPDATE public.booking_receipts SET payment_status='refund_failed',
      metadata=metadata||jsonb_build_object('refund_attention_required',true,'last_reconciled_refund_id',v_refund.id),updated_at=now()
      WHERE id=v_receipt.id;
  END IF;
  INSERT INTO public.audit_log (organization_id,venue_id,actor_type,action,entity_table,entity_id,request_id,before,after,metadata)
  SELECT venue.organization_id,v_receipt.venue_id,'webhook','cancellation.refund.provider_'||p_provider_status,
    'commerce_refunds',v_refund.id::TEXT,'provider-refund:'||p_provider_refund_id||':'||p_provider_status,
    to_jsonb(v_before),to_jsonb(v_refund),jsonb_build_object('booking_receipt_id',v_receipt.id,'physical_truth_changed',false)
  FROM public.venues venue WHERE venue.id=v_receipt.venue_id;
  RETURN v_refund;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_reconcile_refund(
  p_refund_id UUID,
  p_provider_refund_id TEXT,
  p_provider_status TEXT,
  p_provider_response JSONB,
  p_error TEXT DEFAULT NULL
) RETURNS public.commerce_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_refund public.commerce_refunds%ROWTYPE;
BEGIN
  SELECT * INTO v_refund FROM public.commerce_refunds WHERE id=p_refund_id;
  IF v_refund.id IS NULL THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF v_refund.booking_receipt_id IS NOT NULL THEN
    RETURN public.reconcile_receipt_policy_refund(p_refund_id,p_provider_refund_id,p_provider_status,p_provider_response,p_error);
  END IF;
  RETURN public.commerce_r2a_reconcile_refund_pre_cancellation_v1(
    p_refund_id,p_provider_refund_id,p_provider_status,p_provider_response,p_error
  );
END;
$$;

-- Customer-facing public policy projection; never exposes payer/payment data.
CREATE OR REPLACE FUNCTION public.cancellation_policy_public_projection(
  p_venue_id UUID,
  p_policy_family TEXT,
  p_access_product_id UUID DEFAULT NULL,
  p_activity_series_id UUID DEFAULT NULL,
  p_event_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_binding RECORD;
BEGIN
  SELECT policy.policy_key, version.version, version.preset_key, version.rules,
    version.copy_sv, version.copy_en, binding.subject_type, cutover.authority_key,
    cutover.enabled_at
  INTO v_binding
  FROM public.cancellation_policy_bindings binding
  JOIN public.cancellation_policy_versions version ON version.id=binding.policy_version_id
  JOIN public.cancellation_policies policy ON policy.id=version.policy_id
  JOIN public.cancellation_policy_cutovers cutover ON cutover.venue_id=binding.venue_id
    AND cutover.policy_family=binding.policy_family
    AND cutover.preset_key=version.preset_key
  WHERE binding.venue_id=p_venue_id AND binding.policy_family=p_policy_family
    AND binding.is_active AND version.lifecycle_status='published'
    AND ((binding.subject_type='event' AND binding.subject_id=p_event_id)
      OR (binding.subject_type='activity_series' AND binding.subject_id=p_activity_series_id)
      OR (binding.subject_type='access_product' AND binding.subject_id=p_access_product_id)
      OR binding.subject_type='family_default')
  ORDER BY CASE binding.subject_type WHEN 'event' THEN 1 WHEN 'activity_series' THEN 2 WHEN 'access_product' THEN 3 ELSE 4 END
  LIMIT 1;
  IF v_binding.policy_key IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('policy_key',v_binding.policy_key,'version',v_binding.version,
    'preset_key',v_binding.preset_key,'rules',v_binding.rules,'copy_sv',v_binding.copy_sv,
    'copy_en',v_binding.copy_en,'source',v_binding.subject_type,
    'authority_key',v_binding.authority_key,'enabled_at',v_binding.enabled_at);
END;
$$;

-- Permanent read-only rollout evidence. This reports the populations selected
-- by the rejected bootstrap without writing a snapshot or touching a purchase.
CREATE OR REPLACE FUNCTION public.cancellation_policy_rollout_preflight(
  p_venue_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH populations AS (
    SELECT 'commerce_participation'::TEXT AS population, count(*)::BIGINT AS legacy_rows
    FROM public.commerce_order_lines line
    JOIN public.commerce_orders order_row ON order_row.id=line.commerce_order_id
    JOIN public.cancellation_policy_cutovers cutover
      ON cutover.venue_id=order_row.venue_id
      AND cutover.authority_key=CASE
        WHEN line.league_team_entry_id IS NOT NULL THEN 'league_team'
        WHEN line.activity_series_id IS NOT NULL THEN 'managed_course'
        ELSE 'occurrence_ticket' END
    WHERE line.commerce_kind='participation'
      AND line.cancellation_policy_snapshot_id IS NULL
      AND order_row.status IN ('paid','attention','cancelled')
      AND COALESCE(order_row.checkout_frozen_at,order_row.paid_at,order_row.created_at) < cutover.enabled_at
      AND (p_venue_id IS NULL OR order_row.venue_id=p_venue_id)
    UNION ALL
    SELECT 'standalone_registration', count(*)::BIGINT
    FROM public.session_registrations registration
    JOIN public.cancellation_policy_cutovers cutover
      ON cutover.venue_id=registration.venue_id AND cutover.authority_key='occurrence_ticket'
    LEFT JOIN public.commerce_order_lines line ON line.session_registration_id=registration.id
    WHERE registration.cancellation_policy_snapshot_id IS NULL AND line.id IS NULL
      AND registration.status IN ('confirmed','checked_in','no_show','cancelled')
      AND registration.registered_at < cutover.enabled_at
      AND (p_venue_id IS NULL OR registration.venue_id=p_venue_id)
    UNION ALL
    SELECT 'court_booking', count(*)::BIGINT
    FROM public.bookings booking
    JOIN public.cancellation_policy_cutovers cutover
      ON cutover.venue_id=booking.venue_id AND cutover.authority_key='court_booking'
    WHERE booking.cancellation_policy_snapshot_id IS NULL
      AND booking.status IN ('confirmed','cancelled')
      AND COALESCE(booking.cancellation_policy_legacy_purchase_at,booking.created_at) < cutover.enabled_at
      AND (p_venue_id IS NULL OR booking.venue_id=p_venue_id)
    UNION ALL
    SELECT 'booking_participant', count(*)::BIGINT
    FROM public.booking_participants participant
    JOIN public.cancellation_policy_cutovers cutover
      ON cutover.venue_id=participant.venue_id AND cutover.authority_key='booking_participant'
    WHERE participant.cancellation_policy_snapshot_id IS NULL
      AND participant.payment_status IN ('paid','free','cancelled')
      AND participant.created_at < cutover.enabled_at
      AND (p_venue_id IS NULL OR participant.venue_id=p_venue_id)
  ), historical_links AS (
    SELECT 'commerce_order_lines'::TEXT AS table_name, line.id AS row_id,
      line.cancellation_policy_snapshot_id AS snapshot_id
    FROM public.commerce_order_lines line
    JOIN public.commerce_orders order_row ON order_row.id=line.commerce_order_id
    JOIN public.cancellation_policy_cutovers cutover
      ON cutover.venue_id=order_row.venue_id
      AND cutover.authority_key=CASE
        WHEN line.league_team_entry_id IS NOT NULL THEN 'league_team'
        WHEN line.activity_series_id IS NOT NULL THEN 'managed_course'
        ELSE 'occurrence_ticket' END
    WHERE line.commerce_kind='participation'
      AND line.cancellation_policy_snapshot_id IS NOT NULL
      AND COALESCE(order_row.checkout_frozen_at,order_row.paid_at,order_row.created_at) < cutover.enabled_at
      AND (p_venue_id IS NULL OR order_row.venue_id=p_venue_id)
    UNION ALL
    SELECT 'session_registrations',registration.id,registration.cancellation_policy_snapshot_id
    FROM public.session_registrations registration
    JOIN public.cancellation_policy_cutovers cutover
      ON cutover.venue_id=registration.venue_id AND cutover.authority_key='occurrence_ticket'
    WHERE registration.cancellation_policy_snapshot_id IS NOT NULL
      AND registration.registered_at < cutover.enabled_at
      AND (p_venue_id IS NULL OR registration.venue_id=p_venue_id)
    UNION ALL
    SELECT 'bookings',booking.id,booking.cancellation_policy_snapshot_id
    FROM public.bookings booking
    JOIN public.cancellation_policy_cutovers cutover
      ON cutover.venue_id=booking.venue_id AND cutover.authority_key='court_booking'
    WHERE booking.cancellation_policy_snapshot_id IS NOT NULL
      AND COALESCE(booking.cancellation_policy_legacy_purchase_at,booking.created_at) < cutover.enabled_at
      AND (p_venue_id IS NULL OR booking.venue_id=p_venue_id)
    UNION ALL
    SELECT 'booking_participants',participant.id,participant.cancellation_policy_snapshot_id
    FROM public.booking_participants participant
    JOIN public.cancellation_policy_cutovers cutover
      ON cutover.venue_id=participant.venue_id AND cutover.authority_key='booking_participant'
    WHERE participant.cancellation_policy_snapshot_id IS NOT NULL
      AND participant.created_at < cutover.enabled_at
      AND (p_venue_id IS NULL OR participant.venue_id=p_venue_id)
  ), historical_link_totals AS (
    SELECT count(*)::BIGINT AS linked_rows,
      count(DISTINCT snapshot_id)::BIGINT AS linked_snapshots
    FROM historical_links
  ), missing_new AS (
    SELECT count(*)::BIGINT AS missing_count FROM (
      SELECT line.id
      FROM public.commerce_order_lines line
      JOIN public.commerce_orders order_row ON order_row.id=line.commerce_order_id
      JOIN public.cancellation_policy_cutovers cutover
        ON cutover.venue_id=order_row.venue_id
        AND cutover.authority_key=CASE
          WHEN line.league_team_entry_id IS NOT NULL THEN 'league_team'
          WHEN line.activity_series_id IS NOT NULL THEN 'managed_course'
          ELSE 'occurrence_ticket' END
      WHERE line.commerce_kind='participation' AND line.cancellation_policy_snapshot_id IS NULL
        AND order_row.status IN ('checkout_pending','paid','attention')
        AND COALESCE(order_row.checkout_frozen_at,order_row.paid_at,order_row.created_at) >= cutover.enabled_at
        AND (p_venue_id IS NULL OR order_row.venue_id=p_venue_id)
      UNION ALL
      SELECT booking.id FROM public.bookings booking
      JOIN public.cancellation_policy_cutovers cutover
        ON cutover.venue_id=booking.venue_id AND cutover.authority_key='court_booking'
      WHERE booking.cancellation_policy_snapshot_id IS NULL AND booking.status='confirmed'
        AND COALESCE(booking.cancellation_policy_legacy_purchase_at,booking.created_at) >= cutover.enabled_at
        AND (p_venue_id IS NULL OR booking.venue_id=p_venue_id)
      UNION ALL
      SELECT participant.id FROM public.booking_participants participant
      JOIN public.cancellation_policy_cutovers cutover
        ON cutover.venue_id=participant.venue_id AND cutover.authority_key='booking_participant'
      WHERE participant.cancellation_policy_snapshot_id IS NULL
        AND participant.payment_status IN ('paid','free')
        AND participant.created_at >= cutover.enabled_at
        AND (p_venue_id IS NULL OR participant.venue_id=p_venue_id)
    ) missing
  ), config AS (
    SELECT jsonb_build_object(
      'policies', (SELECT count(*) FROM public.cancellation_policies policy
        WHERE p_venue_id IS NULL OR policy.venue_id=p_venue_id),
      'versions', (SELECT count(*) FROM public.cancellation_policy_versions version
        JOIN public.cancellation_policies policy ON policy.id=version.policy_id
        WHERE p_venue_id IS NULL OR policy.venue_id=p_venue_id),
      'bindings', (SELECT count(*) FROM public.cancellation_policy_bindings binding
        WHERE p_venue_id IS NULL OR binding.venue_id=p_venue_id),
      'cutovers', (SELECT count(*) FROM public.cancellation_policy_cutovers cutover
        WHERE p_venue_id IS NULL OR cutover.venue_id=p_venue_id)
    ) AS counts
  )
  SELECT jsonb_build_object(
    'historical_business_rows_mutated',(SELECT linked_rows FROM historical_link_totals),
    'historical_snapshots_created',(SELECT linked_snapshots FROM historical_link_totals),
    'historical_fk_links_changed',(SELECT linked_rows FROM historical_link_totals),
    'ambiguous_legacy_rows',0,
    'legacy_policy_details_unavailable',(SELECT COALESCE(sum(legacy_rows),0) FROM populations),
    'legacy_population',(
      SELECT COALESCE(jsonb_object_agg(population,legacy_rows),'{}'::JSONB) FROM populations
    ),
    'post_cutover_missing_snapshot',(SELECT missing_count FROM missing_new),
    'new_policy_config_rows',(SELECT counts FROM config),
    'enabled_authorities',(
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'venue_id',cutover.venue_id,'authority_key',cutover.authority_key,
        'policy_family',cutover.policy_family,'preset_key',cutover.preset_key,
        'schema_version',cutover.schema_version,'enabled_at',cutover.enabled_at
      ) ORDER BY cutover.venue_id,cutover.authority_key),'[]'::JSONB)
      FROM public.cancellation_policy_cutovers cutover
      WHERE p_venue_id IS NULL OR cutover.venue_id=p_venue_id
    )
  );
$$;

-- Admin selection stays deliberately preset-only in V1. Rebinding never
-- mutates a published version and therefore only affects future snapshots.
CREATE OR REPLACE FUNCTION public.set_cancellation_policy_binding(
  p_venue_id UUID,
  p_policy_family TEXT,
  p_preset_key TEXT,
  p_subject_type TEXT,
  p_subject_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT
) RETURNS public.cancellation_policy_bindings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_version_id UUID;
  v_binding public.cancellation_policy_bindings%ROWTYPE;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason,'')),'');
BEGIN
  IF p_subject_type NOT IN ('family_default','access_product','activity_series','event') THEN
    RAISE EXCEPTION 'invalid_cancellation_binding_subject';
  END IF;
  IF (p_subject_type='family_default') IS DISTINCT FROM (p_subject_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_cancellation_binding_identity';
  END IF;
  IF p_policy_family='event' AND p_subject_type='family_default' THEN
    RAISE EXCEPTION 'event_policy_requires_explicit_binding';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'cancellation_binding_reason_required';
  END IF;

  SELECT version.id INTO v_version_id
  FROM public.cancellation_policy_versions version
  JOIN public.cancellation_policies policy ON policy.id=version.policy_id
  WHERE policy.venue_id=p_venue_id
    AND (policy.policy_family=p_policy_family
      OR (p_policy_family='booking_participant' AND version.preset_key='standard_12h'))
    AND version.preset_key=p_preset_key AND version.lifecycle_status='published';
  IF v_version_id IS NULL THEN RAISE EXCEPTION 'published_cancellation_preset_not_found'; END IF;

  IF p_subject_type='access_product' AND NOT EXISTS (
    SELECT 1 FROM public.access_products product WHERE product.id=p_subject_id AND product.venue_id=p_venue_id
  ) THEN RAISE EXCEPTION 'cross_venue_cancellation_binding_rejected'; END IF;
  IF p_subject_type='activity_series' AND NOT EXISTS (
    SELECT 1 FROM public.activity_series series WHERE series.id=p_subject_id AND series.venue_id=p_venue_id
  ) THEN RAISE EXCEPTION 'cross_venue_cancellation_binding_rejected'; END IF;
  IF p_subject_type='event' AND NOT EXISTS (
    SELECT 1 FROM public.events event WHERE event.id=p_subject_id AND event.venue_id=p_venue_id
  ) THEN RAISE EXCEPTION 'cross_venue_cancellation_binding_rejected'; END IF;

  UPDATE public.cancellation_policy_bindings SET is_active=false, retired_at=now()
  WHERE venue_id=p_venue_id AND policy_family=p_policy_family
    AND subject_type=p_subject_type AND subject_id IS NOT DISTINCT FROM p_subject_id AND is_active;
  INSERT INTO public.cancellation_policy_bindings (
    venue_id,policy_family,subject_type,subject_id,policy_version_id,created_by
  ) VALUES (p_venue_id,p_policy_family,p_subject_type,p_subject_id,v_version_id,p_actor_user_id)
  RETURNING * INTO v_binding;

  INSERT INTO public.audit_log (
    organization_id,venue_id,actor_user_id,actor_type,action,entity_table,entity_id,
    request_id,before,after,metadata
  ) SELECT venue.organization_id,p_venue_id,p_actor_user_id,'user','cancellation.policy_binding_changed',
    'cancellation_policy_bindings',v_binding.id::TEXT,'policy-binding:'||v_binding.id::TEXT,NULL,
    to_jsonb(v_binding),jsonb_build_object('reason',v_reason,'applies_to','new_purchases_only')
  FROM public.venues venue WHERE venue.id=p_venue_id;
  RETURN v_binding;
END;
$$;

ALTER TABLE public.cancellation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_policy_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_policy_cutovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_policy_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY cancellation_policies_staff_read ON public.cancellation_policies
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR EXISTS (SELECT 1 FROM public.venue_staff staff
      WHERE staff.user_id=auth.uid() AND staff.venue_id=cancellation_policies.venue_id AND staff.is_active)
  );
CREATE POLICY cancellation_policy_versions_staff_read ON public.cancellation_policy_versions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.cancellation_policies policy WHERE policy.id=cancellation_policy_versions.policy_id
      AND (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.venue_staff staff
        WHERE staff.user_id=auth.uid() AND staff.venue_id=policy.venue_id AND staff.is_active))
  ));
CREATE POLICY cancellation_bindings_staff_read ON public.cancellation_policy_bindings
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR EXISTS (SELECT 1 FROM public.venue_staff staff
      WHERE staff.user_id=auth.uid() AND staff.venue_id=cancellation_policy_bindings.venue_id AND staff.is_active)
  );
CREATE POLICY cancellation_cutovers_staff_read ON public.cancellation_policy_cutovers
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR EXISTS (SELECT 1 FROM public.venue_staff staff
      WHERE staff.user_id=auth.uid() AND staff.venue_id=cancellation_policy_cutovers.venue_id AND staff.is_active)
  );
CREATE POLICY cancellation_snapshots_staff_read ON public.cancellation_policy_snapshots
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR EXISTS (SELECT 1 FROM public.venue_staff staff
      WHERE staff.user_id=auth.uid() AND staff.venue_id=cancellation_policy_snapshots.venue_id AND staff.is_active)
  );
CREATE POLICY cancellation_decisions_staff_read ON public.cancellation_decisions
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR EXISTS (SELECT 1 FROM public.venue_staff staff
      WHERE staff.user_id=auth.uid() AND staff.venue_id=cancellation_decisions.venue_id AND staff.is_active)
  );

REVOKE ALL ON public.cancellation_policies, public.cancellation_policy_versions,
  public.cancellation_policy_bindings, public.cancellation_policy_cutovers,
  public.cancellation_policy_snapshots,
  public.cancellation_decisions FROM anon, authenticated;
GRANT SELECT ON public.cancellation_policies, public.cancellation_policy_versions,
  public.cancellation_policy_bindings, public.cancellation_policy_cutovers,
  public.cancellation_policy_snapshots,
  public.cancellation_decisions TO authenticated;
GRANT ALL ON public.cancellation_policies, public.cancellation_policy_versions,
  public.cancellation_policy_bindings, public.cancellation_policy_cutovers,
  public.cancellation_policy_snapshots,
  public.cancellation_decisions TO service_role;

REVOKE ALL ON FUNCTION public.ensure_cancellation_policy_presets(UUID),
  public.create_cancellation_policy_snapshot(UUID,TEXT,TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID,UUID,UUID,UUID,UUID,JSONB,JSONB),
  public.cancellation_subject_state(TEXT,UUID,UUID,BOOLEAN,TIMESTAMPTZ,TEXT,TEXT),
  public.confirm_cancellation_policy_v1(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT),
  public.cancellation_policy_rollout_preflight(UUID),
  public.set_cancellation_policy_binding(UUID,TEXT,TEXT,TEXT,UUID,UUID,TEXT),
  public.reconcile_receipt_policy_refund(UUID,TEXT,TEXT,JSONB,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_cancellation_policy_presets(UUID),
  public.create_cancellation_policy_snapshot(UUID,TEXT,TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID,UUID,UUID,UUID,UUID,JSONB,JSONB),
  public.cancellation_subject_state(TEXT,UUID,UUID,BOOLEAN,TIMESTAMPTZ,TEXT,TEXT),
  public.confirm_cancellation_policy_v1(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT),
  public.cancellation_policy_rollout_preflight(UUID),
  public.set_cancellation_policy_binding(UUID,TEXT,TEXT,TEXT,UUID,UUID,TEXT),
  public.reconcile_receipt_policy_refund(UUID,TEXT,TEXT,JSONB,TEXT),
  public.commerce_r2a_reconcile_refund(UUID,TEXT,TEXT,JSONB,TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.cancellation_policy_public_projection(UUID,TEXT,UUID,UUID,UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancellation_policy_public_projection(UUID,TEXT,UUID,UUID,UUID)
  TO anon, authenticated, service_role;

COMMENT ON TABLE public.cancellation_policy_snapshots IS
  'Immutable Policy V1 purchase-time terms. Historical sales never receive manufactured snapshots.';
COMMENT ON TABLE public.cancellation_policy_cutovers IS
  'Durable forward-only Policy V1 authority boundary. Absence means the family is excluded.';
COMMENT ON FUNCTION public.cancellation_subject_state(TEXT,UUID,UUID,BOOLEAN,TIMESTAMPTZ,TEXT,TEXT) IS
  'Single server-authoritative preview evaluator. Exact boundaries use strict now < deadline semantics.';
COMMENT ON FUNCTION public.confirm_cancellation_policy_v1(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT) IS
  'Re-evaluates under lock, rejects stale previews, atomically releases participation/capacity and prepares the durable R2A refund command.';

-- Freeze the policy snapshot in the same database transaction as price,
-- entitlement and capacity provenance. Participation lines without a snapshot
-- fail closed; merchandise/rental lines are intentionally outside V1.
CREATE OR REPLACE FUNCTION public.freeze_commerce_order(
  p_order_id UUID,
  p_expected_version INTEGER,
  p_lines JSONB
) RETURNS TABLE(order_id UUID, version INTEGER, total_inc_vat_minor INTEGER, currency TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_item JSONB; v_line_id UUID; v_unit INTEGER; v_quantity INTEGER;
  v_discount INTEGER; v_total INTEGER; v_vat_rate NUMERIC(5,2);
  v_vat INTEGER; v_count INTEGER; v_snapshot_id UUID;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  IF v_order.status <> 'draft' THEN RAISE EXCEPTION 'commerce_order_not_draft'; END IF;
  IF v_order.version <> p_expected_version THEN RAISE EXCEPTION 'stale_cart_version'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'commerce_order_empty'; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_order_lines WHERE commerce_order_id=p_order_id;
  IF v_count <> jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'commerce_order_line_mismatch'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_id := (v_item->>'id')::UUID;
    v_unit := GREATEST(COALESCE((v_item->>'unit_price_minor')::INTEGER,0),0);
    v_quantity := GREATEST(COALESCE((v_item->>'quantity')::INTEGER,1),1);
    v_discount := GREATEST(COALESCE((v_item->>'discount_minor')::INTEGER,0),0);
    v_total := v_unit*v_quantity-v_discount;
    IF v_total<0 THEN RAISE EXCEPTION 'invalid_commerce_line_discount'; END IF;
    v_vat_rate := COALESCE((v_item->>'vat_rate')::NUMERIC,0);
    IF v_vat_rate<0 OR v_vat_rate>100 THEN RAISE EXCEPTION 'invalid_commerce_line_vat'; END IF;
    v_vat := round(v_total*v_vat_rate/(100+v_vat_rate));
    v_snapshot_id := NULLIF(v_item->>'cancellation_policy_snapshot_id','')::UUID;
    IF COALESCE(v_item->>'commerce_kind','')='participation' AND v_snapshot_id IS NULL THEN
      RAISE EXCEPTION 'cancellation_policy_snapshot_missing_for_new_sale';
    END IF;
    IF v_snapshot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.cancellation_policy_snapshots snapshot
      WHERE snapshot.id=v_snapshot_id AND snapshot.venue_id=v_order.venue_id
        AND snapshot.purchase_reference_type='commerce_order_line'
        AND snapshot.purchase_reference_id=v_line_id
    ) THEN RAISE EXCEPTION 'cancellation_policy_snapshot_mismatch'; END IF;

    UPDATE public.commerce_order_lines SET
      product_key=COALESCE(NULLIF(v_item->>'product_key',''),product_key),
      product_name=COALESCE(NULLIF(v_item->>'product_name',''),product_name),
      commerce_kind=COALESCE(NULLIF(v_item->>'commerce_kind',''),commerce_kind),
      quantity=v_quantity, unit_price_minor=v_unit, discount_minor=v_discount,
      line_total_inc_vat_minor=v_total, vat_rate=v_vat_rate, vat_amount_minor=v_vat,
      line_total_ex_vat_minor=v_total-v_vat,
      fulfillment_type=COALESCE(NULLIF(v_item->>'fulfillment_type',''),fulfillment_type),
      fulfillment_status=CASE WHEN COALESCE(NULLIF(v_item->>'fulfillment_type',''),fulfillment_type)='desk_pickup'
        THEN 'pending_pickup' ELSE 'not_required' END,
      beneficiary_customer_id=NULLIF(v_item->>'beneficiary_customer_id','')::UUID,
      beneficiary_user_id=NULLIF(v_item->>'beneficiary_user_id','')::UUID,
      capacity_hold_id=NULLIF(v_item->>'capacity_hold_id','')::UUID,
      resolver_snapshot=COALESCE(v_item->'resolver_snapshot','{}'::JSONB),
      product_snapshot=COALESCE(v_item->'product_snapshot','{}'::JSONB),
      cancellation_policy_snapshot_id=v_snapshot_id
    WHERE id=v_line_id AND commerce_order_id=p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_line_not_found'; END IF;
  END LOOP;

  UPDATE public.commerce_orders order_row SET
    subtotal_minor=totals.subtotal_minor, discount_minor=totals.discount_minor,
    total_inc_vat_minor=totals.total_inc_vat_minor, vat_amount_minor=totals.vat_amount_minor,
    total_ex_vat_minor=totals.total_ex_vat_minor, status='checkout_pending',
    version=order_row.version+1, checkout_frozen_at=now()
  FROM (SELECT COALESCE(sum(unit_price_minor*quantity),0)::INTEGER subtotal_minor,
      COALESCE(sum(discount_minor),0)::INTEGER discount_minor,
      COALESCE(sum(line_total_inc_vat_minor),0)::INTEGER total_inc_vat_minor,
      COALESCE(sum(vat_amount_minor),0)::INTEGER vat_amount_minor,
      COALESCE(sum(line_total_ex_vat_minor),0)::INTEGER total_ex_vat_minor
    FROM public.commerce_order_lines WHERE commerce_order_id=p_order_id) totals
  WHERE order_row.id=p_order_id
  RETURNING order_row.id,order_row.version,order_row.total_inc_vat_minor,order_row.currency
  INTO order_id,version,total_inc_vat_minor,currency;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.freeze_commerce_order(UUID,INTEGER,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_commerce_order(UUID,INTEGER,JSONB) TO service_role;
