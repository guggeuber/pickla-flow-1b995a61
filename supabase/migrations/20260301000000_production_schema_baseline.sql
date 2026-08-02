-- Canonical Pickla production schema baseline.
--
-- Captured schema-only from production on 2026-08-02 at Commerce R1 RC
-- fc5743665c509aaa037b014dc3daeaea0bf94fe3. Production data, credentials,
-- object ownership and Supabase-managed Storage internals are intentionally
-- excluded. See docs/database/production-baseline.md for provenance and the
-- migration-history compatibility strategy.

CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

--
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA IF NOT EXISTS "public";



--
-- Name: app_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."app_role" AS ENUM (
    'customer',
    'desk_staff',
    'venue_admin',
    'super_admin'
);



--
-- Name: booking_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."booking_status" AS ENUM (
    'pending',
    'confirmed',
    'cancelled',
    'completed',
    'no_show'
);



--
-- Name: day_pass_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."day_pass_status" AS ENUM (
    'active',
    'expired',
    'cancelled',
    'used'
);



--
-- Name: event_format; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."event_format" AS ENUM (
    'round_robin',
    'knockout',
    'mini_cup_2h',
    'team_vs_team',
    'amerikano',
    'ladder'
);



--
-- Name: event_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."event_type" AS ENUM (
    'tournament',
    'team_competition',
    'corporate_event',
    'mini_cup'
);



--
-- Name: match_stage; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."match_stage" AS ENUM (
    'group',
    'semifinal',
    'final',
    'third_place'
);



--
-- Name: match_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."match_status" AS ENUM (
    'scheduled',
    'in_progress',
    'completed'
);



--
-- Name: venue_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."venue_status" AS ENUM (
    'active',
    'inactive',
    'coming_soon'
);



--
-- Name: acquire_capacity_hold("uuid", "text", "text", "date", integer, "uuid", "uuid", "text", "uuid", "text", "jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."acquire_capacity_hold"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_capacity" integer DEFAULT NULL::integer, "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_customer_id" "uuid" DEFAULT NULL::"uuid", "p_source_type" "text" DEFAULT NULL::"text", "p_source_id" "uuid" DEFAULT NULL::"uuid", "p_idempotency_key" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_ttl_seconds" integer DEFAULT 600) RETURNS TABLE("ok" boolean, "hold_id" "uuid", "available_count" integer, "reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_capacity INTEGER;
  v_committed INTEGER;
  v_holds INTEGER;
  v_existing public.capacity_holds%ROWTYPE;
BEGIN
  IF p_scope_type NOT IN ('activity_session', 'booking_group') THEN
    RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
  END IF;

  PERFORM public.capacity_lock_scope(p_venue_id, p_scope_type, p_scope_id, p_session_date);

  UPDATE public.capacity_holds
  SET status = 'expired',
      released_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('release_reason', 'lazy_expired_before_acquire')
  WHERE venue_id = p_venue_id
    AND scope_type = p_scope_type
    AND scope_id = p_scope_id
    AND session_date = p_session_date
    AND status = 'active'
    AND expires_at <= now();

  SELECT * INTO v_existing
  FROM public.capacity_holds ch
  WHERE ch.venue_id = p_venue_id
    AND ch.scope_type = p_scope_type
    AND ch.scope_id = p_scope_id
    AND ch.session_date = p_session_date
    AND ch.status = 'active'
    AND ch.expires_at > now()
    AND (
      (NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NOT NULL AND ch.idempotency_key = NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '')) OR
      (p_source_id IS NOT NULL AND ch.source_id = p_source_id) OR
      (p_user_id IS NOT NULL AND ch.user_id = p_user_id AND COALESCE(ch.source_type, '') = COALESCE(p_source_type, ''))
    )
  ORDER BY ch.created_at DESC
  LIMIT 1;

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
    ok := false;
    hold_id := NULL;
    available_count := 0;
    reason := 'capacity_full';
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.capacity_holds (
    venue_id,
    scope_type,
    scope_id,
    session_date,
    user_id,
    customer_id,
    source_type,
    source_id,
    idempotency_key,
    expires_at,
    metadata
  )
  VALUES (
    p_venue_id,
    p_scope_type,
    p_scope_id,
    p_session_date,
    p_user_id,
    p_customer_id,
    p_source_type,
    p_source_id,
    NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''),
    now() + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 600), 1)),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO hold_id;

  ok := true;
  available_count := CASE WHEN v_capacity IS NULL THEN NULL ELSE GREATEST(v_capacity - v_committed - v_holds - 1, 0) END;
  reason := 'held';
  RETURN NEXT;
END;
$$;



--
-- Name: attach_capacity_hold_stripe_session("uuid", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."attach_capacity_hold_stripe_session"("p_hold_id" "uuid", "p_stripe_session_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_hold_id IS NULL OR NULLIF(BTRIM(COALESCE(p_stripe_session_id, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.capacity_holds
  SET stripe_session_id = p_stripe_session_id,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('stripe_session_id', p_stripe_session_id)
  WHERE id = p_hold_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;



--
-- Name: attach_commerce_order_stripe_session("uuid", integer, "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."attach_commerce_order_stripe_session"("p_order_id" "uuid", "p_version" integer, "p_stripe_session_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.commerce_orders
  SET stripe_session_id = p_stripe_session_id
  WHERE id = p_order_id AND version = p_version AND status = 'checkout_pending'
    AND (stripe_session_id IS NULL OR stripe_session_id = p_stripe_session_id);
  RETURN FOUND;
END;
$$;



--
-- Name: cancel_booking_participant_capacity("uuid", "uuid", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."cancel_booking_participant_capacity"("p_participant_id" "uuid", "p_actor_user_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cancelled_count INTEGER := 0;
BEGIN
  UPDATE public.booking_participants
  SET payment_status = 'cancelled',
      metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
      updated_at = now()
  WHERE id = p_participant_id
    AND payment_status <> 'cancelled';
  GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;

  UPDATE public.capacity_holds
  SET status = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'released' END,
      released_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'release_reason', 'booking_participant_cancelled',
        'actor_user_id', p_actor_user_id
      )
  WHERE source_id = p_participant_id
    AND scope_type = 'booking_group'
    AND status = 'active';

  RETURN v_cancelled_count > 0;
END;
$$;



--
-- Name: capacity_active_holds_count("uuid", "text", "text", "date", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."capacity_active_holds_count"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_exclude_hold_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.capacity_holds ch
  WHERE ch.venue_id = p_venue_id
    AND ch.scope_type = p_scope_type
    AND ch.scope_id = p_scope_id
    AND ch.session_date = p_session_date
    AND ch.status = 'active'
    AND ch.expires_at > now()
    AND (p_exclude_hold_id IS NULL OR ch.id <> p_exclude_hold_id);

  RETURN COALESCE(v_count, 0);
END;
$$;



--
-- Name: capacity_committed_count("uuid", "text", "text", "date", "uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."capacity_committed_count"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_exclude_registration_id" "uuid" DEFAULT NULL::"uuid", "p_exclude_participant_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  IF p_scope_type = 'activity_session' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.session_registrations sr
    WHERE sr.venue_id = p_venue_id
      AND sr.activity_session_id = p_scope_id::UUID
      AND sr.session_date = p_session_date
      AND sr.status IN ('confirmed', 'checked_in', 'no_show')
      AND (p_exclude_registration_id IS NULL OR sr.id <> p_exclude_registration_id);
  ELSIF p_scope_type = 'booking_group' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.booking_participants bp
    WHERE bp.venue_id = p_venue_id
      AND bp.booking_group_key = p_scope_id
      AND bp.payment_status IN ('paid', 'free')
      AND (p_exclude_participant_id IS NULL OR bp.id <> p_exclude_participant_id);
  ELSE
    RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;



--
-- Name: capacity_fill("uuid", "text", "text", "date", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."capacity_fill"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_capacity" integer DEFAULT NULL::integer) RETURNS TABLE("capacity" integer, "committed_count" integer, "active_holds_count" integer, "fill_count" integer, "available_count" integer)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  capacity := public.capacity_scope_capacity(p_venue_id, p_scope_type, p_scope_id, p_capacity);
  committed_count := public.capacity_committed_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  active_holds_count := public.capacity_active_holds_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  fill_count := committed_count + active_holds_count;
  available_count := CASE
    WHEN capacity IS NULL THEN NULL
    ELSE GREATEST(capacity - fill_count, 0)
  END;
  RETURN NEXT;
END;
$$;



--
-- Name: capacity_lock_scope("uuid", "text", "text", "date"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."capacity_lock_scope"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(COALESCE(p_venue_id::TEXT, '')),
    hashtext(COALESCE(p_scope_type, '') || ':' || COALESCE(p_scope_id, '') || ':' || COALESCE(p_session_date::TEXT, ''))
  );

  IF p_scope_type = 'activity_session' THEN
    PERFORM 1
    FROM public.activity_sessions
    WHERE id = p_scope_id::UUID
      AND venue_id = p_venue_id
    FOR UPDATE;
  END IF;
END;
$$;



--
-- Name: capacity_scope_capacity("uuid", "text", "text", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."capacity_scope_capacity"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_capacity" integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_capacity INTEGER;
BEGIN
  IF p_scope_type = 'activity_session' THEN
    SELECT capacity INTO v_capacity
    FROM public.activity_sessions
    WHERE id = p_scope_id::UUID
      AND venue_id = p_venue_id;
    RETURN NULLIF(GREATEST(COALESCE(v_capacity, 0), 0), 0);
  ELSIF p_scope_type = 'booking_group' THEN
    RETURN NULLIF(GREATEST(COALESCE(p_capacity, 0), 0), 0);
  END IF;

  RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
END;
$$;



--
-- Name: commit_activity_registration_capacity("uuid", "uuid", "date", "uuid", "uuid", "text", integer, "text", "text", "uuid", "jsonb", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."commit_activity_registration_capacity"("p_venue_id" "uuid", "p_activity_session_id" "uuid", "p_session_date" "date", "p_user_id" "uuid", "p_customer_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT 'confirmed'::"text", "p_price_paid_sek" integer DEFAULT 0, "p_stripe_session_id" "text" DEFAULT NULL::"text", "p_source_type" "text" DEFAULT NULL::"text", "p_source_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_hold_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("ok" boolean, "registration_id" "uuid", "reason" "text", "available_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_capacity INTEGER;
  v_committed INTEGER;
  v_holds INTEGER;
  v_hold public.capacity_holds%ROWTYPE;
  v_existing public.session_registrations%ROWTYPE;
  v_allow BOOLEAN := false;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user_id for activity capacity commit';
  END IF;
  IF p_status NOT IN ('confirmed', 'checked_in', 'no_show') THEN
    RAISE EXCEPTION 'Unsupported committed activity status: %', p_status;
  END IF;

  PERFORM public.capacity_lock_scope(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date);

  SELECT * INTO v_existing
  FROM public.session_registrations
  WHERE activity_session_id = p_activity_session_id
    AND session_date = p_session_date
    AND user_id = p_user_id
  LIMIT 1;

  IF v_existing.id IS NOT NULL AND v_existing.status IN ('confirmed', 'checked_in', 'no_show') THEN
    IF p_hold_id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'committed',
          committed_at = COALESCE(committed_at, now())
      WHERE id = p_hold_id
        AND status = 'active';
    END IF;
    ok := true;
    registration_id := v_existing.id;
    reason := 'already_committed';
    available_count := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_hold_id IS NOT NULL THEN
    SELECT * INTO v_hold
    FROM public.capacity_holds
    WHERE id = p_hold_id
      AND venue_id = p_venue_id
      AND scope_type = 'activity_session'
      AND scope_id = p_activity_session_id::TEXT
      AND session_date = p_session_date
    FOR UPDATE;
  ELSIF NULLIF(BTRIM(COALESCE(p_stripe_session_id, '')), '') IS NOT NULL THEN
    SELECT * INTO v_hold
    FROM public.capacity_holds
    WHERE stripe_session_id = p_stripe_session_id
      AND venue_id = p_venue_id
      AND scope_type = 'activity_session'
      AND scope_id = p_activity_session_id::TEXT
      AND session_date = p_session_date
    FOR UPDATE;
  END IF;

  v_capacity := public.capacity_scope_capacity(p_venue_id, 'activity_session', p_activity_session_id::TEXT, NULL);
  v_committed := public.capacity_committed_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date, v_existing.id, NULL);
  v_holds := public.capacity_active_holds_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date, v_hold.id);

  IF v_hold.id IS NOT NULL AND v_hold.status = 'active' AND v_hold.expires_at > now() THEN
    v_allow := true;
  ELSIF v_capacity IS NULL OR (v_committed + v_holds) < v_capacity THEN
    v_allow := true;
  END IF;

  IF NOT v_allow THEN
    IF v_hold.id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'conflict',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('conflict_at', now(), 'conflict_reason', 'capacity_full_after_payment')
      WHERE id = v_hold.id;
    END IF;
    ok := false;
    registration_id := NULL;
    reason := 'capacity_full';
    available_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.session_registrations (
    venue_id,
    activity_session_id,
    session_date,
    user_id,
    customer_id,
    status,
    price_paid_sek,
    stripe_session_id,
    source_type,
    source_id,
    metadata
  )
  VALUES (
    p_venue_id,
    p_activity_session_id,
    p_session_date,
    p_user_id,
    p_customer_id,
    p_status,
    GREATEST(COALESCE(p_price_paid_sek, 0), 0),
    NULLIF(BTRIM(COALESCE(p_stripe_session_id, '')), ''),
    p_source_type,
    p_source_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (activity_session_id, session_date, user_id)
  DO UPDATE SET
    venue_id = EXCLUDED.venue_id,
    customer_id = COALESCE(EXCLUDED.customer_id, public.session_registrations.customer_id),
    status = EXCLUDED.status,
    price_paid_sek = EXCLUDED.price_paid_sek,
    stripe_session_id = COALESCE(EXCLUDED.stripe_session_id, public.session_registrations.stripe_session_id),
    source_type = COALESCE(EXCLUDED.source_type, public.session_registrations.source_type),
    source_id = COALESCE(EXCLUDED.source_id, public.session_registrations.source_id),
    metadata = COALESCE(public.session_registrations.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
    updated_at = now()
  RETURNING id INTO registration_id;

  IF v_hold.id IS NOT NULL THEN
    UPDATE public.capacity_holds
    SET status = 'committed',
        committed_at = COALESCE(committed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('registration_id', registration_id)
    WHERE id = v_hold.id;
  END IF;

  ok := true;
  reason := 'committed';
  available_count := CASE
    WHEN v_capacity IS NULL THEN NULL
    ELSE GREATEST(v_capacity - public.capacity_committed_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date) - public.capacity_active_holds_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date), 0)
  END;
  RETURN NEXT;
END;
$$;



--
-- Name: commit_booking_participant_capacity("uuid", "uuid", "text", "date", integer, "uuid", "uuid", "uuid", "text", "text", "text", "text", integer, "text", "text", "text", "uuid", "jsonb", "uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."commit_booking_participant_capacity"("p_venue_id" "uuid", "p_booking_id" "uuid", "p_booking_group_key" "text", "p_session_date" "date", "p_capacity" integer, "p_invite_id" "uuid" DEFAULT NULL::"uuid", "p_customer_id" "uuid" DEFAULT NULL::"uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_display_name" "text" DEFAULT 'Spelare'::"text", "p_email" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_role" "text" DEFAULT 'player'::"text", "p_price_minor" integer DEFAULT 0, "p_payment_status" "text" DEFAULT 'free'::"text", "p_payment_method" "text" DEFAULT NULL::"text", "p_payment_stripe_session_id" "text" DEFAULT NULL::"text", "p_booking_receipt_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_hold_id" "uuid" DEFAULT NULL::"uuid", "p_participant_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("ok" boolean, "participant_id" "uuid", "reason" "text", "available_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_capacity INTEGER;
  v_committed INTEGER;
  v_holds INTEGER;
  v_hold public.capacity_holds%ROWTYPE;
  v_existing public.booking_participants%ROWTYPE;
  v_allow BOOLEAN := false;
BEGIN
  IF p_payment_status NOT IN ('paid', 'free') THEN
    RAISE EXCEPTION 'Committed booking participant status must be paid or free';
  END IF;

  PERFORM public.capacity_lock_scope(p_venue_id, 'booking_group', p_booking_group_key, p_session_date);

  IF p_participant_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.booking_participants
    WHERE id = p_participant_id
      AND venue_id = p_venue_id
    FOR UPDATE;
  END IF;

  IF v_existing.id IS NULL AND p_user_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.booking_participants
    WHERE venue_id = p_venue_id
      AND booking_group_key = p_booking_group_key
      AND user_id = p_user_id
      AND payment_status <> 'cancelled'
    FOR UPDATE;
  END IF;

  IF v_existing.id IS NOT NULL AND v_existing.payment_status IN ('paid', 'free') THEN
    IF p_hold_id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'committed',
          committed_at = COALESCE(committed_at, now())
      WHERE id = p_hold_id
        AND status = 'active';
    END IF;
    ok := true;
    participant_id := v_existing.id;
    reason := 'already_committed';
    available_count := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_hold_id IS NOT NULL THEN
    SELECT * INTO v_hold
    FROM public.capacity_holds
    WHERE id = p_hold_id
      AND venue_id = p_venue_id
      AND scope_type = 'booking_group'
      AND scope_id = p_booking_group_key
      AND session_date = p_session_date
    FOR UPDATE;
  ELSIF NULLIF(BTRIM(COALESCE(p_payment_stripe_session_id, '')), '') IS NOT NULL THEN
    SELECT * INTO v_hold
    FROM public.capacity_holds
    WHERE stripe_session_id = p_payment_stripe_session_id
      AND venue_id = p_venue_id
      AND scope_type = 'booking_group'
      AND scope_id = p_booking_group_key
      AND session_date = p_session_date
    FOR UPDATE;
  END IF;

  v_capacity := public.capacity_scope_capacity(p_venue_id, 'booking_group', p_booking_group_key, p_capacity);
  v_committed := public.capacity_committed_count(p_venue_id, 'booking_group', p_booking_group_key, p_session_date, NULL, v_existing.id);
  v_holds := public.capacity_active_holds_count(p_venue_id, 'booking_group', p_booking_group_key, p_session_date, v_hold.id);

  IF v_hold.id IS NOT NULL AND v_hold.status = 'active' AND v_hold.expires_at > now() THEN
    v_allow := true;
  ELSIF v_capacity IS NULL OR (v_committed + v_holds) < v_capacity THEN
    v_allow := true;
  END IF;

  IF NOT v_allow THEN
    IF v_hold.id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'conflict',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('conflict_at', now(), 'conflict_reason', 'capacity_full_after_payment')
      WHERE id = v_hold.id;
    END IF;
    ok := false;
    participant_id := NULL;
    reason := 'capacity_full';
    available_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.booking_participants
    SET invite_id = COALESCE(p_invite_id, invite_id),
        customer_id = COALESCE(p_customer_id, customer_id),
        user_id = COALESCE(p_user_id, user_id),
        display_name = COALESCE(NULLIF(BTRIM(p_display_name), ''), display_name),
        email = COALESCE(NULLIF(BTRIM(p_email), ''), email),
        phone = COALESCE(NULLIF(BTRIM(p_phone), ''), phone),
        role = COALESCE(NULLIF(BTRIM(p_role), ''), role),
        price_minor = GREATEST(COALESCE(p_price_minor, price_minor), 0),
        payment_status = p_payment_status,
        payment_method = COALESCE(p_payment_method, payment_method),
        payment_stripe_session_id = COALESCE(NULLIF(BTRIM(p_payment_stripe_session_id), ''), payment_stripe_session_id),
        booking_receipt_id = COALESCE(p_booking_receipt_id, booking_receipt_id),
        metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO participant_id;
  ELSE
    INSERT INTO public.booking_participants (
      venue_id,
      booking_id,
      booking_group_key,
      invite_id,
      customer_id,
      user_id,
      display_name,
      email,
      phone,
      role,
      price_minor,
      payment_status,
      payment_method,
      payment_stripe_session_id,
      booking_receipt_id,
      metadata
    )
    VALUES (
      p_venue_id,
      p_booking_id,
      p_booking_group_key,
      p_invite_id,
      p_customer_id,
      p_user_id,
      COALESCE(NULLIF(BTRIM(p_display_name), ''), 'Spelare'),
      NULLIF(BTRIM(p_email), ''),
      NULLIF(BTRIM(p_phone), ''),
      COALESCE(NULLIF(BTRIM(p_role), ''), 'player'),
      GREATEST(COALESCE(p_price_minor, 0), 0),
      p_payment_status,
      p_payment_method,
      NULLIF(BTRIM(p_payment_stripe_session_id), ''),
      p_booking_receipt_id,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO participant_id;
  END IF;

  IF v_hold.id IS NOT NULL THEN
    UPDATE public.capacity_holds
    SET status = 'committed',
        committed_at = COALESCE(committed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('booking_participant_id', participant_id)
    WHERE id = v_hold.id;
  END IF;

  ok := true;
  reason := 'committed';
  available_count := CASE
    WHEN v_capacity IS NULL THEN NULL
    ELSE GREATEST(v_capacity - public.capacity_committed_count(p_venue_id, 'booking_group', p_booking_group_key, p_session_date) - public.capacity_active_holds_count(p_venue_id, 'booking_group', p_booking_group_key, p_session_date), 0)
  END;
  RETURN NEXT;
END;
$$;



--
-- Name: enforce_commerce_order_lifecycle(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."enforce_commerce_order_lifecycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'commerce_order_is_frozen';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    NEW.venue_id IS DISTINCT FROM OLD.venue_id OR
    NEW.currency IS DISTINCT FROM OLD.currency OR
    NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor OR
    NEW.discount_minor IS DISTINCT FROM OLD.discount_minor OR
    NEW.total_inc_vat_minor IS DISTINCT FROM OLD.total_inc_vat_minor OR
    NEW.total_ex_vat_minor IS DISTINCT FROM OLD.total_ex_vat_minor OR
    NEW.vat_amount_minor IS DISTINCT FROM OLD.vat_amount_minor OR
    NEW.guest_token_hash IS DISTINCT FROM OLD.guest_token_hash OR
    (
      NEW.checkout_frozen_at IS DISTINCT FROM OLD.checkout_frozen_at
      AND NOT (OLD.status = 'checkout_pending' AND NEW.status = 'draft' AND NEW.checkout_frozen_at IS NULL)
    )
  ) THEN
    RAISE EXCEPTION 'commerce_order_is_frozen';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;



--
-- Name: enforce_commerce_order_line_lifecycle(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."enforce_commerce_order_line_lifecycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.commerce_orders
  WHERE id = COALESCE(NEW.commerce_order_id, OLD.commerce_order_id);

  IF TG_OP = 'INSERT' AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'commerce_order_not_draft';
  END IF;
  IF TG_OP = 'DELETE' AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'commerce_order_lines_are_frozen';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status <> 'draft' AND (
    NEW.commerce_order_id IS DISTINCT FROM OLD.commerce_order_id OR
    NEW.product_id IS DISTINCT FROM OLD.product_id OR
    NEW.product_key IS DISTINCT FROM OLD.product_key OR
    NEW.product_name IS DISTINCT FROM OLD.product_name OR
    NEW.commerce_kind IS DISTINCT FROM OLD.commerce_kind OR
    NEW.quantity IS DISTINCT FROM OLD.quantity OR
    NEW.unit_price_minor IS DISTINCT FROM OLD.unit_price_minor OR
    NEW.discount_minor IS DISTINCT FROM OLD.discount_minor OR
    NEW.line_total_inc_vat_minor IS DISTINCT FROM OLD.line_total_inc_vat_minor OR
    NEW.vat_rate IS DISTINCT FROM OLD.vat_rate OR
    NEW.vat_amount_minor IS DISTINCT FROM OLD.vat_amount_minor OR
    NEW.line_total_ex_vat_minor IS DISTINCT FROM OLD.line_total_ex_vat_minor OR
    NEW.source_type IS DISTINCT FROM OLD.source_type OR
    NEW.source_id IS DISTINCT FROM OLD.source_id OR
    NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type OR
    NEW.activity_session_id IS DISTINCT FROM OLD.activity_session_id OR
    NEW.session_date IS DISTINCT FROM OLD.session_date OR
    NEW.beneficiary_customer_id IS DISTINCT FROM OLD.beneficiary_customer_id OR
    NEW.beneficiary_user_id IS DISTINCT FROM OLD.beneficiary_user_id OR
    NEW.parent_line_id IS DISTINCT FROM OLD.parent_line_id OR
    NEW.capacity_hold_id IS DISTINCT FROM OLD.capacity_hold_id OR
    NEW.resolver_snapshot IS DISTINCT FROM OLD.resolver_snapshot OR
    NEW.product_snapshot IS DISTINCT FROM OLD.product_snapshot
  ) THEN
    RAISE EXCEPTION 'commerce_order_lines_are_frozen';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;



--
-- Name: enforce_one_vote_per_poll(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."enforce_one_vote_per_poll"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Delete any existing vote by this user on ANY option of the same poll
  DELETE FROM public.forum_poll_votes fpv
  WHERE fpv.auth_user_id = NEW.auth_user_id
    AND fpv.option_id IN (
      SELECT fpo.id FROM public.forum_poll_options fpo
      WHERE fpo.post_id = (SELECT post_id FROM public.forum_poll_options WHERE id = NEW.option_id)
    )
    AND fpv.id IS DISTINCT FROM NEW.id;
  RETURN NEW;
END;
$$;



--
-- Name: ensure_customer_identity_for_auth_user_safe("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."ensure_customer_identity_for_auth_user_safe"("_auth_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
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



--
-- Name: finalize_commerce_payment("uuid", integer, "text", "text", "uuid", "uuid", "text", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."finalize_commerce_payment"("p_order_id" "uuid", "p_order_version" integer, "p_stripe_session_id" "text", "p_payment_intent_id" "text", "p_customer_id" "uuid", "p_user_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_payment_method" "text") RETURNS TABLE("order_id" "uuid", "receipt_id" "uuid", "ledger_entry_id" "uuid", "already_finalized" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_receipt_id UUID;
  v_ledger_id UUID;
  v_receipt_number TEXT;
  v_rate_count INTEGER;
  v_single_rate NUMERIC(5,2);
  v_vat_breakdown JSONB;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  IF v_order.version <> p_order_version THEN RAISE EXCEPTION 'commerce_order_version_mismatch'; END IF;
  IF v_order.stripe_session_id IS DISTINCT FROM p_stripe_session_id THEN
    RAISE EXCEPTION 'commerce_order_stripe_session_mismatch';
  END IF;

  IF v_order.status IN ('paid', 'attention') THEN
    RETURN QUERY SELECT v_order.id, v_order.booking_receipt_id, v_order.ledger_entry_id, true;
    RETURN;
  END IF;
  IF v_order.status <> 'checkout_pending' THEN RAISE EXCEPTION 'commerce_order_not_payable'; END IF;

  SELECT COUNT(DISTINCT vat_rate), MAX(vat_rate) INTO v_rate_count, v_single_rate
  FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'vat_rate', vat_rate,
    'amount_inc_vat_minor', amount_inc_vat_minor,
    'vat_amount_minor', vat_amount_minor
  ) ORDER BY vat_rate), '[]'::jsonb)
  INTO v_vat_breakdown
  FROM (
    SELECT vat_rate,
           SUM(line_total_inc_vat_minor)::INTEGER AS amount_inc_vat_minor,
           SUM(vat_amount_minor)::INTEGER AS vat_amount_minor
    FROM public.commerce_order_lines
    WHERE commerce_order_id = p_order_id
    GROUP BY vat_rate
  ) rates;

  INSERT INTO public.booking_receipts (
    venue_id, user_id, customer_id, customer_name, customer_email, customer_phone,
    stripe_session_id, stripe_payment_intent_id, commerce_order_id,
    purchase_type, product_description, payment_method, payment_provider, payment_status,
    total_inc_vat, total_ex_vat, vat_amount, total_inc_vat_sek, total_ex_vat_sek,
    vat_amount_sek, vat_rate, currency, metadata
  ) VALUES (
    v_order.venue_id, p_user_id, p_customer_id, p_customer_name, p_customer_email, p_customer_phone,
    p_stripe_session_id, p_payment_intent_id, p_order_id,
    'commerce_order', 'Pickla-köp', p_payment_method, 'stripe', 'paid',
    ROUND(v_order.total_inc_vat_minor / 100.0), ROUND(v_order.total_ex_vat_minor / 100.0),
    ROUND(v_order.vat_amount_minor / 100.0), v_order.total_inc_vat_minor / 100.0,
    v_order.total_ex_vat_minor / 100.0, v_order.vat_amount_minor / 100.0,
    CASE WHEN v_rate_count = 1 THEN v_single_rate ELSE NULL END,
    v_order.currency,
    jsonb_build_object('product_type', 'commerce_order', 'commerce_order_id', p_order_id, 'vat_breakdown', v_vat_breakdown)
  )
  ON CONFLICT (commerce_order_id) WHERE commerce_order_id IS NOT NULL DO UPDATE
    SET commerce_order_id = EXCLUDED.commerce_order_id
  RETURNING id, receipt_number INTO v_receipt_id, v_receipt_number;

  INSERT INTO public.commerce_receipt_lines (
    booking_receipt_id, commerce_order_id, commerce_order_line_id, product_id,
    product_key, product_name, commerce_kind, quantity, unit_price_minor,
    discount_minor, total_inc_vat_minor, vat_rate, vat_amount_minor,
    total_ex_vat_minor, fulfillment_type, metadata, sort_order
  )
  SELECT v_receipt_id, p_order_id, l.id, l.product_id, l.product_key, l.product_name,
         l.commerce_kind, l.quantity, l.unit_price_minor, l.discount_minor,
         l.line_total_inc_vat_minor, l.vat_rate, l.vat_amount_minor,
         l.line_total_ex_vat_minor, l.fulfillment_type,
         jsonb_build_object('source_type', l.source_type, 'source_id', l.source_id,
           'activity_session_id', l.activity_session_id, 'session_date', l.session_date),
         l.sort_order
  FROM public.commerce_order_lines l WHERE l.commerce_order_id = p_order_id
  ON CONFLICT (commerce_order_line_id) DO NOTHING;

  INSERT INTO public.ledger_entries (
    venue_id, customer_id, source_type, source_id, accounting_date, occurred_at,
    customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status,
    payment_method, stripe_session_id, receipt_number, booking_receipt_id,
    commerce_order_id, metadata
  ) VALUES (
    v_order.venue_id, p_customer_id, 'commerce_order', p_order_id::TEXT,
    (now() AT TIME ZONE 'Europe/Stockholm')::DATE, now(), p_customer_name,
    v_order.total_inc_vat_minor, v_order.vat_amount_minor, 'paid', p_payment_method,
    p_stripe_session_id, v_receipt_number, v_receipt_id, p_order_id,
    jsonb_build_object('commerce_order_id', p_order_id, 'vat_breakdown', v_vat_breakdown)
  )
  ON CONFLICT (commerce_order_id) WHERE commerce_order_id IS NOT NULL DO UPDATE
    SET commerce_order_id = EXCLUDED.commerce_order_id
  RETURNING id INTO v_ledger_id;

  UPDATE public.commerce_orders
  SET status = 'paid', customer_id = p_customer_id, user_id = COALESCE(p_user_id, user_id),
      guest_name = COALESCE(p_customer_name, guest_name),
      guest_email = COALESCE(lower(p_customer_email), guest_email),
      guest_phone = COALESCE(p_customer_phone, guest_phone),
      stripe_payment_intent_id = p_payment_intent_id,
      booking_receipt_id = v_receipt_id, ledger_entry_id = v_ledger_id, paid_at = now()
  WHERE id = p_order_id;

  RETURN QUERY SELECT p_order_id, v_receipt_id, v_ledger_id, false;
END;
$$;



--
-- Name: fn_bump_room_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."fn_bump_room_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update public.chat_rooms
  set updated_at = now()
  where id = new.room_id;

  return new;
end;
$$;



--
-- Name: fn_display_devices_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."fn_display_devices_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;



--
-- Name: fn_event_communications_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."fn_event_communications_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;



--
-- Name: fn_generate_booking_receipt_number(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."fn_generate_booking_receipt_number"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  n BIGINT;
BEGIN
  n := nextval('public.booking_receipt_number_seq');
  RETURN 'PICKLA-' || to_char(now(), 'YYYY') || '-' || lpad(n::TEXT, 6, '0');
END;
$$;



--
-- Name: fn_ops_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."fn_ops_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;



--
-- Name: fn_score_player_links_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."fn_score_player_links_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;



--
-- Name: fn_score_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."fn_score_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;



--
-- Name: freeze_commerce_order("uuid", integer, "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."freeze_commerce_order"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb") RETURNS TABLE("order_id" "uuid", "version" integer, "total_inc_vat_minor" integer, "currency" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_item JSONB;
  v_line_id UUID;
  v_unit INTEGER;
  v_quantity INTEGER;
  v_discount INTEGER;
  v_total INTEGER;
  v_vat_rate NUMERIC(5,2);
  v_vat INTEGER;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  IF v_order.status <> 'draft' THEN RAISE EXCEPTION 'commerce_order_not_draft'; END IF;
  IF v_order.version <> p_expected_version THEN RAISE EXCEPTION 'stale_cart_version'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'commerce_order_empty';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id;
  IF v_count <> jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'commerce_order_line_mismatch'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_id := (v_item->>'id')::UUID;
    v_unit := GREATEST(COALESCE((v_item->>'unit_price_minor')::INTEGER, 0), 0);
    v_quantity := GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1);
    v_discount := GREATEST(COALESCE((v_item->>'discount_minor')::INTEGER, 0), 0);
    v_total := v_unit * v_quantity - v_discount;
    IF v_total < 0 THEN RAISE EXCEPTION 'invalid_commerce_line_discount'; END IF;
    v_vat_rate := COALESCE((v_item->>'vat_rate')::NUMERIC, 0);
    IF v_vat_rate < 0 OR v_vat_rate > 100 THEN RAISE EXCEPTION 'invalid_commerce_line_vat'; END IF;
    v_vat := ROUND(v_total * v_vat_rate / (100 + v_vat_rate));

    UPDATE public.commerce_order_lines
    SET product_key = COALESCE(NULLIF(v_item->>'product_key', ''), product_key),
        product_name = COALESCE(NULLIF(v_item->>'product_name', ''), product_name),
        commerce_kind = COALESCE(NULLIF(v_item->>'commerce_kind', ''), commerce_kind),
        quantity = v_quantity,
        unit_price_minor = v_unit,
        discount_minor = v_discount,
        line_total_inc_vat_minor = v_total,
        vat_rate = v_vat_rate,
        vat_amount_minor = v_vat,
        line_total_ex_vat_minor = v_total - v_vat,
        fulfillment_type = COALESCE(NULLIF(v_item->>'fulfillment_type', ''), fulfillment_type),
        fulfillment_status = CASE
          WHEN COALESCE(NULLIF(v_item->>'fulfillment_type', ''), fulfillment_type) = 'desk_pickup'
            THEN 'pending_pickup'
          ELSE 'not_required'
        END,
        beneficiary_customer_id = NULLIF(v_item->>'beneficiary_customer_id', '')::UUID,
        beneficiary_user_id = NULLIF(v_item->>'beneficiary_user_id', '')::UUID,
        capacity_hold_id = NULLIF(v_item->>'capacity_hold_id', '')::UUID,
        resolver_snapshot = COALESCE(v_item->'resolver_snapshot', '{}'::jsonb),
        product_snapshot = COALESCE(v_item->'product_snapshot', '{}'::jsonb)
    WHERE id = v_line_id AND commerce_order_id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_line_not_found'; END IF;
  END LOOP;

  UPDATE public.commerce_orders o
  SET subtotal_minor = totals.subtotal_minor,
      discount_minor = totals.discount_minor,
      total_inc_vat_minor = totals.total_inc_vat_minor,
      vat_amount_minor = totals.vat_amount_minor,
      total_ex_vat_minor = totals.total_ex_vat_minor,
      status = 'checkout_pending',
      version = o.version + 1,
      checkout_frozen_at = now()
  FROM (
    SELECT COALESCE(SUM(unit_price_minor * quantity), 0)::INTEGER AS subtotal_minor,
           COALESCE(SUM(discount_minor), 0)::INTEGER AS discount_minor,
           COALESCE(SUM(line_total_inc_vat_minor), 0)::INTEGER AS total_inc_vat_minor,
           COALESCE(SUM(vat_amount_minor), 0)::INTEGER AS vat_amount_minor,
           COALESCE(SUM(line_total_ex_vat_minor), 0)::INTEGER AS total_ex_vat_minor
    FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id
  ) totals
  WHERE o.id = p_order_id
  RETURNING o.id, o.version, o.total_inc_vat_minor, o.currency
  INTO order_id, version, total_inc_vat_minor, currency;
  RETURN NEXT;
END;
$$;



--
-- Name: generate_booking_ref(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."generate_booking_ref"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  _ref TEXT;
  _exists BOOLEAN;
BEGIN
  LOOP
    _ref := 'PK-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    SELECT EXISTS(SELECT 1 FROM public.bookings WHERE booking_ref = _ref) INTO _exists;
    EXIT WHEN NOT _exists;
  END LOOP;
  NEW.booking_ref := _ref;
  RETURN NEW;
END;
$$;



--
-- Name: generate_order_number(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."generate_order_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  _ref TEXT;
  _exists BOOLEAN;
BEGIN
  LOOP
    _ref := 'CO-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    SELECT EXISTS(SELECT 1 FROM public.corporate_orders WHERE order_number = _ref) INTO _exists;
    EXIT WHEN NOT _exists;
  END LOOP;
  NEW.order_number := _ref;
  RETURN NEW;
END;
$$;



--
-- Name: get_player_profile_id("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."get_player_profile_id"("_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT id FROM public.player_profiles WHERE auth_user_id = _user_id LIMIT 1
$$;



--
-- Name: get_public_activity_session_hosts("uuid"[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."get_public_activity_session_hosts"("session_ids" "uuid"[]) RETURNS TABLE("activity_session_id" "uuid", "customer_id" "uuid", "first_name" "text", "display_name" "text", "avatar_url" "text", "sort_order" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    h.activity_session_id,
    h.customer_id,
    NULLIF(split_part(COALESCE(c.first_name, c.display_name, p.first_name, p.display_name, ''), ' ', 1), '') AS first_name,
    COALESCE(c.display_name, p.display_name, c.first_name) AS display_name,
    p.avatar_url,
    h.sort_order
  FROM public.activity_session_hosts h
  JOIN public.activity_sessions s ON s.id = h.activity_session_id
  JOIN public.venues v ON v.id = h.venue_id
  JOIN public.customers c ON c.id = h.customer_id
  LEFT JOIN LATERAL (
    SELECT pp.first_name, pp.display_name, pp.avatar_url
    FROM public.player_profiles pp
    WHERE pp.customer_id = c.id
    ORDER BY pp.created_at DESC NULLS LAST, pp.id
    LIMIT 1
  ) p ON true
  WHERE h.status = 'active'
    AND h.activity_session_id = ANY(session_ids)
    AND s.is_active = true
    AND s.publish_status = 'published'
    AND v.is_public = true
  ORDER BY h.activity_session_id, h.sort_order ASC, h.created_at ASC;
$$;



--
-- Name: get_public_profile("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."get_public_profile"("profile_id" "uuid") RETURNS TABLE("id" "uuid", "display_name" "text", "avatar_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT p.id, p.display_name, p.avatar_url
  FROM public.player_profiles p
  WHERE p.id = profile_id
     OR p.auth_user_id = profile_id
  LIMIT 1;
$$;



--
-- Name: get_venue_id_for_event("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."get_venue_id_for_event"("_event_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT venue_id FROM public.events WHERE id = _event_id
$$;



--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
  PERFORM public.ensure_customer_identity_for_auth_user_safe(NEW.id);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;



--
-- Name: has_role("uuid", "public"."app_role"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;



--
-- Name: is_any_active_venue_staff("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."is_any_active_venue_staff"("_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.venue_staff vs
    WHERE vs.user_id = _user_id
      AND vs.is_active = true
  );
$$;



--
-- Name: is_crew_leader("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."is_crew_leader"("_user_id" "uuid", "_crew_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crew_members cm
    JOIN public.player_profiles pp ON pp.id = cm.player_profile_id
    WHERE cm.crew_id = _crew_id
      AND pp.auth_user_id = _user_id
      AND cm.role IN ('leader', 'co_leader')
  )
$$;



--
-- Name: is_franchisee_admin("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."is_franchisee_admin"("_user_id" "uuid", "_franchisee_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.franchisees f
    WHERE f.id = _franchisee_id
      AND public.is_organization_admin(_user_id, f.organization_id)
  )
$$;



--
-- Name: is_franchisee_member("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."is_franchisee_member"("_user_id" "uuid", "_franchisee_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.franchisees f
    WHERE f.id = _franchisee_id
      AND public.is_organization_member(_user_id, f.organization_id)
  )
$$;



--
-- Name: is_organization_admin("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."is_organization_admin"("_user_id" "uuid", "_organization_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = _user_id
      AND om.organization_id = _organization_id
      AND om.is_active = true
      AND om.role IN ('owner', 'admin')
  )
$$;



--
-- Name: is_organization_member("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."is_organization_member"("_user_id" "uuid", "_organization_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = _user_id
      AND om.organization_id = _organization_id
      AND om.is_active = true
  )
$$;



--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.has_role(auth.uid(), 'super_admin')
$$;



--
-- Name: is_venue_admin("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."is_venue_admin"("_user_id" "uuid", "_venue_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_staff
    WHERE user_id = _user_id AND venue_id = _venue_id AND role = 'venue_admin' AND is_active = true
  )
$$;



--
-- Name: is_venue_member("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."is_venue_member"("_user_id" "uuid", "_venue_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_staff
    WHERE user_id = _user_id AND venue_id = _venue_id AND is_active = true
  )
$$;



SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: chat_rooms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."chat_rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "room_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "subtitle" "text",
    "emoji" "text" DEFAULT '💬'::"text",
    "resource_id" "text",
    "is_public" boolean DEFAULT true NOT NULL,
    "session_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chat_rooms_room_type_check" CHECK (("room_type" = ANY (ARRAY['daily'::"text", 'booking'::"text", 'event'::"text", 'ritual'::"text"])))
);



--
-- Name: join_chat_room("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."join_chat_room"("p_room_id" "uuid") RETURNS SETOF "public"."chat_rooms"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO chat_participants (room_id, user_id)
  VALUES (p_room_id, auth.uid())
  ON CONFLICT (room_id, user_id) DO NOTHING;

  RETURN QUERY SELECT * FROM chat_rooms WHERE id = p_room_id;
END;
$$;



--
-- Name: on_crew_challenge_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."on_crew_challenge_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  _challenger_name TEXT;
  _challenged_name TEXT;
  _feed_type TEXT;
  _title TEXT;
BEGIN
  SELECT name INTO _challenger_name FROM public.crews WHERE id = NEW.challenger_crew_id;
  SELECT name INTO _challenged_name FROM public.crews WHERE id = NEW.challenged_crew_id;

  IF TG_OP = 'INSERT' THEN
    _feed_type := 'crew_challenge_created';
    _title := COALESCE(_challenger_name, 'Crew') || ' utmanade ' || COALESCE(_challenged_name, 'Crew');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    _feed_type := 'crew_challenge_accepted';
    _title := COALESCE(_challenged_name, 'Crew') || ' accepterade clash från ' || COALESCE(_challenger_name, 'Crew');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    _feed_type := 'crew_challenge_completed';
    _title := 'Clash avslutad: ' || COALESCE(_challenger_name, 'Crew') || ' vs ' || COALESCE(_challenged_name, 'Crew');
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.community_feed (feed_type, title, content)
  VALUES (
    _feed_type,
    _title,
    jsonb_build_object(
      'challenge_id', NEW.id,
      'challenger_crew_id', NEW.challenger_crew_id,
      'challenger_name', COALESCE(_challenger_name, ''),
      'challenged_crew_id', NEW.challenged_crew_id,
      'challenged_name', COALESCE(_challenged_name, ''),
      'status', NEW.status,
      'message', COALESCE(NEW.message, ''),
      'result', COALESCE(NEW.result, '{}'::jsonb)
    )
  );

  RETURN NEW;
END;
$$;



--
-- Name: on_crew_session_created(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."on_crew_session_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  _crew_name TEXT;
  _venue_name TEXT;
  _court_name TEXT;
BEGIN
  -- Only post to feed if NOT private
  IF NEW.is_private = true THEN
    RETURN NEW;
  END IF;

  SELECT name INTO _crew_name FROM public.crews WHERE id = NEW.crew_id;
  SELECT name INTO _venue_name FROM public.venues WHERE id = NEW.venue_id;
  SELECT name INTO _court_name FROM public.venue_courts WHERE id = NEW.venue_court_id;

  INSERT INTO public.community_feed (venue_id, feed_type, title, content)
  VALUES (
    NEW.venue_id,
    'crew_session',
    COALESCE(_crew_name, 'Crew') || ': ' || NEW.title,
    jsonb_build_object(
      'session_id', NEW.id,
      'crew_id', NEW.crew_id,
      'crew_name', COALESCE(_crew_name, ''),
      'venue_name', COALESCE(_venue_name, ''),
      'court_name', COALESCE(_court_name, ''),
      'session_date', NEW.session_date,
      'start_time', NEW.start_time,
      'end_time', NEW.end_time,
      'max_participants', NEW.max_participants
    )
  );

  RETURN NEW;
END;
$$;



--
-- Name: on_event_created(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."on_event_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.is_public = true THEN
    INSERT INTO public.community_feed (venue_id, event_id, feed_type, title, content)
    VALUES (
      NEW.venue_id,
      NEW.id,
      'event_created',
      COALESCE(NEW.display_name, NEW.name),
      jsonb_build_object(
        'event_type', NEW.event_type,
        'format', NEW.format,
        'start_date', NEW.start_date
      )
    );
  END IF;
  RETURN NEW;
END;
$$;



--
-- Name: on_match_completed(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."on_match_completed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  _venue_id UUID;
  _event_name TEXT;
  _team1_name TEXT;
  _team2_name TEXT;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT venue_id, name INTO _venue_id, _event_name FROM public.events WHERE id = NEW.event_id;
    SELECT name INTO _team1_name FROM public.teams WHERE id = NEW.team1_id;
    SELECT name INTO _team2_name FROM public.teams WHERE id = NEW.team2_id;

    INSERT INTO public.community_feed (venue_id, event_id, feed_type, title, content)
    VALUES (
      _venue_id,
      NEW.event_id,
      'match_result',
      COALESCE(_team1_name, 'Team 1') || ' vs ' || COALESCE(_team2_name, 'Team 2'),
      jsonb_build_object(
        'match_id', NEW.id,
        'team1_name', COALESCE(_team1_name, 'Team 1'),
        'team2_name', COALESCE(_team2_name, 'Team 2'),
        'team1_score', COALESCE(NEW.team1_score, 0),
        'team2_score', COALESCE(NEW.team2_score, 0),
        'event_name', COALESCE(_event_name, '')
      )
    );
  END IF;
  RETURN NEW;
END;
$$;



--
-- Name: on_venue_checkin_created(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."on_venue_checkin_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  _venue_name TEXT;
  _player_name TEXT;
  _profile_id UUID;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO _venue_name FROM public.venues WHERE id = NEW.venue_id;
  SELECT id, display_name INTO _profile_id, _player_name
    FROM public.player_profiles WHERE auth_user_id = NEW.user_id;

  IF _profile_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.community_feed (venue_id, player_profile_id, feed_type, title, content)
  VALUES (
    NEW.venue_id,
    _profile_id,
    'checkin',
    COALESCE(_player_name, 'Someone') || ' checked in at ' || COALESCE(_venue_name, 'the venue') || ' 🏓',
    jsonb_build_object(
      'checkin_id', NEW.id,
      'player_name', COALESCE(_player_name, ''),
      'venue_name', COALESCE(_venue_name, ''),
      'entry_type', NEW.entry_type
    )
  );
  RETURN NEW;
END;
$$;



--
-- Name: open_booking_note_is_allowed("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."open_booking_note_is_allowed"("p_note" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  SELECT NOT (
    COALESCE(p_note, '') ~* '(^|[^[:alpha:]])(endast|bara)[[:space:]]+(damer|kvinnor|tjejer|män|killar)([^[:alpha:]]|$)'
    OR COALESCE(p_note, '') ~* '(^|[^[:alnum:]])minst[[:space:]]+4[,.]0([+]?)([^[:alnum:]]|$)'
    OR COALESCE(p_note, '') ~* '(^|[^[:alnum:]])4[,.]0[+]([^[:alnum:]]|$)'
    OR COALESCE(p_note, '') ~* '(^|[^[:alpha:]])inga[[:space:]]+nybörjare([^[:alpha:]]|$)'
    OR COALESCE(p_note, '') ~* '(^|[^[:alpha:]])endast[[:space:]]+medlemmar([^[:alpha:]]|$)'
  );
$_$;



--
-- Name: prevent_audit_log_mutation(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."prevent_audit_log_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;



--
-- Name: prevent_ledger_entries_mutation(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."prevent_ledger_entries_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries are append-only';
END;
$$;



--
-- Name: release_capacity_hold("uuid", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."release_capacity_hold"("p_hold_id" "uuid", "p_reason" "text" DEFAULT 'released'::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.capacity_holds
  SET status = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'released' END,
      released_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('release_reason', COALESCE(p_reason, 'released'))
  WHERE id = p_hold_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;



--
-- Name: reopen_commerce_order_after_checkout_failure("uuid", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."reopen_commerce_order_after_checkout_failure"("p_order_id" "uuid", "p_version" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.commerce_orders
  SET status = 'draft', version = version + 1, stripe_session_id = NULL, checkout_frozen_at = NULL
  WHERE id = p_order_id AND version = p_version AND status = 'checkout_pending';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.commerce_order_lines SET capacity_hold_id = NULL WHERE commerce_order_id = p_order_id;
  RETURN true;
END;
$$;



--
-- Name: replace_commerce_cart_lines("uuid", integer, "jsonb", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."replace_commerce_cart_lines"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb", "p_guest_name" "text" DEFAULT NULL::"text", "p_guest_email" "text" DEFAULT NULL::"text", "p_guest_phone" "text" DEFAULT NULL::"text") RETURNS TABLE("order_id" "uuid", "version" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_item JSONB;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  IF v_order.status <> 'draft' THEN RAISE EXCEPTION 'commerce_order_not_draft'; END IF;
  IF v_order.version <> p_expected_version THEN RAISE EXCEPTION 'stale_cart_version'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'commerce_order_empty';
  END IF;

  DELETE FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.commerce_order_lines (
      id, commerce_order_id, product_id, product_key, product_name, commerce_kind,
      quantity, unit_price_minor, discount_minor, line_total_inc_vat_minor,
      vat_rate, vat_amount_minor, line_total_ex_vat_minor, source_type, source_id,
      fulfillment_type, fulfillment_status, activity_session_id, session_date,
      beneficiary_customer_id, beneficiary_user_id, parent_line_id,
      product_snapshot, metadata, sort_order
    ) VALUES (
      (v_item->>'id')::UUID, p_order_id, (v_item->>'product_id')::UUID,
      v_item->>'product_key', v_item->>'product_name', v_item->>'commerce_kind',
      GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1), 0, 0, 0,
      COALESCE((v_item->>'vat_rate')::NUMERIC, 0), 0, 0,
      v_item->>'source_type', NULLIF(v_item->>'source_id', ''),
      v_item->>'fulfillment_type', 'not_required',
      NULLIF(v_item->>'activity_session_id', '')::UUID,
      NULLIF(v_item->>'session_date', '')::DATE,
      NULLIF(v_item->>'beneficiary_customer_id', '')::UUID,
      NULLIF(v_item->>'beneficiary_user_id', '')::UUID,
      NULLIF(v_item->>'parent_line_id', '')::UUID,
      COALESCE(v_item->'product_snapshot', '{}'::jsonb),
      COALESCE(v_item->'metadata', '{}'::jsonb),
      COALESCE((v_item->>'sort_order')::INTEGER, 0)
    );
  END LOOP;

  UPDATE public.commerce_orders
  SET version = commerce_orders.version + 1,
      guest_name = COALESCE(NULLIF(BTRIM(p_guest_name), ''), guest_name),
      guest_email = COALESCE(NULLIF(lower(BTRIM(p_guest_email)), ''), guest_email),
      guest_phone = COALESCE(NULLIF(BTRIM(p_guest_phone), ''), guest_phone)
  WHERE id = p_order_id
  RETURNING id, commerce_orders.version INTO order_id, version;
  RETURN NEXT;
END;
$$;



--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;



--
-- Name: set_open_booking_slots("text", "uuid", "uuid"[], "text", integer, "text", "text", "text", "text", "text", boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."set_open_booking_slots"("p_action" "text", "p_actor_user_id" "uuid", "p_booking_ids" "uuid"[], "p_booking_group_key" "text", "p_opened_places" integer DEFAULT NULL::integer, "p_pace" "text" DEFAULT 'all_levels'::"text", "p_note" "text" DEFAULT NULL::"text", "p_request_id" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text", "p_ip" "text" DEFAULT NULL::"text", "p_allow_staff_close" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_booking_count integer := 0;
  v_committed_count integer := 0;
  v_active_holds_count integer := 0;
  v_public_capacity integer := 0;
  v_operational_max integer := 32;
  v_note text := NULLIF(left(btrim(COALESCE(p_note, '')), 120), '');
  v_now timestamptz := now();
  v_invite public.booking_participant_invites%ROWTYPE;
  v_token text;
BEGIN
  IF p_action NOT IN ('open', 'close') THEN
    RAISE EXCEPTION 'Invalid open booking action';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing actor';
  END IF;
  IF p_booking_group_key IS NULL OR btrim(p_booking_group_key) = '' THEN
    RAISE EXCEPTION 'Missing booking group';
  END IF;
  IF p_booking_ids IS NULL OR array_length(p_booking_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Missing booking rows';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = ANY(p_booking_ids)
    AND status <> 'cancelled'
  ORDER BY start_time ASC, created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.user_id <> p_actor_user_id
    AND COALESCE(v_booking.booked_by, v_booking.user_id) <> p_actor_user_id
    AND NOT (p_action = 'close' AND COALESCE(p_allow_staff_close, false))
  THEN
    RAISE EXCEPTION 'Endast bokaren kan öppna platser';
  END IF;

  PERFORM 1
  FROM public.bookings
  WHERE id = ANY(p_booking_ids)
    AND venue_id = v_booking.venue_id
    AND status <> 'cancelled'
  FOR UPDATE;

  SELECT COUNT(*)::integer INTO v_booking_count
  FROM public.bookings
  WHERE id = ANY(p_booking_ids)
    AND venue_id = v_booking.venue_id
    AND status <> 'cancelled';

  IF v_booking_count <> array_length(p_booking_ids, 1) THEN
    RAISE EXCEPTION 'Booking group changed. Uppdatera och försök igen.';
  END IF;

  SELECT COUNT(*)::integer INTO v_committed_count
  FROM public.booking_participants
  WHERE venue_id = v_booking.venue_id
    AND booking_group_key = p_booking_group_key
    AND payment_status IN ('paid', 'free');

  IF p_action = 'close' THEN
    UPDATE public.bookings
    SET open_for_more_status = 'closed',
        open_for_more_closed_at = v_now
    WHERE id = ANY(p_booking_ids);

    UPDATE public.booking_participant_invites
    SET status = 'revoked',
        updated_at = v_now,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('closed_at', v_now)
    WHERE venue_id = v_booking.venue_id
      AND booking_group_key = p_booking_group_key
      AND status = 'active'
      AND metadata @> jsonb_build_object('source', 'open_booking_slot');

    INSERT INTO public.audit_log (
      venue_id, actor_user_id, actor_type, action, entity_table, entity_id,
      request_id, after, metadata, ip, user_agent
    )
    VALUES (
      v_booking.venue_id, p_actor_user_id, 'user', 'booking.open_for_more.close',
      'bookings', v_booking.id::text, p_request_id,
      jsonb_build_object('status', 'closed'),
      jsonb_build_object('booking_group_key', p_booking_group_key, 'committed_count', v_committed_count),
      p_ip, p_user_agent
    );

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'closed',
      'committed_count', v_committed_count
    );
  END IF;

  IF COALESCE(p_opened_places, 0) < 1 THEN
    RAISE EXCEPTION 'Välj minst 1 plats att öppna';
  END IF;
  IF p_pace NOT IN ('all_levels', 'calm_pace', 'familiar_pace', 'high_pace') THEN
    RAISE EXCEPTION 'Välj tempokategori';
  END IF;
  IF NOT public.open_booking_note_is_allowed(v_note) THEN
    RAISE EXCEPTION 'Beskriv spelet och tempot — inte vilka människor som får vara med.';
  END IF;

  SELECT COUNT(*)::integer INTO v_active_holds_count
  FROM public.capacity_holds
  WHERE venue_id = v_booking.venue_id
    AND scope_type = 'booking_group'
    AND scope_id = p_booking_group_key
    AND session_date = (v_booking.start_time AT TIME ZONE 'Europe/Stockholm')::date
    AND status = 'active'
    AND expires_at > now();

  v_public_capacity := v_committed_count + p_opened_places;

  IF v_public_capacity > v_operational_max THEN
    RAISE EXCEPTION 'Max % spelare kan öppnas i denna version', v_operational_max;
  END IF;
  IF v_public_capacity < (v_committed_count + v_active_holds_count) THEN
    RAISE EXCEPTION 'Det finns redan aktiva platser eller betalningar som inte får plats';
  END IF;

  UPDATE public.bookings
  SET open_for_more_status = 'open',
      open_for_more_opened_places = p_opened_places,
      open_for_more_public_capacity = v_public_capacity,
      open_for_more_committed_at_publication = v_committed_count,
      open_for_more_total_players = v_public_capacity,
      open_for_more_pace = p_pace,
      open_for_more_note = v_note,
      open_for_more_published_at = COALESCE(open_for_more_published_at, v_now),
      open_for_more_closed_at = NULL
  WHERE id = ANY(p_booking_ids);

  SELECT * INTO v_invite
  FROM public.booking_participant_invites
  WHERE venue_id = v_booking.venue_id
    AND booking_group_key = p_booking_group_key
    AND status = 'active'
    AND metadata @> jsonb_build_object('source', 'open_booking_slot')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_invite.id IS NULL THEN
    v_token := gen_random_uuid()::text;
    INSERT INTO public.booking_participant_invites (
      venue_id,
      booking_id,
      booking_group_key,
      token,
      created_by_user_id,
      metadata
    )
    VALUES (
      v_booking.venue_id,
      v_booking.id,
      p_booking_group_key,
      v_token,
      p_actor_user_id,
      jsonb_build_object(
        'source', 'open_booking_slot',
        'open_booking_published_at', v_now,
        'open_booking_opened_places', p_opened_places,
        'open_booking_public_capacity', v_public_capacity,
        'open_booking_committed_at_publication', v_committed_count,
        'open_booking_total_players', v_public_capacity
      )
    )
    RETURNING * INTO v_invite;
  ELSE
    v_token := v_invite.token;
    UPDATE public.booking_participant_invites
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'open_booking_opened_places', p_opened_places,
          'open_booking_public_capacity', v_public_capacity,
          'open_booking_committed_at_publication', v_committed_count,
          'open_booking_total_players', v_public_capacity
        ),
        updated_at = v_now
    WHERE id = v_invite.id
    RETURNING * INTO v_invite;
  END IF;

  INSERT INTO public.audit_log (
    venue_id, actor_user_id, actor_type, action, entity_table, entity_id,
    request_id, after, metadata, ip, user_agent
  )
  VALUES (
    v_booking.venue_id, p_actor_user_id, 'user', 'booking.open_for_more.open',
    'bookings', v_booking.id::text, p_request_id,
    jsonb_build_object(
      'status', 'open',
      'opened_places', p_opened_places,
      'public_capacity', v_public_capacity,
      'committed_at_publication', v_committed_count,
      'open_spots', GREATEST(v_public_capacity - v_committed_count - v_active_holds_count, 0),
      'pace', p_pace,
      'has_note', v_note IS NOT NULL
    ),
    jsonb_build_object('booking_group_key', p_booking_group_key, 'invite_id', v_invite.id),
    p_ip, p_user_agent
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'open',
    'opened_places', p_opened_places,
    'public_capacity', v_public_capacity,
    'committed_at_publication', v_committed_count,
    'open_spots', GREATEST(v_public_capacity - v_committed_count - v_active_holds_count, 0),
    'pace', p_pace,
    'note', v_note,
    'token', v_invite.token,
    'invite_id', v_invite.id,
    'published_at', COALESCE(v_booking.open_for_more_published_at, v_now)
  );
END;
$$;



--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;



--
-- Name: set_venue_commerce_enabled("uuid", boolean, "uuid", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."set_venue_commerce_enabled"("p_venue_id" "uuid", "p_enabled" boolean, "p_actor_user_id" "uuid", "p_request_id" "text" DEFAULT NULL::"text", "p_ip" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS TABLE("venue_id" "uuid", "previous_value" boolean, "commerce_enabled" boolean, "changed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_previous BOOLEAN;
  v_organization_id UUID;
  v_changed BOOLEAN;
BEGIN
  SELECT venue.organization_id, venue.commerce_enabled
  INTO v_organization_id, v_previous
  FROM public.venues venue
  WHERE venue.id = p_venue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venue not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles role_row
    WHERE role_row.user_id = p_actor_user_id
      AND role_row.role = 'super_admin'
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.venue_staff staff
    WHERE staff.user_id = p_actor_user_id
      AND staff.venue_id = p_venue_id
      AND staff.role = 'venue_admin'
      AND staff.is_active = true
  ) THEN
    RAISE EXCEPTION 'Forbidden: venue admin only' USING ERRCODE = '42501';
  END IF;

  v_changed := v_previous IS DISTINCT FROM p_enabled;

  IF v_changed THEN
    UPDATE public.venues
    SET commerce_enabled = p_enabled
    WHERE id = p_venue_id;

    INSERT INTO public.audit_log (
      organization_id,
      venue_id,
      actor_user_id,
      actor_type,
      action,
      entity_table,
      entity_id,
      request_id,
      before,
      after,
      metadata,
      ip,
      user_agent
    ) VALUES (
      v_organization_id,
      p_venue_id,
      p_actor_user_id,
      'user',
      'venue.commerce.availability_changed',
      'venues',
      p_venue_id::TEXT,
      COALESCE(p_request_id, gen_random_uuid()::TEXT),
      jsonb_build_object('commerce_enabled', v_previous),
      jsonb_build_object('commerce_enabled', p_enabled),
      jsonb_build_object('setting', 'online_sales'),
      p_ip,
      p_user_agent
    );
  END IF;

  RETURN QUERY
  SELECT p_venue_id, v_previous, p_enabled, v_changed;
END;
$$;



--
-- Name: FUNCTION "set_venue_commerce_enabled"("p_venue_id" "uuid", "p_enabled" boolean, "p_actor_user_id" "uuid", "p_request_id" "text", "p_ip" "text", "p_user_agent" "text"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."set_venue_commerce_enabled"("p_venue_id" "uuid", "p_enabled" boolean, "p_actor_user_id" "uuid", "p_request_id" "text", "p_ip" "text", "p_user_agent" "text") IS 'Atomically changes venue online sales availability and records before/after audit evidence.';


--
-- Name: commerce_order_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."commerce_order_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "commerce_order_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "product_key" "text" NOT NULL,
    "product_name" "text" NOT NULL,
    "commerce_kind" "text" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "unit_price_minor" integer DEFAULT 0 NOT NULL,
    "discount_minor" integer DEFAULT 0 NOT NULL,
    "line_total_inc_vat_minor" integer DEFAULT 0 NOT NULL,
    "vat_rate" numeric(5,2) NOT NULL,
    "vat_amount_minor" integer DEFAULT 0 NOT NULL,
    "line_total_ex_vat_minor" integer DEFAULT 0 NOT NULL,
    "source_type" "text" NOT NULL,
    "source_id" "text",
    "fulfillment_type" "text" NOT NULL,
    "fulfillment_status" "text" DEFAULT 'not_required'::"text" NOT NULL,
    "fulfilled_at" timestamp with time zone,
    "fulfilled_by" "uuid",
    "activity_session_id" "uuid",
    "session_date" "date",
    "session_registration_id" "uuid",
    "beneficiary_customer_id" "uuid",
    "beneficiary_user_id" "uuid",
    "parent_line_id" "uuid",
    "capacity_hold_id" "uuid",
    "resolver_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "product_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "commerce_order_lines_amounts_balance" CHECK ((("line_total_inc_vat_minor" = (("unit_price_minor" * "quantity") - "discount_minor")) AND (("line_total_ex_vat_minor" + "vat_amount_minor") = "line_total_inc_vat_minor"))),
    CONSTRAINT "commerce_order_lines_commerce_kind_check" CHECK (("commerce_kind" = ANY (ARRAY['participation'::"text", 'rental'::"text", 'merchandise'::"text"]))),
    CONSTRAINT "commerce_order_lines_discount_minor_check" CHECK (("discount_minor" >= 0)),
    CONSTRAINT "commerce_order_lines_fulfillment_status_check" CHECK (("fulfillment_status" = ANY (ARRAY['not_required'::"text", 'pending_pickup'::"text", 'collected'::"text", 'not_collected'::"text", 'attention'::"text"]))),
    CONSTRAINT "commerce_order_lines_fulfillment_type_check" CHECK (("fulfillment_type" = ANY (ARRAY['participation'::"text", 'desk_pickup'::"text"]))),
    CONSTRAINT "commerce_order_lines_line_total_ex_vat_minor_check" CHECK (("line_total_ex_vat_minor" >= 0)),
    CONSTRAINT "commerce_order_lines_line_total_inc_vat_minor_check" CHECK (("line_total_inc_vat_minor" >= 0)),
    CONSTRAINT "commerce_order_lines_quantity_check" CHECK ((("quantity" > 0) AND ("quantity" <= 100))),
    CONSTRAINT "commerce_order_lines_unit_price_minor_check" CHECK (("unit_price_minor" >= 0)),
    CONSTRAINT "commerce_order_lines_vat_amount_minor_check" CHECK (("vat_amount_minor" >= 0)),
    CONSTRAINT "commerce_order_lines_vat_rate_check" CHECK ((("vat_rate" >= (0)::numeric) AND ("vat_rate" <= (100)::numeric)))
);



--
-- Name: transition_commerce_fulfillment("uuid", "text", "uuid", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."transition_commerce_fulfillment"("p_line_id" "uuid", "p_next_status" "text", "p_actor_user_id" "uuid", "p_request_id" "text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "public"."commerce_order_lines"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_before public.commerce_order_lines%ROWTYPE;
  v_after public.commerce_order_lines%ROWTYPE;
  v_order public.commerce_orders%ROWTYPE;
BEGIN
  IF p_next_status NOT IN ('pending_pickup', 'collected', 'not_collected', 'attention') THEN
    RAISE EXCEPTION 'invalid_fulfillment_status';
  END IF;
  SELECT * INTO v_before FROM public.commerce_order_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_line_not_found'; END IF;
  IF v_before.fulfillment_type <> 'desk_pickup' THEN RAISE EXCEPTION 'line_does_not_require_pickup'; END IF;
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = v_before.commerce_order_id;
  IF v_order.status NOT IN ('paid', 'attention') THEN RAISE EXCEPTION 'commerce_order_not_paid'; END IF;

  UPDATE public.commerce_order_lines
  SET fulfillment_status = p_next_status,
      fulfilled_at = CASE WHEN p_next_status IN ('collected', 'not_collected') THEN now() ELSE NULL END,
      fulfilled_by = CASE WHEN p_next_status IN ('collected', 'not_collected') THEN p_actor_user_id ELSE NULL END
  WHERE id = p_line_id RETURNING * INTO v_after;

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_order.organization_id, v_order.venue_id, p_actor_user_id, 'user',
    'commerce.fulfillment.transition', 'commerce_order_lines', p_line_id::TEXT,
    p_request_id, to_jsonb(v_before), to_jsonb(v_after), COALESCE(p_metadata, '{}'::jsonb)
  );
  RETURN v_after;
END;
$$;



--
-- Name: update_post_comment_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."update_post_comment_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.forum_posts SET comment_count = (
      SELECT COUNT(*) FROM public.post_comments WHERE post_id = OLD.post_id
    ) WHERE id = OLD.post_id;
    RETURN OLD;
  ELSE
    UPDATE public.forum_posts SET comment_count = (
      SELECT COUNT(*) FROM public.post_comments WHERE post_id = NEW.post_id
    ) WHERE id = NEW.post_id;
    RETURN NEW;
  END IF;
END;
$$;



--
-- Name: update_post_vote_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."update_post_vote_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.forum_posts SET upvote_count = (
      SELECT COALESCE(SUM(vote_value), 0) FROM public.post_votes WHERE post_id = OLD.post_id
    ) WHERE id = OLD.post_id;
    RETURN OLD;
  ELSE
    UPDATE public.forum_posts SET upvote_count = (
      SELECT COALESCE(SUM(vote_value), 0) FROM public.post_votes WHERE post_id = NEW.post_id
    ) WHERE id = NEW.post_id;
    RETURN NEW;
  END IF;
END;
$$;



--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;



--
-- Name: upsert_daily_chat_room("uuid", "date", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."upsert_daily_chat_room"("p_venue_id" "uuid", "p_session_date" "date", "p_name" "text" DEFAULT 'Pickla Idag'::"text") RETURNS SETOF "public"."chat_rooms"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_row chat_rooms;
BEGIN
  INSERT INTO chat_rooms (venue_id, room_type, title, subtitle, emoji, is_public, session_date)
  VALUES (
    p_venue_id,
    'daily',
    p_name,
    'Öppen kanal · alla välkomna',
    '📅',
    true,
    p_session_date
  )
  ON CONFLICT (venue_id, session_date)
    WHERE room_type = 'daily' AND session_date IS NOT NULL
  DO UPDATE SET updated_at = now()
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$;



--
-- Name: upsert_resource_chat_room("uuid", "text", "text", "text", "text", "text", boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."upsert_resource_chat_room"("p_venue_id" "uuid", "p_resource_id" "text", "p_room_type" "text", "p_title" "text", "p_subtitle" "text" DEFAULT NULL::"text", "p_emoji" "text" DEFAULT '💬'::"text", "p_is_public" boolean DEFAULT true) RETURNS SETOF "public"."chat_rooms"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_row chat_rooms;
BEGIN
  INSERT INTO chat_rooms (venue_id, resource_id, room_type, title, subtitle, emoji, is_public)
  VALUES (p_venue_id, p_resource_id, p_room_type, p_title, p_subtitle, p_emoji, p_is_public)
  ON CONFLICT (resource_id)
    WHERE resource_id IS NOT NULL
  DO UPDATE SET updated_at = now()
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$;



--
-- Name: access_entitlements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."access_entitlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "entitlement_type" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "source_type" "text",
    "source_id" "uuid",
    "activity_session_id" "uuid",
    "session_date" "date",
    "valid_date" "date",
    "valid_from" timestamp with time zone,
    "valid_until" timestamp with time zone,
    "includes_session_types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "uses_limit" integer,
    "uses_count" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "access_entitlements_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'consumed'::"text", 'expired'::"text", 'revoked'::"text", 'suspended'::"text"]))),
    CONSTRAINT "access_entitlements_type_check" CHECK (("entitlement_type" = ANY (ARRAY['day_access'::"text", 'session_ticket'::"text", 'membership_access'::"text", 'booking_access'::"text"])))
);



--
-- Name: access_products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."access_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "product_key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "product_kind" "text" DEFAULT 'day_access'::"text" NOT NULL,
    "session_type" "text",
    "base_price_sek" integer DEFAULT 0 NOT NULL,
    "vat_rate" numeric(5,2) DEFAULT 6 NOT NULL,
    "grants" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "early_bird_price_minor" integer,
    "early_bird_slots" integer,
    "scarcity_mode" "text" DEFAULT 'none'::"text" NOT NULL,
    "commerce_kind" "text",
    "fulfillment_type" "text",
    "resolver_rules" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "commerce_enabled" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "standalone_enabled" boolean DEFAULT false NOT NULL,
    "activity_addon_enabled" boolean DEFAULT false NOT NULL,
    "fulfillment_presentation" "text",
    "category" "text",
    "sport" "text",
    "image_url" "text",
    CONSTRAINT "access_products_commerce_kind_check" CHECK ((("commerce_kind" IS NULL) OR ("commerce_kind" = ANY (ARRAY['participation'::"text", 'rental'::"text", 'merchandise'::"text"])))),
    CONSTRAINT "access_products_early_bird_price_nonnegative" CHECK ((("early_bird_price_minor" IS NULL) OR ("early_bird_price_minor" >= 0))),
    CONSTRAINT "access_products_early_bird_slots_positive" CHECK ((("early_bird_slots" IS NULL) OR ("early_bird_slots" > 0))),
    CONSTRAINT "access_products_fulfillment_presentation_check" CHECK ((("fulfillment_presentation" IS NULL) OR ("fulfillment_presentation" = ANY (ARRAY['desk_pickup'::"text", 'digital'::"text", 'participation'::"text"])))),
    CONSTRAINT "access_products_fulfillment_type_check" CHECK ((("fulfillment_type" IS NULL) OR ("fulfillment_type" = ANY (ARRAY['participation'::"text", 'desk_pickup'::"text"])))),
    CONSTRAINT "access_products_key_format" CHECK (("product_key" ~ '^[a-z0-9_]+$'::"text")),
    CONSTRAINT "access_products_kind_check" CHECK (("product_kind" = ANY (ARRAY['day_access'::"text", 'session_ticket'::"text", 'session_with_day_access'::"text", 'voucher'::"text", 'membership'::"text", 'rental'::"text", 'merchandise'::"text"]))),
    CONSTRAINT "access_products_scarcity_mode_check" CHECK (("scarcity_mode" = ANY (ARRAY['none'::"text", 'early_bird'::"text", 'capacity'::"text"]))),
    CONSTRAINT "access_products_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'archived'::"text"])))
);



--
-- Name: COLUMN "access_products"."commerce_kind"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."access_products"."commerce_kind" IS 'Canonical commerce classification. product_kind remains a legacy access subtype only.';


--
-- Name: COLUMN "access_products"."commerce_enabled"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."access_products"."commerce_enabled" IS 'Derived compatibility projection. Product sales truth is status plus sales modes plus venue Commerce availability.';


--
-- Name: COLUMN "access_products"."status"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."access_products"."status" IS 'Operator-facing lifecycle: draft, active or archived.';


--
-- Name: COLUMN "access_products"."standalone_enabled"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."access_products"."standalone_enabled" IS 'Business intent: product may be purchased without a participation parent.';


--
-- Name: COLUMN "access_products"."activity_addon_enabled"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."access_products"."activity_addon_enabled" IS 'Business intent: product may be added to explicitly related participation products.';


--
-- Name: COLUMN "access_products"."fulfillment_presentation"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."access_products"."fulfillment_presentation" IS 'Operator/customer wording for delivery; internal fulfillment_type remains checkout compatibility truth.';


--
-- Name: access_vouchers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."access_vouchers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "purchaser_user_id" "uuid",
    "claimed_by_user_id" "uuid",
    "code" "text" NOT NULL,
    "voucher_type" "text" DEFAULT 'day_access'::"text" NOT NULL,
    "status" "text" DEFAULT 'unused'::"text" NOT NULL,
    "value_count" integer DEFAULT 1 NOT NULL,
    "expires_at" timestamp with time zone,
    "claimed_at" timestamp with time zone,
    "redeemed_at" timestamp with time zone,
    "source_type" "text",
    "source_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recipient_name" "text",
    CONSTRAINT "access_vouchers_status_check" CHECK (("status" = ANY (ARRAY['unused'::"text", 'claimed'::"text", 'redeemed'::"text", 'expired'::"text", 'revoked'::"text"])))
);



--
-- Name: activity_series; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."activity_series" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "series_type" "text" DEFAULT 'program'::"text" NOT NULL,
    "sport_type" "text" DEFAULT 'pickleball'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "product_key" "text",
    "start_date" "date",
    "end_date" "date",
    "total_sessions" integer,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activity_series_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'paused'::"text", 'completed'::"text", 'cancelled'::"text"])))
);



--
-- Name: activity_session_hosts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."activity_session_hosts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "activity_session_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role" "text" DEFAULT 'playing_host'::"text" NOT NULL,
    CONSTRAINT "activity_session_hosts_role_check" CHECK (("role" = 'playing_host'::"text")),
    CONSTRAINT "activity_session_hosts_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);



--
-- Name: activity_session_interests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."activity_session_interests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "activity_session_id" "uuid" NOT NULL,
    "session_date" "date" NOT NULL,
    "venue_id" "uuid",
    "status" "text" DEFAULT 'interested'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activity_session_interests_status_check" CHECK (("status" = 'interested'::"text"))
);



--
-- Name: activity_session_overrides; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."activity_session_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "activity_session_id" "uuid" NOT NULL,
    "session_date" "date" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "reason" "text",
    "venue_operation_override_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activity_session_overrides_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'hidden'::"text", 'cancelled'::"text"])))
);



--
-- Name: activity_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."activity_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "session_type" "text" DEFAULT 'open_play'::"text" NOT NULL,
    "sport_type" "text" DEFAULT 'pickleball'::"text" NOT NULL,
    "recurrence_days" integer[],
    "session_date" "date",
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "price_sek" integer DEFAULT 0 NOT NULL,
    "capacity" integer,
    "court_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "access_policy" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "series_id" "uuid",
    "product_key" "text",
    "publish_status" "text" DEFAULT 'published'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "early_bird_price_minor" integer,
    "early_bird_slots" integer,
    "scarcity_mode" "text" DEFAULT 'none'::"text" NOT NULL,
    "pace" "text",
    CONSTRAINT "activity_sessions_early_bird_price_nonnegative" CHECK ((("early_bird_price_minor" IS NULL) OR ("early_bird_price_minor" >= 0))),
    CONSTRAINT "activity_sessions_early_bird_slots_positive" CHECK ((("early_bird_slots" IS NULL) OR ("early_bird_slots" > 0))),
    CONSTRAINT "activity_sessions_pace_check" CHECK ((("pace" IS NULL) OR ("pace" = ANY (ARRAY['all_levels'::"text", 'calm_pace'::"text", 'familiar_pace'::"text", 'high_pace'::"text"])))),
    CONSTRAINT "activity_sessions_recurrence_or_date" CHECK ((("recurrence_days" IS NOT NULL) OR ("session_date" IS NOT NULL))),
    CONSTRAINT "activity_sessions_scarcity_mode_check" CHECK (("scarcity_mode" = ANY (ARRAY['none'::"text", 'early_bird'::"text", 'capacity'::"text"]))),
    CONSTRAINT "activity_sessions_time_order" CHECK ((("end_time" > "start_time") OR (("end_time" = '00:00:00'::time without time zone) AND ("start_time" > '00:00:00'::time without time zone))))
);



--
-- Name: CONSTRAINT "activity_sessions_time_order" ON "activity_sessions"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON CONSTRAINT "activity_sessions_time_order" ON "public"."activity_sessions" IS 'Same-day sessions require end_time > start_time; 00:00 is allowed only as midnight ending the operational date.';


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "franchisee_id" "uuid",
    "venue_id" "uuid",
    "actor_user_id" "uuid",
    "actor_type" "text" DEFAULT 'user'::"text" NOT NULL,
    "action" "text" NOT NULL,
    "entity_table" "text" NOT NULL,
    "entity_id" "text",
    "request_id" "text",
    "before" "jsonb",
    "after" "jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ip" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_log_actor_type_check" CHECK (("actor_type" = ANY (ARRAY['user'::"text", 'system'::"text", 'webhook'::"text", 'agent'::"text"])))
);



--
-- Name: booking_participant_invites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."booking_participant_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "booking_group_key" "text" NOT NULL,
    "token" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by_user_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_participant_invites_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'revoked'::"text", 'expired'::"text"])))
);



--
-- Name: booking_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."booking_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "booking_group_key" "text" NOT NULL,
    "invite_id" "uuid",
    "customer_id" "uuid",
    "user_id" "uuid",
    "display_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "role" "text" DEFAULT 'player'::"text" NOT NULL,
    "price_minor" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'SEK'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "payment_method" "text",
    "payment_stripe_session_id" "text",
    "booking_receipt_id" "uuid",
    "checked_in_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_participants_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'free'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "booking_participants_price_minor_check" CHECK (("price_minor" >= 0)),
    CONSTRAINT "booking_participants_role_check" CHECK (("role" = ANY (ARRAY['booker'::"text", 'player'::"text"])))
);



--
-- Name: booking_receipt_number_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE "public"."booking_receipt_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: booking_receipts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."booking_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "receipt_number" "text" DEFAULT "public"."fn_generate_booking_receipt_number"() NOT NULL,
    "booking_refs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "stripe_session_id" "text",
    "venue_id" "uuid",
    "user_id" "uuid",
    "customer_name" "text",
    "customer_email" "text",
    "customer_phone" "text",
    "total_inc_vat" integer DEFAULT 0 NOT NULL,
    "total_ex_vat" integer DEFAULT 0 NOT NULL,
    "vat_amount" integer DEFAULT 0 NOT NULL,
    "vat_rate" numeric(5,2) DEFAULT 6,
    "currency" "text" DEFAULT 'SEK'::"text" NOT NULL,
    "payment_provider" "text",
    "payment_status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "purchase_type" "text" DEFAULT 'booking'::"text" NOT NULL,
    "product_description" "text",
    "payment_method" "text",
    "stripe_payment_intent_id" "text",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "total_inc_vat_sek" numeric(12,2),
    "total_ex_vat_sek" numeric(12,2),
    "vat_amount_sek" numeric(12,2),
    "wellness_requested" boolean DEFAULT false NOT NULL,
    "personal_identity_number" "text",
    "employer_note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "customer_id" "uuid",
    "stripe_invoice_id" "text",
    "commerce_order_id" "uuid"
);



--
-- Name: bookings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "venue_court_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "status" "public"."booking_status" DEFAULT 'pending'::"public"."booking_status",
    "total_price" numeric(10,2),
    "currency" "text" DEFAULT 'SEK'::"text",
    "notes" "text",
    "booked_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "booking_ref" "text",
    "corporate_package_id" "uuid",
    "access_code" "text",
    "access_code_expires_at" timestamp with time zone,
    "stripe_session_id" "text",
    "membership_id" "uuid",
    "included_court_hours" numeric DEFAULT 0 NOT NULL,
    "paid_court_hours" numeric DEFAULT 0 NOT NULL,
    "membership_usage_entitlement_type" "text",
    "membership_usage_period_start" "date",
    "membership_usage_period_end" "date",
    "customer_id" "uuid",
    "open_for_more_status" "text" DEFAULT 'closed'::"text" NOT NULL,
    "open_for_more_total_players" integer,
    "open_for_more_pace" "text",
    "open_for_more_note" "text",
    "open_for_more_published_at" timestamp with time zone,
    "open_for_more_closed_at" timestamp with time zone,
    "open_for_more_opened_places" integer,
    "open_for_more_public_capacity" integer,
    "open_for_more_committed_at_publication" integer,
    CONSTRAINT "bookings_open_for_more_corrected_capacity_check" CHECK (((("open_for_more_opened_places" IS NULL) OR ("open_for_more_opened_places" >= 0)) AND (("open_for_more_public_capacity" IS NULL) OR ("open_for_more_public_capacity" >= 0)) AND (("open_for_more_committed_at_publication" IS NULL) OR ("open_for_more_committed_at_publication" >= 0)) AND (("open_for_more_public_capacity" IS NULL) OR ("open_for_more_committed_at_publication" IS NULL) OR ("open_for_more_public_capacity" >= "open_for_more_committed_at_publication")))),
    CONSTRAINT "bookings_open_for_more_pace_check" CHECK ((("open_for_more_pace" IS NULL) OR ("open_for_more_pace" = ANY (ARRAY['all_levels'::"text", 'calm_pace'::"text", 'familiar_pace'::"text", 'high_pace'::"text"])))),
    CONSTRAINT "bookings_open_for_more_status_check" CHECK (("open_for_more_status" = ANY (ARRAY['closed'::"text", 'open'::"text"])))
);



--
-- Name: COLUMN "bookings"."open_for_more_total_players"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."bookings"."open_for_more_total_players" IS 'Deprecated compatibility field from Release B v1. Use open_for_more_opened_places + open_for_more_public_capacity.';


--
-- Name: COLUMN "bookings"."open_for_more_opened_places"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."bookings"."open_for_more_opened_places" IS 'Additional Play Rights the owner chose to open for this published private booking.';


--
-- Name: COLUMN "bookings"."open_for_more_public_capacity"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."bookings"."open_for_more_public_capacity" IS 'Canonical capacity cap for public open-booking claims; never derived from court count.';


--
-- Name: COLUMN "bookings"."open_for_more_committed_at_publication"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."bookings"."open_for_more_committed_at_publication" IS 'Committed Play Rights counted when the open-booking capacity was last published/updated.';


--
-- Name: capacity_holds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."capacity_holds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "scope_type" "text" NOT NULL,
    "scope_id" "text" NOT NULL,
    "session_date" "date" NOT NULL,
    "user_id" "uuid",
    "customer_id" "uuid",
    "source_type" "text",
    "source_id" "uuid",
    "idempotency_key" "text",
    "stripe_session_id" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "committed_at" timestamp with time zone,
    "released_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "capacity_holds_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['activity_session'::"text", 'booking_group'::"text"]))),
    CONSTRAINT "capacity_holds_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'committed'::"text", 'released'::"text", 'expired'::"text", 'conflict'::"text"])))
);



--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "message_type" "text" DEFAULT 'text'::"text" NOT NULL,
    "content" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "reply_to_id" "uuid",
    CONSTRAINT "chat_messages_message_type_check" CHECK (("message_type" = ANY (ARRAY['text'::"text", 'bot'::"text", 'action_card'::"text", 'booking_card'::"text"])))
);



--
-- Name: chat_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."chat_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"(),
    "visible_from" timestamp with time zone
);



--
-- Name: chat_reactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."chat_reactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "room_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chat_reactions_emoji_check" CHECK (("length"("emoji") <= 8))
);



--
-- Name: comment_votes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."comment_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "vote_value" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: commerce_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."commerce_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "user_id" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "currency" "text" DEFAULT 'SEK'::"text" NOT NULL,
    "subtotal_minor" integer DEFAULT 0 NOT NULL,
    "discount_minor" integer DEFAULT 0 NOT NULL,
    "total_inc_vat_minor" integer DEFAULT 0 NOT NULL,
    "total_ex_vat_minor" integer DEFAULT 0 NOT NULL,
    "vat_amount_minor" integer DEFAULT 0 NOT NULL,
    "stripe_session_id" "text",
    "stripe_payment_intent_id" "text",
    "booking_receipt_id" "uuid",
    "ledger_entry_id" "uuid",
    "guest_token_hash" "text" NOT NULL,
    "receipt_token_hash" "text",
    "guest_name" "text",
    "guest_email" "text",
    "guest_phone" "text",
    "checkout_frozen_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "commerce_orders_currency_check" CHECK (("currency" = "upper"("currency"))),
    CONSTRAINT "commerce_orders_discount_minor_check" CHECK (("discount_minor" >= 0)),
    CONSTRAINT "commerce_orders_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'checkout_pending'::"text", 'paid'::"text", 'expired'::"text", 'cancelled'::"text", 'attention'::"text"]))),
    CONSTRAINT "commerce_orders_subtotal_minor_check" CHECK (("subtotal_minor" >= 0)),
    CONSTRAINT "commerce_orders_total_ex_vat_minor_check" CHECK (("total_ex_vat_minor" >= 0)),
    CONSTRAINT "commerce_orders_total_inc_vat_minor_check" CHECK (("total_inc_vat_minor" >= 0)),
    CONSTRAINT "commerce_orders_vat_amount_minor_check" CHECK (("vat_amount_minor" >= 0)),
    CONSTRAINT "commerce_orders_version_check" CHECK (("version" > 0))
);



--
-- Name: TABLE "commerce_orders"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."commerce_orders" IS 'Canonical cart/order lifecycle. status=draft is the Cart; no separate cart table exists.';


--
-- Name: commerce_receipt_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."commerce_receipt_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_receipt_id" "uuid" NOT NULL,
    "commerce_order_id" "uuid" NOT NULL,
    "commerce_order_line_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "product_key" "text" NOT NULL,
    "product_name" "text" NOT NULL,
    "commerce_kind" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "unit_price_minor" integer NOT NULL,
    "discount_minor" integer DEFAULT 0 NOT NULL,
    "total_inc_vat_minor" integer NOT NULL,
    "vat_rate" numeric(5,2) NOT NULL,
    "vat_amount_minor" integer NOT NULL,
    "total_ex_vat_minor" integer NOT NULL,
    "fulfillment_type" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "commerce_receipt_lines_commerce_kind_check" CHECK (("commerce_kind" = ANY (ARRAY['participation'::"text", 'rental'::"text", 'merchandise'::"text"]))),
    CONSTRAINT "commerce_receipt_lines_discount_minor_check" CHECK (("discount_minor" >= 0)),
    CONSTRAINT "commerce_receipt_lines_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "commerce_receipt_lines_total_ex_vat_minor_check" CHECK (("total_ex_vat_minor" >= 0)),
    CONSTRAINT "commerce_receipt_lines_total_inc_vat_minor_check" CHECK (("total_inc_vat_minor" >= 0)),
    CONSTRAINT "commerce_receipt_lines_unit_price_minor_check" CHECK (("unit_price_minor" >= 0)),
    CONSTRAINT "commerce_receipt_lines_vat_amount_minor_check" CHECK (("vat_amount_minor" >= 0))
);



--
-- Name: TABLE "commerce_receipt_lines"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."commerce_receipt_lines" IS 'General immutable receipt lines for participation, rental, and merchandise.';


--
-- Name: community_feed; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."community_feed" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid",
    "player_profile_id" "uuid",
    "event_id" "uuid",
    "feed_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "content" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: community_stories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."community_stories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid",
    "image_url" "text" NOT NULL,
    "caption" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval) NOT NULL,
    "created_by" "uuid" NOT NULL
);



--
-- Name: corporate_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."corporate_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "company_name" "text" NOT NULL,
    "contact_name" "text",
    "contact_email" "text",
    "contact_phone" "text",
    "invite_token" "text" DEFAULT "replace"(("gen_random_uuid"())::"text", '-'::"text", ''::"text") NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "discount_percent" numeric DEFAULT 0
);



--
-- Name: corporate_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."corporate_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "corporate_account_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "monthly_hour_limit" numeric,
    "monthly_cost_limit" numeric
);



--
-- Name: corporate_order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."corporate_order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "booking_id" "uuid",
    "day_of_week" integer,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "week_number" integer,
    "scheduled_date" "date",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: corporate_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."corporate_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "corporate_account_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "order_number" "text" NOT NULL,
    "order_type" "text" DEFAULT 'hours'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "total_hours" numeric DEFAULT 0 NOT NULL,
    "total_price" numeric DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'SEK'::"text",
    "notes" "text",
    "recurring_config" "jsonb",
    "created_by" "uuid" NOT NULL,
    "invoiced_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "fulfilled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: corporate_packages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."corporate_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "corporate_account_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "package_type" "text" DEFAULT 'hours'::"text" NOT NULL,
    "total_hours" numeric DEFAULT 0 NOT NULL,
    "used_hours" numeric DEFAULT 0 NOT NULL,
    "price_total" numeric,
    "currency" "text" DEFAULT 'SEK'::"text",
    "valid_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_to" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: courts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."courts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "court_number" integer NOT NULL,
    "is_available" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: crew_challenges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."crew_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenger_crew_id" "uuid" NOT NULL,
    "challenged_crew_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "message" "text",
    "result" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "crew_challenges_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'completed'::"text", 'declined'::"text"])))
);



--
-- Name: crew_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."crew_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "crew_id" "uuid" NOT NULL,
    "player_profile_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "crew_members_role_check" CHECK (("role" = ANY (ARRAY['leader'::"text", 'co_leader'::"text", 'elder'::"text", 'member'::"text"])))
);



--
-- Name: crew_session_signups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."crew_session_signups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "crew_session_id" "uuid" NOT NULL,
    "player_profile_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'signed_up'::"text" NOT NULL,
    "signed_up_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: crew_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."crew_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "crew_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "session_date" "date" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "venue_id" "uuid",
    "venue_court_id" "uuid",
    "booking_id" "uuid",
    "max_participants" integer,
    "status" "text" DEFAULT 'booked'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_private" boolean DEFAULT false NOT NULL
);



--
-- Name: crews; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."crews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "badge_emoji" "text" DEFAULT '⚡'::"text",
    "badge_color" "text" DEFAULT '#E86C24'::"text",
    "crew_type" "text" DEFAULT 'open'::"text" NOT NULL,
    "min_rating" integer DEFAULT 0 NOT NULL,
    "max_members" integer DEFAULT 50 NOT NULL,
    "created_by" "uuid" NOT NULL,
    "venue_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "crews_crew_type_check" CHECK (("crew_type" = ANY (ARRAY['open'::"text", 'invite_only'::"text", 'closed'::"text"])))
);



--
-- Name: customer_identities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."customer_identities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_id" "text",
    "email" "text",
    "phone" "text",
    "verified_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customer_identities_provider_check" CHECK (("provider" = ANY (ARRAY['auth'::"text", 'email'::"text", 'phone'::"text", 'stripe'::"text", 'zettle'::"text", 'manual'::"text"])))
);



--
-- Name: customer_venue_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."customer_venue_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "is_home_venue" boolean DEFAULT false NOT NULL,
    "first_seen_at" timestamp with time zone,
    "last_seen_at" timestamp with time zone,
    "visit_count" integer DEFAULT 0 NOT NULL,
    "private_notes" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: customers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "auth_user_id" "uuid",
    "display_name" "text",
    "first_name" "text",
    "last_name" "text",
    "primary_email" "text",
    "primary_phone" "text",
    "email_normalized" "text",
    "phone_e164" "text",
    "marketing_consent" boolean DEFAULT false NOT NULL,
    "consent_at" timestamp with time zone,
    "merged_into_id" "uuid",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customers_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'merged'::"text", 'archived'::"text"])))
);



--
-- Name: day_pass_grants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."day_pass_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "membership_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "month_year" "date" NOT NULL,
    "passes_allowed" integer DEFAULT 0 NOT NULL,
    "passes_used" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: day_pass_shares; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."day_pass_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "day_pass_id" "uuid" NOT NULL,
    "shared_by" "uuid" NOT NULL,
    "recipient_email" "text",
    "recipient_phone" "text",
    "token" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "claimed_by" "uuid",
    "claimed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "recipient_name" "text"
);



--
-- Name: day_passes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."day_passes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "purchase_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_date" "date" NOT NULL,
    "status" "public"."day_pass_status" DEFAULT 'active'::"public"."day_pass_status",
    "price" numeric(10,2),
    "currency" "text" DEFAULT 'SEK'::"text",
    "sold_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "shared_from" "uuid",
    "stripe_session_id" "text",
    "customer_id" "uuid"
);



--
-- Name: display_devices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."display_devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "venue_court_id" "uuid",
    "name" "text" NOT NULL,
    "device_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(24), 'hex'::"text") NOT NULL,
    "mode" "text" DEFAULT 'resource_home'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "external_links" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "instructions" "text",
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "display_devices_mode_check" CHECK (("mode" = ANY (ARRAY['resource_home'::"text", 'resource_checkin'::"text", 'venue_home'::"text"])))
);



--
-- Name: event_checkins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_checkins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "session_date" "date" NOT NULL,
    "checked_in" boolean DEFAULT false,
    "checked_in_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: event_communications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_communications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "room_id" "uuid",
    "direction" "text" NOT NULL,
    "channel" "text" DEFAULT 'email'::"text" NOT NULL,
    "from_email" "text",
    "to_email" "text",
    "subject" "text",
    "body_text" "text",
    "body_html" "text",
    "provider" "text" DEFAULT 'resend'::"text" NOT NULL,
    "provider_message_id" "text",
    "provider_event_id" "text",
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "created_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "event_communications_channel_check" CHECK (("channel" = 'email'::"text")),
    CONSTRAINT "event_communications_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"])))
);



--
-- Name: event_courts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_courts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "venue_court_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: event_followups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_followups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid",
    "event_lead_id" "uuid" NOT NULL,
    "event_offer_id" "uuid",
    "followup_type" "text" NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "sent_at" timestamp with time zone,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: event_lead_activities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_lead_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid",
    "event_lead_id" "uuid" NOT NULL,
    "event_offer_id" "uuid",
    "activity_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "actor_user_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: event_leads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid",
    "event_id" "uuid",
    "company_name" "text",
    "contact_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "participants_count" integer DEFAULT 1 NOT NULL,
    "preferred_date" "date",
    "preferred_time" "text",
    "event_type" "text",
    "activities" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "resources" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "message" "text",
    "source" "text" DEFAULT 'group_inquiry'::"text" NOT NULL,
    "lead_score" integer DEFAULT 50 NOT NULL,
    "status" "text" DEFAULT 'new_event_lead'::"text" NOT NULL,
    "package_type" "text",
    "estimated_value" integer DEFAULT 0 NOT NULL,
    "agent_summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "event_leads_lead_score_check" CHECK ((("lead_score" >= 1) AND ("lead_score" <= 100)))
);



--
-- Name: event_likes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: event_offer_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_offer_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "template_id" "uuid",
    "item_type" "text" DEFAULT 'service'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "unit_price" integer DEFAULT 0 NOT NULL,
    "unit" "text",
    "included_by_default" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: event_offer_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_offer_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "template_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "subtitle" "text",
    "description" "text",
    "default_price_per_person" integer DEFAULT 0 NOT NULL,
    "min_price_per_person" integer,
    "max_price_per_person" integer,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: event_offers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "image_url" "text",
    "cta_label" "text",
    "priority" integer DEFAULT 0,
    "display_on_ticker" boolean DEFAULT false,
    "display_on_player_info" boolean DEFAULT false,
    "valid_from" timestamp with time zone,
    "valid_to" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "venue_id" "uuid",
    "event_lead_id" "uuid",
    "package_type" "text",
    "price_per_person" integer DEFAULT 0 NOT NULL,
    "total_price" integer DEFAULT 0 NOT NULL,
    "pdf_url" "text",
    "html_snapshot" "text",
    "email_subject" "text",
    "email_body" "text",
    "sms_text" "text",
    "offer_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "sent_at" timestamp with time zone,
    "sent_by" "uuid",
    "provider_message_id" "text",
    "booking_confirmed_at" timestamp with time zone,
    "booking_confirmed_by" "uuid",
    "deposit_amount" integer,
    "deposit_stripe_session_id" "text",
    "deposit_checkout_url" "text",
    "deposit_sent_at" timestamp with time zone
);



--
-- Name: event_resource_allocations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_resource_allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "resource_catalog_id" "uuid",
    "venue_court_id" "uuid",
    "venue_staff_id" "uuid",
    "resource_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "start_at" timestamp with time zone,
    "end_at" timestamp with time zone,
    "status" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: event_resource_blocks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_resource_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "resource_catalog_id" "uuid",
    "event_id" "uuid",
    "event_lead_id" "uuid",
    "event_offer_id" "uuid",
    "title" "text" NOT NULL,
    "reason" "text" DEFAULT 'manual'::"text" NOT NULL,
    "status" "text" DEFAULT 'hold'::"text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "blocks_public_booking" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "event_resource_blocks_reason_check" CHECK (("reason" = ANY (ARRAY['manual'::"text", 'event'::"text", 'maintenance'::"text", 'private'::"text", 'internal'::"text"]))),
    CONSTRAINT "event_resource_blocks_status_check" CHECK (("status" = ANY (ARRAY['hold'::"text", 'confirmed'::"text", 'released'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "event_resource_blocks_valid_range" CHECK (("ends_at" > "starts_at"))
);



--
-- Name: event_resource_catalog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_resource_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "resource_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "venue_court_id" "uuid",
    "venue_staff_id" "uuid",
    "capacity" integer,
    "unit" "text",
    "default_unit_price" integer DEFAULT 0 NOT NULL,
    "is_bookable" boolean DEFAULT true NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: event_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."event_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "display_name" "text",
    "description" "text",
    "event_type" "public"."event_type" NOT NULL,
    "format" "public"."event_format" NOT NULL,
    "category" "text" DEFAULT 'tournament'::"text" NOT NULL,
    "entry_fee" numeric DEFAULT 0,
    "currency" "text" DEFAULT 'SEK'::"text",
    "vat_rate" numeric DEFAULT 6,
    "logo_url" "text",
    "background_url" "text",
    "primary_color" "text",
    "secondary_color" "text",
    "scoring_type" "text",
    "scoring_format" "text",
    "points_to_win" integer,
    "best_of" integer,
    "win_by_two" boolean DEFAULT false,
    "match_duration_default" integer,
    "competition_type" "text",
    "is_drop_in" boolean DEFAULT false,
    "is_public" boolean DEFAULT true,
    "registration_fields" "jsonb" DEFAULT '["name", "phone"]'::"jsonb" NOT NULL,
    "whatsapp_url" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "sport_type" "text" DEFAULT 'pickleball'::"text" NOT NULL
);



--
-- Name: events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid",
    "name" "text" NOT NULL,
    "display_name" "text",
    "event_type" "public"."event_type" NOT NULL,
    "format" "public"."event_format" NOT NULL,
    "status" "text" DEFAULT 'upcoming'::"text",
    "is_public" boolean DEFAULT true,
    "number_of_courts" integer DEFAULT 1,
    "start_date" timestamp with time zone,
    "end_date" timestamp with time zone,
    "logo_url" "text",
    "background_url" "text",
    "primary_color" "text",
    "secondary_color" "text",
    "aspect_ratio" "text",
    "scoring_type" "text",
    "scoring_format" "text",
    "points_to_win" integer,
    "best_of" integer,
    "win_by_two" boolean DEFAULT false,
    "match_duration_default" integer,
    "competition_type" "text",
    "battle_config" "jsonb",
    "group_stage_completed" boolean DEFAULT false,
    "semifinals_generated" boolean DEFAULT false,
    "final_generated" boolean DEFAULT false,
    "third_place_enabled" boolean DEFAULT false,
    "tournament_complete" boolean DEFAULT false,
    "winner_team_id" "uuid",
    "player_info_general" "text",
    "offer_title" "text",
    "offer_description" "text",
    "offer_valid_until" timestamp with time zone,
    "offer_show_on_ticker" boolean DEFAULT false,
    "offer_show_on_player_info" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "show_on_sticker" boolean DEFAULT false NOT NULL,
    "description" "text",
    "whatsapp_url" "text",
    "is_drop_in" boolean DEFAULT false NOT NULL,
    "registration_fields" "jsonb" DEFAULT '["name", "phone"]'::"jsonb" NOT NULL,
    "category" "text" DEFAULT 'tournament'::"text" NOT NULL,
    "slug" "text",
    "template_id" "uuid",
    "start_time" time without time zone,
    "end_time" time without time zone,
    "entry_fee" numeric,
    "entry_fee_type" "text" DEFAULT 'fixed'::"text" NOT NULL,
    "sport_type" "text" DEFAULT 'pickleball'::"text" NOT NULL,
    "max_participants" integer,
    "planning_status" "text" DEFAULT 'booked'::"text" NOT NULL,
    "visibility" "text" DEFAULT 'public'::"text" NOT NULL,
    "customer_name" "text",
    "customer_email" "text",
    "customer_phone" "text",
    "expected_participants" integer,
    "owner_name" "text",
    "partner_notes" "text",
    "internal_notes" "text",
    "resources" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "staffing" "text",
    CONSTRAINT "events_planning_status_check" CHECK (("planning_status" = ANY (ARRAY['inquiry'::"text", 'tentative'::"text", 'booked'::"text", 'ready'::"text", 'published'::"text", 'done'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "events_visibility_check" CHECK (("visibility" = ANY (ARRAY['internal'::"text", 'partners'::"text", 'public'::"text"])))
);



--
-- Name: feed_likes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."feed_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "feed_item_id" "uuid" NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: forum_poll_options; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."forum_poll_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: forum_poll_votes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."forum_poll_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "option_id" "uuid" NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: forum_post_signups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."forum_post_signups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "player_profile_id" "uuid" NOT NULL,
    "signed_up_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'confirmed'::"text" NOT NULL
);



--
-- Name: forum_posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."forum_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_profile_id" "uuid" NOT NULL,
    "venue_id" "uuid",
    "title" "text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "tag" "text" DEFAULT 'general'::"text" NOT NULL,
    "is_pinned" boolean DEFAULT false NOT NULL,
    "upvote_count" integer DEFAULT 0 NOT NULL,
    "comment_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sport_type" "text" DEFAULT 'pickleball'::"text" NOT NULL
);



--
-- Name: franchisees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."franchisees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "legal_name" "text" NOT NULL,
    "slug" "text",
    "org_number" "text",
    "stripe_account_id" "text",
    "payout_currency" "text" DEFAULT 'SEK'::"text" NOT NULL,
    "vat_rate" numeric DEFAULT 6 NOT NULL,
    "revenue_share_pct" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "franchisees_revenue_share_check" CHECK ((("revenue_share_pct" >= (0)::numeric) AND ("revenue_share_pct" <= (100)::numeric))),
    CONSTRAINT "franchisees_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'archived'::"text"])))
);



--
-- Name: investor_assets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."investor_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "asset_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "storage_path" "text" NOT NULL,
    "public_url" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "investor_assets_asset_type_check" CHECK (("asset_type" = ANY (ARRAY['logo'::"text", 'hero'::"text", 'venue_photo'::"text", 'dart_photo'::"text", 'product_screenshot'::"text", 'deck'::"text", 'other'::"text"])))
);



--
-- Name: investor_leads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."investor_leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "access_token_hash" "text",
    "token_expires_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "submitted_interest_at" timestamp with time zone,
    "requested_shares" integer,
    "message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "investor_leads_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'opened'::"text", 'interested'::"text"])))
);



--
-- Name: investor_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."investor_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "round_name" "text",
    "round_label" "text",
    "company_name" "text",
    "company_org_number" "text",
    "headline" "text",
    "subheadline" "text",
    "public_thesis" "text",
    "memo_intro" "text",
    "round_size_sek" integer,
    "valuation_sek" integer,
    "share_price_sek" integer,
    "shares_offered" integer,
    "total_existing_shares" integer,
    "minimum_shares" integer,
    "minimum_investment_sek" integer,
    "deadline_date" "date",
    "allocation_date" "date",
    "use_of_funds" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "traction_metrics" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "risks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "team" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "memo_sections" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "page_content" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);



--
-- Name: COLUMN "investor_settings"."page_content"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."investor_settings"."page_content" IS 'Explicit investor preview and private memo labels/supporting copy edited in /hub/admin/investors.';


--
-- Name: ladder_challenges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."ladder_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "challenger_entry_id" "uuid" NOT NULL,
    "challenged_entry_id" "uuid" NOT NULL,
    "challenger_player_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "message" "text",
    "reviewed_by" "text",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: ladder_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."ladder_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "player_id" "uuid",
    "team_id" "uuid",
    "position" integer NOT NULL,
    "absences" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: ladder_matches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."ladder_matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "challenger_entry_id" "uuid" NOT NULL,
    "challenged_entry_id" "uuid" NOT NULL,
    "challenger_position_before" integer NOT NULL,
    "challenged_position_before" integer NOT NULL,
    "challenger_score" integer,
    "challenged_score" integer,
    "winner_entry_id" "uuid",
    "status" "text" DEFAULT 'scheduled'::"text",
    "played_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."ledger_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_id" "text" NOT NULL,
    "accounting_date" "date" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "customer_name" "text",
    "amount_inc_vat_minor" integer NOT NULL,
    "vat_amount_minor" integer NOT NULL,
    "payment_status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "payment_method" "text",
    "stripe_session_id" "text",
    "receipt_number" "text",
    "booking_receipt_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "customer_id" "uuid",
    "commerce_order_id" "uuid",
    CONSTRAINT "ledger_entries_amount_non_negative" CHECK (("amount_inc_vat_minor" >= 0)),
    CONSTRAINT "ledger_entries_vat_non_negative" CHECK (("vat_amount_minor" >= 0))
);



--
-- Name: matches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "round" integer NOT NULL,
    "match_number" integer NOT NULL,
    "team1_id" "uuid",
    "team2_id" "uuid",
    "court_id" "uuid",
    "team1_score" integer DEFAULT 0,
    "team2_score" integer DEFAULT 0,
    "status" "public"."match_status" DEFAULT 'scheduled'::"public"."match_status",
    "stage" "public"."match_stage",
    "scheduled_time" timestamp with time zone,
    "started_at" timestamp with time zone,
    "match_duration_minutes" integer,
    "match_scoring_type" "text",
    "best_of_games" integer,
    "points_per_game" integer,
    "game_scores" "jsonb",
    "battle_id" "text",
    "battle_round" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: membership_entitlements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."membership_entitlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tier_id" "uuid" NOT NULL,
    "entitlement_type" "text" NOT NULL,
    "value" numeric,
    "period" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sport_type" "text" DEFAULT 'pickleball'::"text" NOT NULL
);



--
-- Name: membership_tier_pricing; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."membership_tier_pricing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tier_id" "uuid" NOT NULL,
    "product_type" "text" NOT NULL,
    "pricing_rule_id" "uuid",
    "fixed_price" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "discount_percent" numeric,
    "vat_rate" numeric DEFAULT 6,
    "label" "text",
    CONSTRAINT "check_price_or_discount" CHECK (((("fixed_price" IS NOT NULL) AND ("discount_percent" IS NULL)) OR (("fixed_price" IS NULL) AND ("discount_percent" IS NOT NULL)) OR (("fixed_price" IS NULL) AND ("discount_percent" IS NULL))))
);



--
-- Name: membership_tiers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."membership_tiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "color" "text" DEFAULT '#E86C24'::"text",
    "sort_order" integer DEFAULT 0,
    "discount_percent" numeric DEFAULT 0,
    "monthly_price" numeric DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_assignable" boolean DEFAULT true NOT NULL
);



--
-- Name: membership_usage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."membership_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "entitlement_type" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "used_value" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: memberships; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "tier_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "starts_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "expires_at" "date",
    "notes" "text",
    "assigned_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "customer_id" "uuid"
);



--
-- Name: open_play_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."open_play_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "day_of_week" integer[] NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "price_sek" integer DEFAULT 0 NOT NULL,
    "max_players" integer DEFAULT 20 NOT NULL,
    "court_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: opening_hours; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."opening_hours" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "day_of_week" integer NOT NULL,
    "open_time" time without time zone NOT NULL,
    "close_time" time without time zone NOT NULL,
    "is_closed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "opening_hours_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);



--
-- Name: operations_integration_health; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."operations_integration_health" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid",
    "integration_key" "text" NOT NULL,
    "status" "text" DEFAULT 'NEVER_SYNCED'::"text" NOT NULL,
    "last_successful_sync_at" timestamp with time zone,
    "last_failed_sync_at" timestamp with time zone,
    "message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "operations_integration_health_status_check" CHECK (("status" = ANY (ARRAY['OK'::"text", 'FAILED'::"text", 'NEVER_SYNCED'::"text"])))
);



--
-- Name: ops_agent_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."ops_agent_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'ok'::"text" NOT NULL,
    "summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ops_agent_runs_status_check" CHECK (("status" = ANY (ARRAY['ok'::"text", 'warning'::"text", 'critical'::"text", 'error'::"text"])))
);



--
-- Name: ops_check_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."ops_check_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "mode" "text" NOT NULL,
    "item_index" integer NOT NULL,
    "label" "text" NOT NULL,
    "is_done" boolean DEFAULT false NOT NULL,
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ops_check_state_mode_check" CHECK (("mode" = ANY (ARRAY['deploy'::"text", 'opening'::"text", 'closing'::"text", 'weekly'::"text"])))
);



--
-- Name: ops_client_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."ops_client_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid",
    "user_id" "uuid",
    "event_type" "text" NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "route" "text",
    "fingerprint" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ops_client_events_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'error'::"text", 'critical'::"text"])))
);



--
-- Name: ops_incidents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."ops_incidents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "severity" "text" DEFAULT 'P2'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "owner_name" "text",
    "affected_route" "text",
    "affected_ids" "text",
    "impact" "text",
    "containment" "text",
    "fix_reference" "text",
    "verification" "text",
    "follow_up" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ops_incidents_severity_check" CHECK (("severity" = ANY (ARRAY['P0'::"text", 'P1'::"text", 'P2'::"text", 'P3'::"text"]))),
    CONSTRAINT "ops_incidents_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'contained'::"text", 'resolved'::"text"])))
);



--
-- Name: ops_signals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."ops_signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "signal_key" "text" NOT NULL,
    "status" "text" DEFAULT 'green'::"text" NOT NULL,
    "note" "text",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_auto_checked_at" timestamp with time zone,
    CONSTRAINT "ops_signals_key_check" CHECK (("signal_key" = ANY (ARRAY['payments'::"text", 'bookings'::"text", 'memberships'::"text", 'checkin'::"text", 'devices'::"text", 'score'::"text", 'mail'::"text", 'deploy'::"text"]))),
    CONSTRAINT "ops_signals_status_check" CHECK (("status" = ANY (ARRAY['green'::"text", 'yellow'::"text", 'red'::"text"])))
);



--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."organization_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'ops'::"text", 'finance'::"text", 'support'::"text"])))
);



--
-- Name: organizations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "legal_name" "text",
    "org_number" "text",
    "default_currency" "text" DEFAULT 'SEK'::"text" NOT NULL,
    "default_country" "text" DEFAULT 'SE'::"text" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organizations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'archived'::"text"])))
);



--
-- Name: player_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."player_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "display_name" "text",
    "phone" "text",
    "avatar_url" "text",
    "pickla_rating" integer DEFAULT 1000,
    "total_matches" integer DEFAULT 0,
    "total_wins" integer DEFAULT 0,
    "bio" "text",
    "preferred_venue_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "stripe_customer_id" "text",
    "first_name" "text",
    "last_name" "text",
    "customer_id" "uuid"
);



--
-- Name: players; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."players" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "team_id" "uuid",
    "auth_user_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text",
    "is_captain" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: post_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."post_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "author_profile_id" "uuid" NOT NULL,
    "parent_comment_id" "uuid",
    "body" "text" NOT NULL,
    "upvote_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: post_votes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."post_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "vote_value" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: pricing_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."pricing_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'SEK'::"text",
    "description" "text",
    "is_active" boolean DEFAULT true,
    "valid_from" timestamp with time zone,
    "valid_to" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "days_of_week" integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[],
    "time_from" time without time zone DEFAULT '00:00:00'::time without time zone,
    "time_to" time without time zone DEFAULT '23:59:00'::time without time zone,
    "vat_rate" numeric DEFAULT 6,
    "sport_type" "text",
    "court_type" "text",
    CONSTRAINT "pricing_rules_type_check" CHECK (("type" = ANY (ARRAY['hourly'::"text", 'day_pass'::"text", 'membership'::"text", 'event_fee'::"text"])))
);



--
-- Name: COLUMN "pricing_rules"."days_of_week"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."pricing_rules"."days_of_week" IS 'Array of day numbers (0=Sunday, 1=Monday, ..., 6=Saturday)';


--
-- Name: COLUMN "pricing_rules"."time_from"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."pricing_rules"."time_from" IS 'Start of time window this price applies to';


--
-- Name: COLUMN "pricing_rules"."time_to"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."pricing_rules"."time_to" IS 'End of time window this price applies to';


--
-- Name: product_relationships; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."product_relationships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "source_product_id" "uuid" NOT NULL,
    "target_product_id" "uuid" NOT NULL,
    "relationship_type" "text" DEFAULT 'offered_with'::"text" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_relationships_distinct_products" CHECK (("source_product_id" <> "target_product_id")),
    CONSTRAINT "product_relationships_relationship_type_check" CHECK (("relationship_type" = 'offered_with'::"text"))
);



--
-- Name: pulse_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."pulse_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "venue_id" "uuid",
    "label" "text",
    "access_token_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "token_expires_at" timestamp with time zone,
    "created_by" "uuid",
    "revoked_at" timestamp with time zone,
    "revoked_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_viewed_at" timestamp with time zone,
    CONSTRAINT "pulse_tokens_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'revoked'::"text"])))
);



--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid",
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: score_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."score_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "score_session_id" "uuid" NOT NULL,
    "match_id" "uuid",
    "venue_court_id" "uuid",
    "event_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text",
    "priority" integer DEFAULT 1 NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: score_matches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."score_matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "score_session_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "event_id" "uuid",
    "venue_court_id" "uuid",
    "display_device_id" "uuid",
    "match_type" "text" DEFAULT 'walk_in'::"text" NOT NULL,
    "status" "text" DEFAULT 'in_progress'::"text" NOT NULL,
    "round_label" "text",
    "match_number" integer DEFAULT 1 NOT NULL,
    "player1_id" "uuid",
    "player2_id" "uuid",
    "player1_name" "text" NOT NULL,
    "player2_name" "text" NOT NULL,
    "game_type" "text" DEFAULT '501'::"text" NOT NULL,
    "best_of_legs" integer DEFAULT 1 NOT NULL,
    "current_leg" integer DEFAULT 1 NOT NULL,
    "player1_legs" integer DEFAULT 0 NOT NULL,
    "player2_legs" integer DEFAULT 0 NOT NULL,
    "player1_remaining" integer DEFAULT 501 NOT NULL,
    "player2_remaining" integer DEFAULT 501 NOT NULL,
    "current_player" integer DEFAULT 1 NOT NULL,
    "starting_player" integer DEFAULT 1 NOT NULL,
    "leg_starting_player" integer DEFAULT 1 NOT NULL,
    "winner_player_id" "uuid",
    "winner_name" "text",
    "last_score" integer,
    "last_event_type" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target_score" integer DEFAULT 501 NOT NULL,
    "checkout_rule" "text" DEFAULT 'double_out'::"text" NOT NULL,
    "in_rule" "text" DEFAULT 'straight_in'::"text" NOT NULL,
    "player_slots" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "score_matches_best_of_check" CHECK ((("best_of_legs" >= 1) AND ("best_of_legs" <= 15) AND (("best_of_legs" % 2) = 1))),
    CONSTRAINT "score_matches_checkout_rule_check" CHECK (("checkout_rule" = ANY (ARRAY['single_out'::"text", 'double_out'::"text"]))),
    CONSTRAINT "score_matches_current_player_check" CHECK ((("current_player" >= 1) AND ("current_player" <= 8))),
    CONSTRAINT "score_matches_game_check" CHECK (("game_type" = ANY (ARRAY['301'::"text", '501'::"text", '701'::"text", 'x01'::"text"]))),
    CONSTRAINT "score_matches_in_rule_check" CHECK (("in_rule" = ANY (ARRAY['straight_in'::"text", 'double_in'::"text"]))),
    CONSTRAINT "score_matches_leg_starting_player_check" CHECK ((("leg_starting_player" >= 1) AND ("leg_starting_player" <= 8))),
    CONSTRAINT "score_matches_starting_player_check" CHECK ((("starting_player" >= 1) AND ("starting_player" <= 8))),
    CONSTRAINT "score_matches_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "score_matches_target_score_check" CHECK ((("target_score" >= 101) AND ("target_score" <= 1001))),
    CONSTRAINT "score_matches_type_check" CHECK (("match_type" = ANY (ARRAY['walk_in'::"text", 'event'::"text"])))
);



--
-- Name: score_player_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."score_player_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setup_id" "text" NOT NULL,
    "display_device_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "slot_number" integer NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "avatar_url" "text",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '02:00:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "score_player_links_slot_number_check" CHECK ((("slot_number" >= 0) AND ("slot_number" <= 7)))
);



--
-- Name: score_players; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."score_players" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "score_session_id" "uuid" NOT NULL,
    "auth_user_id" "uuid",
    "display_name" "text" NOT NULL,
    "seed" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: score_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."score_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "event_id" "uuid",
    "session_type" "text" DEFAULT 'walk_in'::"text" NOT NULL,
    "sport_type" "text" DEFAULT 'dart'::"text" NOT NULL,
    "name" "text" DEFAULT 'Pickla Score'::"text" NOT NULL,
    "status" "text" DEFAULT 'live'::"text" NOT NULL,
    "game_type" "text" DEFAULT '501'::"text" NOT NULL,
    "best_of_legs" integer DEFAULT 1 NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_from_device_id" "uuid",
    "started_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "score_sessions_best_of_check" CHECK ((("best_of_legs" >= 1) AND ("best_of_legs" <= 15) AND (("best_of_legs" % 2) = 1))),
    CONSTRAINT "score_sessions_game_check" CHECK (("game_type" = ANY (ARRAY['301'::"text", '501'::"text", '701'::"text", 'x01'::"text"]))),
    CONSTRAINT "score_sessions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'live'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "score_sessions_type_check" CHECK (("session_type" = ANY (ARRAY['walk_in'::"text", 'event'::"text"])))
);



--
-- Name: score_turns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."score_turns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "score_session_id" "uuid" NOT NULL,
    "match_id" "uuid" NOT NULL,
    "venue_court_id" "uuid",
    "leg_number" integer NOT NULL,
    "player_number" integer NOT NULL,
    "player_id" "uuid",
    "score" integer NOT NULL,
    "remaining_before" integer NOT NULL,
    "remaining_after" integer NOT NULL,
    "is_bust" boolean DEFAULT false NOT NULL,
    "is_checkout" boolean DEFAULT false NOT NULL,
    "darts_used" integer DEFAULT 3 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "entered_score" integer DEFAULT 0,
    "in_opened" boolean DEFAULT false NOT NULL,
    CONSTRAINT "score_turns_entered_score_check" CHECK ((("entered_score" >= 0) AND ("entered_score" <= 180))),
    CONSTRAINT "score_turns_player_number_check" CHECK ((("player_number" >= 1) AND ("player_number" <= 8)))
);



--
-- Name: season_standings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."season_standings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "final_position" integer,
    "total_wins" integer DEFAULT 0,
    "total_matches" integer DEFAULT 0,
    "rating_change" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: seasons; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."seasons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "text" DEFAULT 'upcoming'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: session_registrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."session_registrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "activity_session_id" "uuid" NOT NULL,
    "session_date" "date" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "price_paid_sek" integer DEFAULT 0 NOT NULL,
    "stripe_session_id" "text",
    "source_type" "text",
    "source_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "registered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "customer_id" "uuid",
    CONSTRAINT "session_registrations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'cancelled'::"text", 'checked_in'::"text", 'no_show'::"text"])))
);



--
-- Name: standings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."standings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "wins" integer DEFAULT 0,
    "losses" integer DEFAULT 0,
    "draws" integer DEFAULT 0,
    "points" integer DEFAULT 0,
    "points_for" integer DEFAULT 0,
    "points_against" integer DEFAULT 0,
    "rank" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: stripe_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."stripe_events" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "status" "text" DEFAULT 'received'::"text" NOT NULL,
    "error" "text",
    CONSTRAINT "stripe_events_status_check" CHECK (("status" = ANY (ARRAY['received'::"text", 'processed'::"text", 'skipped'::"text", 'failed'::"text"])))
);



--
-- Name: teams; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#000000'::"text",
    "logo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: venue_checkins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."venue_checkins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "player_name" "text",
    "player_phone" "text",
    "entry_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "entitlement_id" "uuid",
    "checked_in_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "checked_out_at" timestamp with time zone,
    "checked_in_by" "uuid",
    "session_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "customer_id" "uuid"
);



--
-- Name: venue_courts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."venue_courts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "court_number" integer NOT NULL,
    "court_type" "text" DEFAULT 'indoor'::"text",
    "is_available" boolean DEFAULT true,
    "hourly_rate" numeric(10,2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "sport_type" "text" DEFAULT 'pickleball'::"text" NOT NULL
);



--
-- Name: venue_event_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."venue_event_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "category_key" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "logo_url" "text",
    "whatsapp_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: venue_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."venue_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "url" "text" NOT NULL,
    "icon" "text" DEFAULT 'link'::"text",
    "color" "text" DEFAULT 'primary'::"text",
    "member_count" "text",
    "sort_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



--
-- Name: venue_operation_overrides; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."venue_operation_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "reason" "text",
    "override_type" "text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "affects_entire_venue" boolean DEFAULT true NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "venue_operation_overrides_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "venue_operation_overrides_type_check" CHECK (("override_type" = ANY (ARRAY['closed'::"text", 'maintenance'::"text", 'private_event'::"text", 'staffing'::"text", 'other'::"text"]))),
    CONSTRAINT "venue_operation_overrides_valid_range" CHECK (("ends_at" > "starts_at"))
);



--
-- Name: venue_staff; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."venue_staff" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "venue_staff_role_check" CHECK (("role" = ANY (ARRAY['desk_staff'::"public"."app_role", 'venue_admin'::"public"."app_role"])))
);



--
-- Name: venues; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."venues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "address" "text",
    "city" "text",
    "postal_code" "text",
    "country" "text" DEFAULT 'SE'::"text",
    "phone" "text",
    "email" "text",
    "website_url" "text",
    "logo_url" "text",
    "cover_image_url" "text",
    "primary_color" "text" DEFAULT '#E86C24'::"text",
    "secondary_color" "text",
    "status" "public"."venue_status" DEFAULT 'active'::"public"."venue_status",
    "is_public" boolean DEFAULT true,
    "latitude" double precision,
    "longitude" double precision,
    "timezone" "text" DEFAULT 'Europe/Stockholm'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "event_plan_share_token" "text",
    "group_booking_title" "text",
    "group_booking_intro" "text",
    "group_booking_notes" "text",
    "group_booking_image_url" "text",
    "organization_id" "uuid",
    "franchisee_id" "uuid",
    "commerce_enabled" boolean DEFAULT false NOT NULL
);



--
-- Name: COLUMN "venues"."commerce_enabled"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."venues"."commerce_enabled" IS 'Platform-controlled Commerce kill switch for the venue. Ordinary product editing must not change it.';


--
-- Name: wellness_receipt_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."wellness_receipt_profiles" (
    "auth_user_id" "uuid" NOT NULL,
    "personal_identity_number" "text",
    "employer_note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: zettle_connections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."zettle_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "organization_uuid" "text",
    "zettle_user_uuid" "text",
    "oauth_state" "text",
    "oauth_state_expires_at" timestamp with time zone,
    "access_token" "text",
    "refresh_token" "text",
    "token_expires_at" timestamp with time zone,
    "scopes" "text"[] DEFAULT ARRAY['READ:PURCHASE'::"text"] NOT NULL,
    "last_import_started_at" timestamp with time zone,
    "last_import_finished_at" timestamp with time zone,
    "last_import_from" timestamp with time zone,
    "last_import_to" timestamp with time zone,
    "last_import_count" integer DEFAULT 0 NOT NULL,
    "last_import_error" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_successful_sync_at" timestamp with time zone,
    "last_failed_sync_at" timestamp with time zone,
    "last_sync_status" "text" DEFAULT 'NEVER_SYNCED'::"text" NOT NULL,
    CONSTRAINT "zettle_connections_last_sync_status_check" CHECK (("last_sync_status" = ANY (ARRAY['OK'::"text", 'FAILED'::"text", 'NEVER_SYNCED'::"text"])))
);



--
-- Name: zettle_purchases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."zettle_purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "connection_id" "uuid",
    "purchase_uuid" "text" NOT NULL,
    "purchase_number" "text",
    "occurred_at" timestamp with time zone NOT NULL,
    "amount_inc_vat_minor" integer DEFAULT 0 NOT NULL,
    "vat_amount_minor" integer DEFAULT 0 NOT NULL,
    "currency" "text",
    "payment_method" "text",
    "payment_status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



--
-- Name: access_entitlements access_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_entitlements"
    ADD CONSTRAINT "access_entitlements_pkey" PRIMARY KEY ("id");


--
-- Name: access_products access_products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_products"
    ADD CONSTRAINT "access_products_pkey" PRIMARY KEY ("id");


--
-- Name: access_products access_products_venue_id_product_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_products"
    ADD CONSTRAINT "access_products_venue_id_product_key_key" UNIQUE ("venue_id", "product_key");


--
-- Name: access_vouchers access_vouchers_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_vouchers"
    ADD CONSTRAINT "access_vouchers_code_key" UNIQUE ("code");


--
-- Name: access_vouchers access_vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_vouchers"
    ADD CONSTRAINT "access_vouchers_pkey" PRIMARY KEY ("id");


--
-- Name: activity_series activity_series_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_series"
    ADD CONSTRAINT "activity_series_pkey" PRIMARY KEY ("id");


--
-- Name: activity_session_hosts activity_session_hosts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_hosts"
    ADD CONSTRAINT "activity_session_hosts_pkey" PRIMARY KEY ("id");


--
-- Name: activity_session_hosts activity_session_hosts_venue_id_activity_session_id_custome_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_hosts"
    ADD CONSTRAINT "activity_session_hosts_venue_id_activity_session_id_custome_key" UNIQUE ("venue_id", "activity_session_id", "customer_id");


--
-- Name: activity_session_interests activity_session_interests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_interests"
    ADD CONSTRAINT "activity_session_interests_pkey" PRIMARY KEY ("id");


--
-- Name: activity_session_overrides activity_session_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_overrides"
    ADD CONSTRAINT "activity_session_overrides_pkey" PRIMARY KEY ("id");


--
-- Name: activity_session_overrides activity_session_overrides_venue_id_activity_session_id_ses_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_overrides"
    ADD CONSTRAINT "activity_session_overrides_venue_id_activity_session_id_ses_key" UNIQUE ("venue_id", "activity_session_id", "session_date");


--
-- Name: activity_sessions activity_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_sessions"
    ADD CONSTRAINT "activity_sessions_pkey" PRIMARY KEY ("id");


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");


--
-- Name: booking_participant_invites booking_participant_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participant_invites"
    ADD CONSTRAINT "booking_participant_invites_pkey" PRIMARY KEY ("id");


--
-- Name: booking_participant_invites booking_participant_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participant_invites"
    ADD CONSTRAINT "booking_participant_invites_token_key" UNIQUE ("token");


--
-- Name: booking_participants booking_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participants"
    ADD CONSTRAINT "booking_participants_pkey" PRIMARY KEY ("id");


--
-- Name: booking_receipts booking_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_pkey" PRIMARY KEY ("id");


--
-- Name: booking_receipts booking_receipts_receipt_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_receipt_number_key" UNIQUE ("receipt_number");


--
-- Name: booking_receipts booking_receipts_stripe_session_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_stripe_session_id_key" UNIQUE ("stripe_session_id");


--
-- Name: bookings bookings_booking_ref_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_booking_ref_key" UNIQUE ("booking_ref");


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");


--
-- Name: capacity_holds capacity_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."capacity_holds"
    ADD CONSTRAINT "capacity_holds_pkey" PRIMARY KEY ("id");


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");


--
-- Name: chat_participants chat_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_participants"
    ADD CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("id");


--
-- Name: chat_participants chat_participants_room_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_participants"
    ADD CONSTRAINT "chat_participants_room_id_user_id_key" UNIQUE ("room_id", "user_id");


--
-- Name: chat_reactions chat_reactions_message_id_user_id_emoji_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_reactions"
    ADD CONSTRAINT "chat_reactions_message_id_user_id_emoji_key" UNIQUE ("message_id", "user_id", "emoji");


--
-- Name: chat_reactions chat_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_reactions"
    ADD CONSTRAINT "chat_reactions_pkey" PRIMARY KEY ("id");


--
-- Name: chat_rooms chat_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_rooms"
    ADD CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id");


--
-- Name: comment_votes comment_votes_comment_id_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."comment_votes"
    ADD CONSTRAINT "comment_votes_comment_id_auth_user_id_key" UNIQUE ("comment_id", "auth_user_id");


--
-- Name: comment_votes comment_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."comment_votes"
    ADD CONSTRAINT "comment_votes_pkey" PRIMARY KEY ("id");


--
-- Name: commerce_order_lines commerce_order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_order_lines"
    ADD CONSTRAINT "commerce_order_lines_pkey" PRIMARY KEY ("id");


--
-- Name: commerce_orders commerce_orders_guest_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_orders"
    ADD CONSTRAINT "commerce_orders_guest_token_hash_key" UNIQUE ("guest_token_hash");


--
-- Name: commerce_orders commerce_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_orders"
    ADD CONSTRAINT "commerce_orders_pkey" PRIMARY KEY ("id");


--
-- Name: commerce_orders commerce_orders_receipt_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_orders"
    ADD CONSTRAINT "commerce_orders_receipt_token_hash_key" UNIQUE ("receipt_token_hash");


--
-- Name: commerce_orders commerce_orders_stripe_session_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_orders"
    ADD CONSTRAINT "commerce_orders_stripe_session_id_key" UNIQUE ("stripe_session_id");


--
-- Name: commerce_receipt_lines commerce_receipt_lines_commerce_order_line_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_receipt_lines"
    ADD CONSTRAINT "commerce_receipt_lines_commerce_order_line_id_key" UNIQUE ("commerce_order_line_id");


--
-- Name: commerce_receipt_lines commerce_receipt_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_receipt_lines"
    ADD CONSTRAINT "commerce_receipt_lines_pkey" PRIMARY KEY ("id");


--
-- Name: community_feed community_feed_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."community_feed"
    ADD CONSTRAINT "community_feed_pkey" PRIMARY KEY ("id");


--
-- Name: community_stories community_stories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."community_stories"
    ADD CONSTRAINT "community_stories_pkey" PRIMARY KEY ("id");


--
-- Name: corporate_accounts corporate_accounts_invite_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_accounts"
    ADD CONSTRAINT "corporate_accounts_invite_token_key" UNIQUE ("invite_token");


--
-- Name: corporate_accounts corporate_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_accounts"
    ADD CONSTRAINT "corporate_accounts_pkey" PRIMARY KEY ("id");


--
-- Name: corporate_members corporate_members_corporate_account_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_members"
    ADD CONSTRAINT "corporate_members_corporate_account_id_user_id_key" UNIQUE ("corporate_account_id", "user_id");


--
-- Name: corporate_members corporate_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_members"
    ADD CONSTRAINT "corporate_members_pkey" PRIMARY KEY ("id");


--
-- Name: corporate_order_items corporate_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_order_items"
    ADD CONSTRAINT "corporate_order_items_pkey" PRIMARY KEY ("id");


--
-- Name: corporate_orders corporate_orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_orders"
    ADD CONSTRAINT "corporate_orders_order_number_key" UNIQUE ("order_number");


--
-- Name: corporate_orders corporate_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_orders"
    ADD CONSTRAINT "corporate_orders_pkey" PRIMARY KEY ("id");


--
-- Name: corporate_packages corporate_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_packages"
    ADD CONSTRAINT "corporate_packages_pkey" PRIMARY KEY ("id");


--
-- Name: courts courts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."courts"
    ADD CONSTRAINT "courts_pkey" PRIMARY KEY ("id");


--
-- Name: crew_challenges crew_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_challenges"
    ADD CONSTRAINT "crew_challenges_pkey" PRIMARY KEY ("id");


--
-- Name: crew_members crew_members_crew_id_player_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_members"
    ADD CONSTRAINT "crew_members_crew_id_player_profile_id_key" UNIQUE ("crew_id", "player_profile_id");


--
-- Name: crew_members crew_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_members"
    ADD CONSTRAINT "crew_members_pkey" PRIMARY KEY ("id");


--
-- Name: crew_session_signups crew_session_signups_crew_session_id_player_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_session_signups"
    ADD CONSTRAINT "crew_session_signups_crew_session_id_player_profile_id_key" UNIQUE ("crew_session_id", "player_profile_id");


--
-- Name: crew_session_signups crew_session_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_session_signups"
    ADD CONSTRAINT "crew_session_signups_pkey" PRIMARY KEY ("id");


--
-- Name: crew_sessions crew_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_sessions"
    ADD CONSTRAINT "crew_sessions_pkey" PRIMARY KEY ("id");


--
-- Name: crews crews_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crews"
    ADD CONSTRAINT "crews_name_key" UNIQUE ("name");


--
-- Name: crews crews_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crews"
    ADD CONSTRAINT "crews_pkey" PRIMARY KEY ("id");


--
-- Name: customer_identities customer_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customer_identities"
    ADD CONSTRAINT "customer_identities_pkey" PRIMARY KEY ("id");


--
-- Name: customer_venue_profiles customer_venue_profiles_customer_id_venue_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customer_venue_profiles"
    ADD CONSTRAINT "customer_venue_profiles_customer_id_venue_id_key" UNIQUE ("customer_id", "venue_id");


--
-- Name: customer_venue_profiles customer_venue_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customer_venue_profiles"
    ADD CONSTRAINT "customer_venue_profiles_pkey" PRIMARY KEY ("id");


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");


--
-- Name: day_pass_grants day_pass_grants_membership_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_pass_grants"
    ADD CONSTRAINT "day_pass_grants_membership_id_month_year_key" UNIQUE ("membership_id", "month_year");


--
-- Name: day_pass_grants day_pass_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_pass_grants"
    ADD CONSTRAINT "day_pass_grants_pkey" PRIMARY KEY ("id");


--
-- Name: day_pass_shares day_pass_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_pass_shares"
    ADD CONSTRAINT "day_pass_shares_pkey" PRIMARY KEY ("id");


--
-- Name: day_pass_shares day_pass_shares_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_pass_shares"
    ADD CONSTRAINT "day_pass_shares_token_key" UNIQUE ("token");


--
-- Name: day_passes day_passes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_passes"
    ADD CONSTRAINT "day_passes_pkey" PRIMARY KEY ("id");


--
-- Name: display_devices display_devices_device_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."display_devices"
    ADD CONSTRAINT "display_devices_device_token_key" UNIQUE ("device_token");


--
-- Name: display_devices display_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."display_devices"
    ADD CONSTRAINT "display_devices_pkey" PRIMARY KEY ("id");


--
-- Name: event_checkins event_checkins_event_id_player_id_session_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_checkins"
    ADD CONSTRAINT "event_checkins_event_id_player_id_session_date_key" UNIQUE ("event_id", "player_id", "session_date");


--
-- Name: event_checkins event_checkins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_checkins"
    ADD CONSTRAINT "event_checkins_pkey" PRIMARY KEY ("id");


--
-- Name: event_communications event_communications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_communications"
    ADD CONSTRAINT "event_communications_pkey" PRIMARY KEY ("id");


--
-- Name: event_courts event_courts_event_id_venue_court_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_courts"
    ADD CONSTRAINT "event_courts_event_id_venue_court_id_key" UNIQUE ("event_id", "venue_court_id");


--
-- Name: event_courts event_courts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_courts"
    ADD CONSTRAINT "event_courts_pkey" PRIMARY KEY ("id");


--
-- Name: event_followups event_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_followups"
    ADD CONSTRAINT "event_followups_pkey" PRIMARY KEY ("id");


--
-- Name: event_lead_activities event_lead_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_lead_activities"
    ADD CONSTRAINT "event_lead_activities_pkey" PRIMARY KEY ("id");


--
-- Name: event_leads event_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_leads"
    ADD CONSTRAINT "event_leads_pkey" PRIMARY KEY ("id");


--
-- Name: event_likes event_likes_event_id_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_likes"
    ADD CONSTRAINT "event_likes_event_id_auth_user_id_key" UNIQUE ("event_id", "auth_user_id");


--
-- Name: event_likes event_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_likes"
    ADD CONSTRAINT "event_likes_pkey" PRIMARY KEY ("id");


--
-- Name: event_offer_items event_offer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offer_items"
    ADD CONSTRAINT "event_offer_items_pkey" PRIMARY KEY ("id");


--
-- Name: event_offer_templates event_offer_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offer_templates"
    ADD CONSTRAINT "event_offer_templates_pkey" PRIMARY KEY ("id");


--
-- Name: event_offer_templates event_offer_templates_venue_id_template_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offer_templates"
    ADD CONSTRAINT "event_offer_templates_venue_id_template_key_key" UNIQUE ("venue_id", "template_key");


--
-- Name: event_offers event_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offers"
    ADD CONSTRAINT "event_offers_pkey" PRIMARY KEY ("id");


--
-- Name: event_resource_allocations event_resource_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_allocations"
    ADD CONSTRAINT "event_resource_allocations_pkey" PRIMARY KEY ("id");


--
-- Name: event_resource_blocks event_resource_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_blocks"
    ADD CONSTRAINT "event_resource_blocks_pkey" PRIMARY KEY ("id");


--
-- Name: event_resource_catalog event_resource_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_catalog"
    ADD CONSTRAINT "event_resource_catalog_pkey" PRIMARY KEY ("id");


--
-- Name: event_resource_catalog event_resource_catalog_venue_id_resource_type_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_catalog"
    ADD CONSTRAINT "event_resource_catalog_venue_id_resource_type_name_key" UNIQUE ("venue_id", "resource_type", "name");


--
-- Name: event_templates event_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_templates"
    ADD CONSTRAINT "event_templates_pkey" PRIMARY KEY ("id");


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");


--
-- Name: feed_likes feed_likes_feed_item_id_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feed_likes"
    ADD CONSTRAINT "feed_likes_feed_item_id_auth_user_id_key" UNIQUE ("feed_item_id", "auth_user_id");


--
-- Name: feed_likes feed_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feed_likes"
    ADD CONSTRAINT "feed_likes_pkey" PRIMARY KEY ("id");


--
-- Name: forum_poll_options forum_poll_options_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_poll_options"
    ADD CONSTRAINT "forum_poll_options_pkey" PRIMARY KEY ("id");


--
-- Name: forum_poll_votes forum_poll_votes_option_id_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_poll_votes"
    ADD CONSTRAINT "forum_poll_votes_option_id_auth_user_id_key" UNIQUE ("option_id", "auth_user_id");


--
-- Name: forum_poll_votes forum_poll_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_poll_votes"
    ADD CONSTRAINT "forum_poll_votes_pkey" PRIMARY KEY ("id");


--
-- Name: forum_post_signups forum_post_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_post_signups"
    ADD CONSTRAINT "forum_post_signups_pkey" PRIMARY KEY ("id");


--
-- Name: forum_post_signups forum_post_signups_post_id_player_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_post_signups"
    ADD CONSTRAINT "forum_post_signups_post_id_player_profile_id_key" UNIQUE ("post_id", "player_profile_id");


--
-- Name: forum_posts forum_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_posts"
    ADD CONSTRAINT "forum_posts_pkey" PRIMARY KEY ("id");


--
-- Name: franchisees franchisees_organization_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."franchisees"
    ADD CONSTRAINT "franchisees_organization_id_slug_key" UNIQUE ("organization_id", "slug");


--
-- Name: franchisees franchisees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."franchisees"
    ADD CONSTRAINT "franchisees_pkey" PRIMARY KEY ("id");


--
-- Name: investor_assets investor_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."investor_assets"
    ADD CONSTRAINT "investor_assets_pkey" PRIMARY KEY ("id");


--
-- Name: investor_leads investor_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."investor_leads"
    ADD CONSTRAINT "investor_leads_pkey" PRIMARY KEY ("id");


--
-- Name: investor_settings investor_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."investor_settings"
    ADD CONSTRAINT "investor_settings_pkey" PRIMARY KEY ("id");


--
-- Name: ladder_challenges ladder_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_challenges"
    ADD CONSTRAINT "ladder_challenges_pkey" PRIMARY KEY ("id");


--
-- Name: ladder_entries ladder_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_entries"
    ADD CONSTRAINT "ladder_entries_pkey" PRIMARY KEY ("id");


--
-- Name: ladder_matches ladder_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_matches"
    ADD CONSTRAINT "ladder_matches_pkey" PRIMARY KEY ("id");


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id");


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_pkey" PRIMARY KEY ("id");


--
-- Name: membership_entitlements membership_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_entitlements"
    ADD CONSTRAINT "membership_entitlements_pkey" PRIMARY KEY ("id");


--
-- Name: membership_tier_pricing membership_tier_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_tier_pricing"
    ADD CONSTRAINT "membership_tier_pricing_pkey" PRIMARY KEY ("id");


--
-- Name: membership_tier_pricing membership_tier_pricing_tier_id_product_type_pricing_rule_i_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_tier_pricing"
    ADD CONSTRAINT "membership_tier_pricing_tier_id_product_type_pricing_rule_i_key" UNIQUE ("tier_id", "product_type", "pricing_rule_id");


--
-- Name: membership_tiers membership_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_tiers"
    ADD CONSTRAINT "membership_tiers_pkey" PRIMARY KEY ("id");


--
-- Name: membership_tiers membership_tiers_venue_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_tiers"
    ADD CONSTRAINT "membership_tiers_venue_id_name_key" UNIQUE ("venue_id", "name");


--
-- Name: membership_usage membership_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_usage"
    ADD CONSTRAINT "membership_usage_pkey" PRIMARY KEY ("id");


--
-- Name: membership_usage membership_usage_user_id_venue_id_entitlement_type_period_s_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_usage"
    ADD CONSTRAINT "membership_usage_user_id_venue_id_entitlement_type_period_s_key" UNIQUE ("user_id", "venue_id", "entitlement_type", "period_start");


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_pkey" PRIMARY KEY ("id");


--
-- Name: memberships memberships_user_id_venue_id_tier_id_starts_at_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_user_id_venue_id_tier_id_starts_at_key" UNIQUE ("user_id", "venue_id", "tier_id", "starts_at");


--
-- Name: open_play_sessions open_play_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."open_play_sessions"
    ADD CONSTRAINT "open_play_sessions_pkey" PRIMARY KEY ("id");


--
-- Name: opening_hours opening_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."opening_hours"
    ADD CONSTRAINT "opening_hours_pkey" PRIMARY KEY ("id");


--
-- Name: opening_hours opening_hours_venue_id_day_of_week_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."opening_hours"
    ADD CONSTRAINT "opening_hours_venue_id_day_of_week_key" UNIQUE ("venue_id", "day_of_week");


--
-- Name: operations_integration_health operations_integration_health_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."operations_integration_health"
    ADD CONSTRAINT "operations_integration_health_pkey" PRIMARY KEY ("id");


--
-- Name: ops_agent_runs ops_agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_agent_runs"
    ADD CONSTRAINT "ops_agent_runs_pkey" PRIMARY KEY ("id");


--
-- Name: ops_check_state ops_check_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_check_state"
    ADD CONSTRAINT "ops_check_state_pkey" PRIMARY KEY ("id");


--
-- Name: ops_check_state ops_check_state_unique_item; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_check_state"
    ADD CONSTRAINT "ops_check_state_unique_item" UNIQUE ("venue_id", "mode", "item_index");


--
-- Name: ops_client_events ops_client_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_client_events"
    ADD CONSTRAINT "ops_client_events_pkey" PRIMARY KEY ("id");


--
-- Name: ops_incidents ops_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_incidents"
    ADD CONSTRAINT "ops_incidents_pkey" PRIMARY KEY ("id");


--
-- Name: ops_signals ops_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_signals"
    ADD CONSTRAINT "ops_signals_pkey" PRIMARY KEY ("id");


--
-- Name: ops_signals ops_signals_unique_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_signals"
    ADD CONSTRAINT "ops_signals_unique_key" UNIQUE ("venue_id", "signal_key");


--
-- Name: organization_members organization_members_organization_id_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_user_id_role_key" UNIQUE ("organization_id", "user_id", "role");


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id");


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");


--
-- Name: player_profiles player_profiles_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."player_profiles"
    ADD CONSTRAINT "player_profiles_auth_user_id_key" UNIQUE ("auth_user_id");


--
-- Name: player_profiles player_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."player_profiles"
    ADD CONSTRAINT "player_profiles_pkey" PRIMARY KEY ("id");


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");


--
-- Name: post_comments post_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id");


--
-- Name: post_votes post_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."post_votes"
    ADD CONSTRAINT "post_votes_pkey" PRIMARY KEY ("id");


--
-- Name: post_votes post_votes_post_id_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."post_votes"
    ADD CONSTRAINT "post_votes_post_id_auth_user_id_key" UNIQUE ("post_id", "auth_user_id");


--
-- Name: pricing_rules pricing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."pricing_rules"
    ADD CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id");


--
-- Name: product_relationships product_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."product_relationships"
    ADD CONSTRAINT "product_relationships_pkey" PRIMARY KEY ("id");


--
-- Name: product_relationships product_relationships_venue_id_source_product_id_target_pro_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."product_relationships"
    ADD CONSTRAINT "product_relationships_venue_id_source_product_id_target_pro_key" UNIQUE ("venue_id", "source_product_id", "target_product_id", "relationship_type");


--
-- Name: pulse_tokens pulse_tokens_access_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."pulse_tokens"
    ADD CONSTRAINT "pulse_tokens_access_token_hash_key" UNIQUE ("access_token_hash");


--
-- Name: pulse_tokens pulse_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."pulse_tokens"
    ADD CONSTRAINT "pulse_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");


--
-- Name: push_subscriptions push_subscriptions_user_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_endpoint_key" UNIQUE ("user_id", "endpoint");


--
-- Name: score_events score_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_events"
    ADD CONSTRAINT "score_events_pkey" PRIMARY KEY ("id");


--
-- Name: score_matches score_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_matches"
    ADD CONSTRAINT "score_matches_pkey" PRIMARY KEY ("id");


--
-- Name: score_player_links score_player_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_player_links"
    ADD CONSTRAINT "score_player_links_pkey" PRIMARY KEY ("id");


--
-- Name: score_player_links score_player_links_setup_id_display_device_id_slot_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_player_links"
    ADD CONSTRAINT "score_player_links_setup_id_display_device_id_slot_number_key" UNIQUE ("setup_id", "display_device_id", "slot_number");


--
-- Name: score_players score_players_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_players"
    ADD CONSTRAINT "score_players_pkey" PRIMARY KEY ("id");


--
-- Name: score_sessions score_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_sessions"
    ADD CONSTRAINT "score_sessions_pkey" PRIMARY KEY ("id");


--
-- Name: score_turns score_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_turns"
    ADD CONSTRAINT "score_turns_pkey" PRIMARY KEY ("id");


--
-- Name: season_standings season_standings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."season_standings"
    ADD CONSTRAINT "season_standings_pkey" PRIMARY KEY ("id");


--
-- Name: seasons seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."seasons"
    ADD CONSTRAINT "seasons_pkey" PRIMARY KEY ("id");


--
-- Name: session_registrations session_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."session_registrations"
    ADD CONSTRAINT "session_registrations_pkey" PRIMARY KEY ("id");


--
-- Name: standings standings_event_id_team_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."standings"
    ADD CONSTRAINT "standings_event_id_team_id_key" UNIQUE ("event_id", "team_id");


--
-- Name: standings standings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."standings"
    ADD CONSTRAINT "standings_pkey" PRIMARY KEY ("id");


--
-- Name: stripe_events stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."stripe_events"
    ADD CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id");


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE ("user_id", "role");


--
-- Name: venue_checkins venue_checkins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_checkins"
    ADD CONSTRAINT "venue_checkins_pkey" PRIMARY KEY ("id");


--
-- Name: venue_courts venue_courts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_courts"
    ADD CONSTRAINT "venue_courts_pkey" PRIMARY KEY ("id");


--
-- Name: venue_courts venue_courts_venue_id_sport_court_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_courts"
    ADD CONSTRAINT "venue_courts_venue_id_sport_court_number_key" UNIQUE ("venue_id", "sport_type", "court_number");


--
-- Name: venue_event_categories venue_event_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_event_categories"
    ADD CONSTRAINT "venue_event_categories_pkey" PRIMARY KEY ("id");


--
-- Name: venue_event_categories venue_event_categories_venue_id_category_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_event_categories"
    ADD CONSTRAINT "venue_event_categories_venue_id_category_key_key" UNIQUE ("venue_id", "category_key");


--
-- Name: venue_links venue_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_links"
    ADD CONSTRAINT "venue_links_pkey" PRIMARY KEY ("id");


--
-- Name: venue_operation_overrides venue_operation_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_operation_overrides"
    ADD CONSTRAINT "venue_operation_overrides_pkey" PRIMARY KEY ("id");


--
-- Name: venue_staff venue_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_staff"
    ADD CONSTRAINT "venue_staff_pkey" PRIMARY KEY ("id");


--
-- Name: venue_staff venue_staff_user_id_venue_id_role_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_staff"
    ADD CONSTRAINT "venue_staff_user_id_venue_id_role_key" UNIQUE ("user_id", "venue_id", "role");


--
-- Name: venues venues_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_pkey" PRIMARY KEY ("id");


--
-- Name: venues venues_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_slug_key" UNIQUE ("slug");


--
-- Name: wellness_receipt_profiles wellness_receipt_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."wellness_receipt_profiles"
    ADD CONSTRAINT "wellness_receipt_profiles_pkey" PRIMARY KEY ("auth_user_id");


--
-- Name: zettle_connections zettle_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."zettle_connections"
    ADD CONSTRAINT "zettle_connections_pkey" PRIMARY KEY ("id");


--
-- Name: zettle_connections zettle_connections_venue_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."zettle_connections"
    ADD CONSTRAINT "zettle_connections_venue_id_key" UNIQUE ("venue_id");


--
-- Name: zettle_purchases zettle_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."zettle_purchases"
    ADD CONSTRAINT "zettle_purchases_pkey" PRIMARY KEY ("id");


--
-- Name: zettle_purchases zettle_purchases_venue_id_purchase_uuid_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."zettle_purchases"
    ADD CONSTRAINT "zettle_purchases_venue_id_purchase_uuid_key" UNIQUE ("venue_id", "purchase_uuid");


--
-- Name: idx_access_entitlements_one_founder_guest_per_user_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_access_entitlements_one_founder_guest_per_user_venue" ON "public"."access_entitlements" USING "btree" ("venue_id", "user_id") WHERE (("source_type" = 'founder_guest_voucher'::"text") AND ("entitlement_type" = 'day_access'::"text"));


--
-- Name: idx_access_entitlements_source_once; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_access_entitlements_source_once" ON "public"."access_entitlements" USING "btree" ("source_type", "source_id", "user_id", "entitlement_type");


--
-- Name: idx_access_entitlements_user_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_access_entitlements_user_active" ON "public"."access_entitlements" USING "btree" ("venue_id", "user_id", "status");


--
-- Name: idx_access_entitlements_valid_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_access_entitlements_valid_date" ON "public"."access_entitlements" USING "btree" ("venue_id", "valid_date", "entitlement_type") WHERE ("status" = 'active'::"text");


--
-- Name: idx_access_products_catalog; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_access_products_catalog" ON "public"."access_products" USING "btree" ("venue_id", "status", "standalone_enabled", "activity_addon_enabled", "sort_order");


--
-- Name: idx_access_products_venue_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_access_products_venue_active" ON "public"."access_products" USING "btree" ("venue_id", "is_active", "sort_order");


--
-- Name: idx_access_vouchers_claimed_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_access_vouchers_claimed_by" ON "public"."access_vouchers" USING "btree" ("claimed_by_user_id", "status");


--
-- Name: idx_access_vouchers_membership_month_slot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_access_vouchers_membership_month_slot" ON "public"."access_vouchers" USING "btree" ("source_id", (("metadata" ->> 'period_start'::"text")), (("metadata" ->> 'slot'::"text"))) WHERE ("source_type" = 'membership_guest_voucher'::"text");


--
-- Name: idx_access_vouchers_purchaser; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_access_vouchers_purchaser" ON "public"."access_vouchers" USING "btree" ("purchaser_user_id", "status");


--
-- Name: idx_activity_series_seed_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_activity_series_seed_key" ON "public"."activity_series" USING "btree" ("venue_id", (("metadata" ->> 'seed_key'::"text"))) WHERE ("metadata" ? 'seed_key'::"text");


--
-- Name: idx_activity_series_venue_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_series_venue_status" ON "public"."activity_series" USING "btree" ("venue_id", "status", "series_type");


--
-- Name: idx_activity_session_hosts_customer_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_session_hosts_customer_active" ON "public"."activity_session_hosts" USING "btree" ("customer_id", "activity_session_id") WHERE ("status" = 'active'::"text");


--
-- Name: idx_activity_session_hosts_role_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_session_hosts_role_active" ON "public"."activity_session_hosts" USING "btree" ("role", "activity_session_id", "sort_order") WHERE ("status" = 'active'::"text");


--
-- Name: idx_activity_session_hosts_session_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_session_hosts_session_active" ON "public"."activity_session_hosts" USING "btree" ("activity_session_id", "sort_order") WHERE ("status" = 'active'::"text");


--
-- Name: idx_activity_session_hosts_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_session_hosts_venue" ON "public"."activity_session_hosts" USING "btree" ("venue_id");


--
-- Name: idx_activity_session_interests_session_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_session_interests_session_date" ON "public"."activity_session_interests" USING "btree" ("activity_session_id", "session_date", "status");


--
-- Name: idx_activity_session_interests_venue_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_session_interests_venue_created" ON "public"."activity_session_interests" USING "btree" ("venue_id", "created_at" DESC);


--
-- Name: idx_activity_session_overrides_operation; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_session_overrides_operation" ON "public"."activity_session_overrides" USING "btree" ("venue_operation_override_id") WHERE ("venue_operation_override_id" IS NOT NULL);


--
-- Name: idx_activity_session_overrides_venue_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_session_overrides_venue_date" ON "public"."activity_session_overrides" USING "btree" ("venue_id", "session_date", "status");


--
-- Name: idx_activity_sessions_early_bird; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_sessions_early_bird" ON "public"."activity_sessions" USING "btree" ("venue_id", "early_bird_slots") WHERE (("early_bird_price_minor" IS NOT NULL) AND ("early_bird_slots" IS NOT NULL));


--
-- Name: idx_activity_sessions_product_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_sessions_product_key" ON "public"."activity_sessions" USING "btree" ("venue_id", "product_key");


--
-- Name: idx_activity_sessions_series; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_sessions_series" ON "public"."activity_sessions" USING "btree" ("series_id");


--
-- Name: idx_activity_sessions_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_sessions_type" ON "public"."activity_sessions" USING "btree" ("venue_id", "session_type", "sport_type");


--
-- Name: idx_activity_sessions_venue_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_activity_sessions_venue_active" ON "public"."activity_sessions" USING "btree" ("venue_id", "is_active");


--
-- Name: idx_audit_log_actor_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_actor_created" ON "public"."audit_log" USING "btree" ("actor_user_id", "created_at" DESC);


--
-- Name: idx_audit_log_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_entity" ON "public"."audit_log" USING "btree" ("entity_table", "entity_id");


--
-- Name: idx_audit_log_organization_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_organization_created" ON "public"."audit_log" USING "btree" ("organization_id", "created_at" DESC);


--
-- Name: idx_audit_log_venue_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_venue_created" ON "public"."audit_log" USING "btree" ("venue_id", "created_at" DESC);


--
-- Name: idx_booking_participant_invites_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_booking_participant_invites_group" ON "public"."booking_participant_invites" USING "btree" ("venue_id", "booking_group_key", "status");


--
-- Name: idx_booking_participants_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_booking_participants_customer" ON "public"."booking_participants" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);


--
-- Name: idx_booking_participants_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_booking_participants_group" ON "public"."booking_participants" USING "btree" ("venue_id", "booking_group_key", "created_at");


--
-- Name: idx_booking_participants_group_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_booking_participants_group_user" ON "public"."booking_participants" USING "btree" ("booking_group_key", "user_id") WHERE (("user_id" IS NOT NULL) AND ("payment_status" <> 'cancelled'::"text"));


--
-- Name: idx_booking_participants_stripe_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_booking_participants_stripe_session" ON "public"."booking_participants" USING "btree" ("payment_stripe_session_id") WHERE ("payment_stripe_session_id" IS NOT NULL);


--
-- Name: idx_booking_participants_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_booking_participants_user" ON "public"."booking_participants" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);


--
-- Name: idx_booking_receipts_booking_refs; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_booking_receipts_booking_refs" ON "public"."booking_receipts" USING "gin" ("booking_refs");


--
-- Name: idx_booking_receipts_commerce_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_booking_receipts_commerce_order" ON "public"."booking_receipts" USING "btree" ("commerce_order_id") WHERE ("commerce_order_id" IS NOT NULL);


--
-- Name: idx_booking_receipts_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_booking_receipts_customer_id" ON "public"."booking_receipts" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);


--
-- Name: idx_booking_receipts_host_comp_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_booking_receipts_host_comp_source" ON "public"."booking_receipts" USING "btree" ((("metadata" ->> 'source_type'::"text")), (("metadata" ->> 'source_id'::"text"))) WHERE (("metadata" ->> 'source_type'::"text") = 'host_comp'::"text");


--
-- Name: idx_booking_receipts_purchase_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_booking_receipts_purchase_type" ON "public"."booking_receipts" USING "btree" ("purchase_type");


--
-- Name: idx_booking_receipts_stripe_invoice; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_booking_receipts_stripe_invoice" ON "public"."booking_receipts" USING "btree" ("stripe_invoice_id") WHERE ("stripe_invoice_id" IS NOT NULL);


--
-- Name: idx_booking_receipts_stripe_subscription; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_booking_receipts_stripe_subscription" ON "public"."booking_receipts" USING "btree" ("stripe_subscription_id") WHERE ("stripe_subscription_id" IS NOT NULL);


--
-- Name: idx_booking_receipts_user_issued; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_booking_receipts_user_issued" ON "public"."booking_receipts" USING "btree" ("user_id", "issued_at" DESC);


--
-- Name: idx_booking_receipts_venue_issued; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_booking_receipts_venue_issued" ON "public"."booking_receipts" USING "btree" ("venue_id", "issued_at" DESC);


--
-- Name: idx_bookings_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_bookings_customer_id" ON "public"."bookings" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);


--
-- Name: idx_bookings_membership_usage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_bookings_membership_usage" ON "public"."bookings" USING "btree" ("membership_id", "membership_usage_entitlement_type", "membership_usage_period_start") WHERE ("membership_id" IS NOT NULL);


--
-- Name: idx_bookings_open_for_more; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_bookings_open_for_more" ON "public"."bookings" USING "btree" ("venue_id", "start_time") WHERE ("open_for_more_status" = 'open'::"text");


--
-- Name: idx_bookings_stripe_session_court; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_bookings_stripe_session_court" ON "public"."bookings" USING "btree" ("stripe_session_id", "venue_court_id") WHERE ("stripe_session_id" IS NOT NULL);


--
-- Name: idx_bookings_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_bookings_time" ON "public"."bookings" USING "btree" ("start_time", "end_time");


--
-- Name: idx_bookings_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_bookings_user" ON "public"."bookings" USING "btree" ("user_id");


--
-- Name: idx_bookings_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_bookings_venue" ON "public"."bookings" USING "btree" ("venue_id");


--
-- Name: idx_bookings_venue_access_code_day_court; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_bookings_venue_access_code_day_court" ON "public"."bookings" USING "btree" ("venue_id", "access_code", "date"(("start_time" AT TIME ZONE 'UTC'::"text")), "venue_court_id") WHERE ("access_code" IS NOT NULL);


--
-- Name: idx_capacity_holds_active_idempotency; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_capacity_holds_active_idempotency" ON "public"."capacity_holds" USING "btree" ("venue_id", "idempotency_key") WHERE (("idempotency_key" IS NOT NULL) AND ("status" = 'active'::"text"));


--
-- Name: idx_capacity_holds_scope; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_capacity_holds_scope" ON "public"."capacity_holds" USING "btree" ("venue_id", "scope_type", "scope_id", "session_date", "status", "expires_at");


--
-- Name: idx_capacity_holds_stripe_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_capacity_holds_stripe_session" ON "public"."capacity_holds" USING "btree" ("stripe_session_id") WHERE ("stripe_session_id" IS NOT NULL);


--
-- Name: idx_capacity_holds_user_scope; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_capacity_holds_user_scope" ON "public"."capacity_holds" USING "btree" ("venue_id", "scope_type", "scope_id", "session_date", "user_id", "status") WHERE ("user_id" IS NOT NULL);


--
-- Name: idx_chat_messages_room; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_chat_messages_room" ON "public"."chat_messages" USING "btree" ("room_id", "created_at" DESC);


--
-- Name: idx_chat_participants_visible_from; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_chat_participants_visible_from" ON "public"."chat_participants" USING "btree" ("room_id", "user_id", "visible_from");


--
-- Name: idx_chat_reactions_room; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_chat_reactions_room" ON "public"."chat_reactions" USING "btree" ("room_id");


--
-- Name: idx_chat_rooms_daily; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_chat_rooms_daily" ON "public"."chat_rooms" USING "btree" ("venue_id", "session_date") WHERE (("room_type" = 'daily'::"text") AND ("session_date" IS NOT NULL));


--
-- Name: idx_chat_rooms_resource_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_chat_rooms_resource_id" ON "public"."chat_rooms" USING "btree" ("resource_id") WHERE ("resource_id" IS NOT NULL);


--
-- Name: idx_commerce_order_lines_fulfillment; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_commerce_order_lines_fulfillment" ON "public"."commerce_order_lines" USING "btree" ("fulfillment_status", "commerce_order_id") WHERE ("fulfillment_type" = 'desk_pickup'::"text");


--
-- Name: idx_commerce_order_lines_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_commerce_order_lines_order" ON "public"."commerce_order_lines" USING "btree" ("commerce_order_id", "sort_order", "created_at");


--
-- Name: idx_commerce_order_lines_participation; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_commerce_order_lines_participation" ON "public"."commerce_order_lines" USING "btree" ("session_registration_id") WHERE ("session_registration_id" IS NOT NULL);


--
-- Name: idx_commerce_orders_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_commerce_orders_customer" ON "public"."commerce_orders" USING "btree" ("customer_id", "created_at" DESC) WHERE ("customer_id" IS NOT NULL);


--
-- Name: idx_commerce_orders_guest_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_commerce_orders_guest_email" ON "public"."commerce_orders" USING "btree" ("venue_id", "lower"("guest_email")) WHERE ("guest_email" IS NOT NULL);


--
-- Name: idx_commerce_orders_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_commerce_orders_user" ON "public"."commerce_orders" USING "btree" ("user_id", "created_at" DESC) WHERE ("user_id" IS NOT NULL);


--
-- Name: idx_commerce_orders_venue_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_commerce_orders_venue_status" ON "public"."commerce_orders" USING "btree" ("venue_id", "status", "created_at" DESC);


--
-- Name: idx_commerce_receipt_lines_receipt; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_commerce_receipt_lines_receipt" ON "public"."commerce_receipt_lines" USING "btree" ("booking_receipt_id", "sort_order");


--
-- Name: idx_community_feed_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_community_feed_created" ON "public"."community_feed" USING "btree" ("created_at" DESC);


--
-- Name: idx_community_feed_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_community_feed_venue" ON "public"."community_feed" USING "btree" ("venue_id");


--
-- Name: idx_customer_identities_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_customer_identities_customer" ON "public"."customer_identities" USING "btree" ("customer_id");


--
-- Name: idx_customer_identities_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_customer_identities_email" ON "public"."customer_identities" USING "btree" ("organization_id", "lower"("email")) WHERE ("email" IS NOT NULL);


--
-- Name: idx_customer_identities_provider_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_customer_identities_provider_id" ON "public"."customer_identities" USING "btree" ("organization_id", "provider", "provider_id") WHERE ("provider_id" IS NOT NULL);


--
-- Name: idx_customer_venue_profiles_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_customer_venue_profiles_venue" ON "public"."customer_venue_profiles" USING "btree" ("venue_id", "customer_id");


--
-- Name: idx_customers_auth_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_customers_auth_user" ON "public"."customers" USING "btree" ("auth_user_id") WHERE ("auth_user_id" IS NOT NULL);


--
-- Name: idx_customers_org_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_customers_org_email" ON "public"."customers" USING "btree" ("organization_id", "email_normalized") WHERE (("email_normalized" IS NOT NULL) AND ("merged_into_id" IS NULL));


--
-- Name: idx_customers_org_phone; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_customers_org_phone" ON "public"."customers" USING "btree" ("organization_id", "phone_e164") WHERE (("phone_e164" IS NOT NULL) AND ("merged_into_id" IS NULL));


--
-- Name: idx_day_passes_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_day_passes_customer_id" ON "public"."day_passes" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);


--
-- Name: idx_day_passes_stripe_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_day_passes_stripe_session" ON "public"."day_passes" USING "btree" ("stripe_session_id") WHERE ("stripe_session_id" IS NOT NULL);


--
-- Name: idx_day_passes_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_day_passes_user" ON "public"."day_passes" USING "btree" ("user_id");


--
-- Name: idx_day_passes_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_day_passes_venue" ON "public"."day_passes" USING "btree" ("venue_id");


--
-- Name: idx_display_devices_court; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_display_devices_court" ON "public"."display_devices" USING "btree" ("venue_court_id") WHERE ("venue_court_id" IS NOT NULL);


--
-- Name: idx_display_devices_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_display_devices_venue" ON "public"."display_devices" USING "btree" ("venue_id", "created_at" DESC);


--
-- Name: idx_event_communications_event_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_communications_event_created" ON "public"."event_communications" USING "btree" ("event_id", "created_at" DESC);


--
-- Name: idx_event_communications_event_lead; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_communications_event_lead" ON "public"."event_communications" USING "btree" ((("metadata" ->> 'event_lead_id'::"text")), "created_at" DESC) WHERE ("metadata" ? 'event_lead_id'::"text");


--
-- Name: idx_event_communications_provider_event; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_event_communications_provider_event" ON "public"."event_communications" USING "btree" ("provider", "provider_event_id") WHERE ("provider_event_id" IS NOT NULL);


--
-- Name: idx_event_communications_provider_message_direction; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_event_communications_provider_message_direction" ON "public"."event_communications" USING "btree" ("provider", "provider_message_id", "direction") WHERE ("provider_message_id" IS NOT NULL);


--
-- Name: idx_event_communications_room_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_communications_room_created" ON "public"."event_communications" USING "btree" ("room_id", "created_at" DESC);


--
-- Name: idx_event_followups_due; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_followups_due" ON "public"."event_followups" USING "btree" ("status", "scheduled_at");


--
-- Name: idx_event_lead_activities_lead_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_lead_activities_lead_created" ON "public"."event_lead_activities" USING "btree" ("event_lead_id", "created_at" DESC);


--
-- Name: idx_event_lead_activities_venue_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_lead_activities_venue_created" ON "public"."event_lead_activities" USING "btree" ("venue_id", "created_at" DESC);


--
-- Name: idx_event_leads_event_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_leads_event_id" ON "public"."event_leads" USING "btree" ("event_id");


--
-- Name: idx_event_leads_venue_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_leads_venue_status" ON "public"."event_leads" USING "btree" ("venue_id", "status", "created_at" DESC);


--
-- Name: idx_event_offer_items_template; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_offer_items_template" ON "public"."event_offer_items" USING "btree" ("template_id", "sort_order");


--
-- Name: idx_event_offer_items_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_offer_items_venue" ON "public"."event_offer_items" USING "btree" ("venue_id", "item_type", "is_active", "sort_order");


--
-- Name: idx_event_offer_templates_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_offer_templates_venue" ON "public"."event_offer_templates" USING "btree" ("venue_id", "is_active", "sort_order");


--
-- Name: idx_event_offers_deposit_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_offers_deposit_session" ON "public"."event_offers" USING "btree" ("deposit_stripe_session_id") WHERE ("deposit_stripe_session_id" IS NOT NULL);


--
-- Name: idx_event_offers_lead; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_offers_lead" ON "public"."event_offers" USING "btree" ("event_lead_id", "created_at" DESC);


--
-- Name: idx_event_resource_allocations_court; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_resource_allocations_court" ON "public"."event_resource_allocations" USING "btree" ("venue_court_id", "start_at", "end_at") WHERE ("venue_court_id" IS NOT NULL);


--
-- Name: idx_event_resource_allocations_event; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_resource_allocations_event" ON "public"."event_resource_allocations" USING "btree" ("event_id", "status");


--
-- Name: idx_event_resource_allocations_staff; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_resource_allocations_staff" ON "public"."event_resource_allocations" USING "btree" ("venue_staff_id", "start_at", "end_at") WHERE ("venue_staff_id" IS NOT NULL);


--
-- Name: idx_event_resource_blocks_active_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_resource_blocks_active_time" ON "public"."event_resource_blocks" USING "btree" ("venue_id", "status", "starts_at", "ends_at") WHERE (("blocks_public_booking" = true) AND ("status" = ANY (ARRAY['hold'::"text", 'confirmed'::"text"])));


--
-- Name: idx_event_resource_blocks_event; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_resource_blocks_event" ON "public"."event_resource_blocks" USING "btree" ("event_id") WHERE ("event_id" IS NOT NULL);


--
-- Name: idx_event_resource_blocks_lead; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_resource_blocks_lead" ON "public"."event_resource_blocks" USING "btree" ("event_lead_id") WHERE ("event_lead_id" IS NOT NULL);


--
-- Name: idx_event_resource_blocks_resource_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_resource_blocks_resource_time" ON "public"."event_resource_blocks" USING "btree" ("resource_catalog_id", "starts_at", "ends_at") WHERE ("resource_catalog_id" IS NOT NULL);


--
-- Name: idx_event_resource_blocks_venue_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_resource_blocks_venue_time" ON "public"."event_resource_blocks" USING "btree" ("venue_id", "starts_at", "ends_at");


--
-- Name: idx_event_resource_catalog_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_event_resource_catalog_venue" ON "public"."event_resource_catalog" USING "btree" ("venue_id", "resource_type", "is_active", "sort_order");


--
-- Name: idx_events_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_events_category" ON "public"."events" USING "btree" ("category");


--
-- Name: idx_events_planning_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_events_planning_status" ON "public"."events" USING "btree" ("planning_status");


--
-- Name: idx_events_slug_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_events_slug_unique" ON "public"."events" USING "btree" ("slug") WHERE ("slug" IS NOT NULL);


--
-- Name: idx_events_template_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_events_template_id" ON "public"."events" USING "btree" ("template_id");


--
-- Name: idx_events_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_events_venue" ON "public"."events" USING "btree" ("venue_id");


--
-- Name: idx_events_visibility; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_events_visibility" ON "public"."events" USING "btree" ("visibility");


--
-- Name: idx_feed_likes_item; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_feed_likes_item" ON "public"."feed_likes" USING "btree" ("feed_item_id");


--
-- Name: idx_forum_posts_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_forum_posts_created" ON "public"."forum_posts" USING "btree" ("created_at" DESC);


--
-- Name: idx_forum_posts_tag; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_forum_posts_tag" ON "public"."forum_posts" USING "btree" ("tag");


--
-- Name: idx_forum_posts_upvotes; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_forum_posts_upvotes" ON "public"."forum_posts" USING "btree" ("upvote_count" DESC);


--
-- Name: idx_franchisees_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_franchisees_organization" ON "public"."franchisees" USING "btree" ("organization_id", "status");


--
-- Name: idx_investor_assets_active_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_investor_assets_active_type" ON "public"."investor_assets" USING "btree" ("is_active", "asset_type", "sort_order");


--
-- Name: idx_investor_settings_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_investor_settings_active" ON "public"."investor_settings" USING "btree" ("is_active", "updated_at" DESC);


--
-- Name: idx_ledger_entries_booking_receipt; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_ledger_entries_booking_receipt" ON "public"."ledger_entries" USING "btree" ("booking_receipt_id");


--
-- Name: idx_ledger_entries_commerce_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_ledger_entries_commerce_order" ON "public"."ledger_entries" USING "btree" ("commerce_order_id") WHERE ("commerce_order_id" IS NOT NULL);


--
-- Name: idx_ledger_entries_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_ledger_entries_customer_id" ON "public"."ledger_entries" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);


--
-- Name: idx_ledger_entries_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_ledger_entries_source" ON "public"."ledger_entries" USING "btree" ("source_type", "source_id");


--
-- Name: idx_ledger_entries_stripe_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_ledger_entries_stripe_session" ON "public"."ledger_entries" USING "btree" ("stripe_session_id") WHERE ("stripe_session_id" IS NOT NULL);


--
-- Name: idx_ledger_entries_venue_accounting_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_ledger_entries_venue_accounting_date" ON "public"."ledger_entries" USING "btree" ("venue_id", "accounting_date" DESC);


--
-- Name: idx_matches_event; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_matches_event" ON "public"."matches" USING "btree" ("event_id");


--
-- Name: idx_membership_entitlements_sport_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_membership_entitlements_sport_type" ON "public"."membership_entitlements" USING "btree" ("sport_type");


--
-- Name: idx_membership_tiers_assignable; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_membership_tiers_assignable" ON "public"."membership_tiers" USING "btree" ("venue_id", "is_assignable", "sort_order");


--
-- Name: idx_membership_usage_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_membership_usage_lookup" ON "public"."membership_usage" USING "btree" ("user_id", "venue_id", "entitlement_type", "period_start");


--
-- Name: idx_memberships_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_memberships_customer_id" ON "public"."memberships" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);


--
-- Name: idx_open_play_sessions_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_open_play_sessions_venue" ON "public"."open_play_sessions" USING "btree" ("venue_id");


--
-- Name: idx_operations_integration_health_global_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_operations_integration_health_global_unique" ON "public"."operations_integration_health" USING "btree" ("integration_key") WHERE ("venue_id" IS NULL);


--
-- Name: idx_operations_integration_health_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_operations_integration_health_status" ON "public"."operations_integration_health" USING "btree" ("venue_id", "status", "updated_at" DESC);


--
-- Name: idx_operations_integration_health_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_operations_integration_health_unique" ON "public"."operations_integration_health" USING "btree" ("venue_id", "integration_key") WHERE ("venue_id" IS NOT NULL);


--
-- Name: idx_ops_agent_runs_venue_finished; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_ops_agent_runs_venue_finished" ON "public"."ops_agent_runs" USING "btree" ("venue_id", "finished_at" DESC);


--
-- Name: idx_ops_check_state_venue_mode; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_ops_check_state_venue_mode" ON "public"."ops_check_state" USING "btree" ("venue_id", "mode", "item_index");


--
-- Name: idx_ops_client_events_fingerprint_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_ops_client_events_fingerprint_created" ON "public"."ops_client_events" USING "btree" ("fingerprint", "created_at" DESC);


--
-- Name: idx_ops_client_events_venue_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_ops_client_events_venue_created" ON "public"."ops_client_events" USING "btree" ("venue_id", "created_at" DESC);


--
-- Name: idx_ops_incidents_venue_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_ops_incidents_venue_status" ON "public"."ops_incidents" USING "btree" ("venue_id", "status", "severity", "created_at" DESC);


--
-- Name: idx_ops_signals_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_ops_signals_venue" ON "public"."ops_signals" USING "btree" ("venue_id", "signal_key");


--
-- Name: idx_organization_members_org_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_organization_members_org_user" ON "public"."organization_members" USING "btree" ("organization_id", "user_id", "is_active");


--
-- Name: idx_player_profiles_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_player_profiles_customer_id" ON "public"."player_profiles" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);


--
-- Name: idx_player_profiles_name_search; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_player_profiles_name_search" ON "public"."player_profiles" USING "btree" ("lower"("first_name"), "lower"("last_name"));


--
-- Name: idx_player_profiles_stripe_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_player_profiles_stripe_customer" ON "public"."player_profiles" USING "btree" ("stripe_customer_id") WHERE ("stripe_customer_id" IS NOT NULL);


--
-- Name: idx_players_event; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_players_event" ON "public"."players" USING "btree" ("event_id");


--
-- Name: idx_post_comments_post; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_post_comments_post" ON "public"."post_comments" USING "btree" ("post_id");


--
-- Name: idx_post_votes_post; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_post_votes_post" ON "public"."post_votes" USING "btree" ("post_id");


--
-- Name: idx_pricing_rules_court_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_pricing_rules_court_type" ON "public"."pricing_rules" USING "btree" ("venue_id", "court_type") WHERE ("court_type" IS NOT NULL);


--
-- Name: idx_pricing_rules_sport_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_pricing_rules_sport_type" ON "public"."pricing_rules" USING "btree" ("venue_id", "sport_type") WHERE ("sport_type" IS NOT NULL);


--
-- Name: idx_product_relationships_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_product_relationships_source" ON "public"."product_relationships" USING "btree" ("venue_id", "source_product_id", "is_active", "sort_order");


--
-- Name: idx_pulse_tokens_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_pulse_tokens_hash" ON "public"."pulse_tokens" USING "btree" ("access_token_hash");


--
-- Name: idx_pulse_tokens_status_expires; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_pulse_tokens_status_expires" ON "public"."pulse_tokens" USING "btree" ("status", "token_expires_at");


--
-- Name: idx_pulse_tokens_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_pulse_tokens_venue" ON "public"."pulse_tokens" USING "btree" ("venue_id", "created_at" DESC);


--
-- Name: idx_push_subscriptions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_push_subscriptions_user" ON "public"."push_subscriptions" USING "btree" ("user_id");


--
-- Name: idx_push_subscriptions_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_push_subscriptions_venue" ON "public"."push_subscriptions" USING "btree" ("venue_id");


--
-- Name: idx_score_events_session_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_score_events_session_created" ON "public"."score_events" USING "btree" ("score_session_id", "created_at" DESC);


--
-- Name: idx_score_matches_court_live; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_score_matches_court_live" ON "public"."score_matches" USING "btree" ("venue_court_id", "status", "updated_at" DESC) WHERE ("venue_court_id" IS NOT NULL);


--
-- Name: idx_score_matches_session_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_score_matches_session_status" ON "public"."score_matches" USING "btree" ("score_session_id", "status", "updated_at" DESC);


--
-- Name: idx_score_player_links_setup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_score_player_links_setup" ON "public"."score_player_links" USING "btree" ("display_device_id", "setup_id", "expires_at" DESC);


--
-- Name: idx_score_player_links_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_score_player_links_user" ON "public"."score_player_links" USING "btree" ("auth_user_id", "created_at" DESC);


--
-- Name: idx_score_sessions_event; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_score_sessions_event" ON "public"."score_sessions" USING "btree" ("event_id") WHERE ("event_id" IS NOT NULL);


--
-- Name: idx_score_sessions_venue_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_score_sessions_venue_status" ON "public"."score_sessions" USING "btree" ("venue_id", "status", "created_at" DESC);


--
-- Name: idx_score_turns_match_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_score_turns_match_created" ON "public"."score_turns" USING "btree" ("match_id", "created_at" DESC);


--
-- Name: idx_session_registrations_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_session_registrations_customer_id" ON "public"."session_registrations" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);


--
-- Name: idx_session_registrations_stripe_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_session_registrations_stripe_session" ON "public"."session_registrations" USING "btree" ("stripe_session_id") WHERE ("stripe_session_id" IS NOT NULL);


--
-- Name: idx_session_registrations_user_once; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_session_registrations_user_once" ON "public"."session_registrations" USING "btree" ("activity_session_id", "session_date", "user_id");


--
-- Name: idx_session_registrations_venue_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_session_registrations_venue_date" ON "public"."session_registrations" USING "btree" ("venue_id", "session_date");


--
-- Name: idx_stripe_events_received_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_stripe_events_received_at" ON "public"."stripe_events" USING "btree" ("received_at" DESC);


--
-- Name: idx_stripe_events_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_stripe_events_status" ON "public"."stripe_events" USING "btree" ("status");


--
-- Name: idx_teams_event; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_teams_event" ON "public"."teams" USING "btree" ("event_id");


--
-- Name: idx_user_roles_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_user_roles_user" ON "public"."user_roles" USING "btree" ("user_id");


--
-- Name: idx_venue_checkins_active_entitlement_once; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_venue_checkins_active_entitlement_once" ON "public"."venue_checkins" USING "btree" ("venue_id", "session_date", "entry_type", "entitlement_id") WHERE (("entitlement_id" IS NOT NULL) AND ("checked_out_at" IS NULL));


--
-- Name: idx_venue_checkins_active_user_entry_once; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_venue_checkins_active_user_entry_once" ON "public"."venue_checkins" USING "btree" ("venue_id", "session_date", "entry_type", "user_id") WHERE (("entitlement_id" IS NULL) AND ("user_id" IS NOT NULL) AND ("checked_out_at" IS NULL));


--
-- Name: idx_venue_checkins_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_venue_checkins_customer_id" ON "public"."venue_checkins" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);


--
-- Name: idx_venue_checkins_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_venue_checkins_user" ON "public"."venue_checkins" USING "btree" ("user_id");


--
-- Name: idx_venue_checkins_venue_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_venue_checkins_venue_date" ON "public"."venue_checkins" USING "btree" ("venue_id", "session_date");


--
-- Name: idx_venue_courts_sport; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_venue_courts_sport" ON "public"."venue_courts" USING "btree" ("sport_type");


--
-- Name: idx_venue_operation_overrides_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_venue_operation_overrides_active" ON "public"."venue_operation_overrides" USING "btree" ("venue_id", "status", "starts_at", "ends_at") WHERE ("status" = 'active'::"text");


--
-- Name: idx_venue_operation_overrides_venue_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_venue_operation_overrides_venue_time" ON "public"."venue_operation_overrides" USING "btree" ("venue_id", "starts_at", "ends_at");


--
-- Name: idx_venue_staff_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_venue_staff_user" ON "public"."venue_staff" USING "btree" ("user_id");


--
-- Name: idx_venue_staff_venue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_venue_staff_venue" ON "public"."venue_staff" USING "btree" ("venue_id");


--
-- Name: idx_venues_event_plan_share_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_venues_event_plan_share_token" ON "public"."venues" USING "btree" ("event_plan_share_token") WHERE ("event_plan_share_token" IS NOT NULL);


--
-- Name: idx_venues_franchisee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_venues_franchisee" ON "public"."venues" USING "btree" ("franchisee_id");


--
-- Name: idx_venues_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_venues_organization" ON "public"."venues" USING "btree" ("organization_id");


--
-- Name: idx_zettle_connections_state; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_zettle_connections_state" ON "public"."zettle_connections" USING "btree" ("oauth_state") WHERE ("oauth_state" IS NOT NULL);


--
-- Name: idx_zettle_connections_sync_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_zettle_connections_sync_status" ON "public"."zettle_connections" USING "btree" ("venue_id", "last_sync_status", "last_successful_sync_at" DESC);


--
-- Name: idx_zettle_purchases_venue_occurred; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_zettle_purchases_venue_occurred" ON "public"."zettle_purchases" USING "btree" ("venue_id", "occurred_at" DESC);


--
-- Name: investor_leads_email_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "investor_leads_email_idx" ON "public"."investor_leads" USING "btree" ("lower"("email"));


--
-- Name: investor_leads_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "investor_leads_status_idx" ON "public"."investor_leads" USING "btree" ("status");


--
-- Name: investor_leads_token_hash_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "investor_leads_token_hash_idx" ON "public"."investor_leads" USING "btree" ("access_token_hash");


--
-- Name: membership_entitlements_tier_type_sport_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "membership_entitlements_tier_type_sport_key" ON "public"."membership_entitlements" USING "btree" ("tier_id", "entitlement_type", "sport_type");


--
-- Name: uniq_activity_session_interests_user_session_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "uniq_activity_session_interests_user_session_date" ON "public"."activity_session_interests" USING "btree" ("user_id", "activity_session_id", "session_date");


--
-- Name: crew_challenges on_crew_challenge_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "on_crew_challenge_change" AFTER INSERT OR UPDATE ON "public"."crew_challenges" FOR EACH ROW EXECUTE FUNCTION "public"."on_crew_challenge_change"();


--
-- Name: crew_sessions on_crew_session_created; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "on_crew_session_created" AFTER INSERT ON "public"."crew_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."on_crew_session_created"();


--
-- Name: post_comments on_post_comment_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "on_post_comment_change" AFTER INSERT OR DELETE ON "public"."post_comments" FOR EACH ROW EXECUTE FUNCTION "public"."update_post_comment_count"();


--
-- Name: post_votes on_post_vote_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "on_post_vote_change" AFTER INSERT OR DELETE OR UPDATE ON "public"."post_votes" FOR EACH ROW EXECUTE FUNCTION "public"."update_post_vote_count"();


--
-- Name: venue_checkins on_venue_checkin_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "on_venue_checkin_insert" AFTER INSERT ON "public"."venue_checkins" FOR EACH ROW EXECUTE FUNCTION "public"."on_venue_checkin_created"();


--
-- Name: audit_log prevent_audit_log_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "prevent_audit_log_delete" BEFORE DELETE ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_log_mutation"();


--
-- Name: audit_log prevent_audit_log_update; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "prevent_audit_log_update" BEFORE UPDATE ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_log_mutation"();


--
-- Name: ledger_entries prevent_ledger_entries_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "prevent_ledger_entries_delete" BEFORE DELETE ON "public"."ledger_entries" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_ledger_entries_mutation"();


--
-- Name: ledger_entries prevent_ledger_entries_update; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "prevent_ledger_entries_update" BEFORE UPDATE ON "public"."ledger_entries" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_ledger_entries_mutation"();


--
-- Name: bookings set_booking_ref; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "set_booking_ref" BEFORE INSERT ON "public"."bookings" FOR EACH ROW WHEN (("new"."booking_ref" IS NULL)) EXECUTE FUNCTION "public"."generate_booking_ref"();


--
-- Name: activity_session_overrides trg_activity_session_overrides_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_activity_session_overrides_updated_at" BEFORE UPDATE ON "public"."activity_session_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: capacity_holds trg_capacity_holds_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_capacity_holds_updated_at" BEFORE UPDATE ON "public"."capacity_holds" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: chat_messages trg_chat_messages_bump_room; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_chat_messages_bump_room" AFTER INSERT ON "public"."chat_messages" FOR EACH ROW EXECUTE FUNCTION "public"."fn_bump_room_updated_at"();


--
-- Name: commerce_orders trg_commerce_order_lifecycle; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_commerce_order_lifecycle" BEFORE DELETE OR UPDATE ON "public"."commerce_orders" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_commerce_order_lifecycle"();


--
-- Name: commerce_order_lines trg_commerce_order_line_lifecycle; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_commerce_order_line_lifecycle" BEFORE INSERT OR DELETE OR UPDATE ON "public"."commerce_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_commerce_order_line_lifecycle"();


--
-- Name: commerce_order_lines trg_commerce_order_lines_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_commerce_order_lines_updated_at" BEFORE UPDATE ON "public"."commerce_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: commerce_orders trg_commerce_orders_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_commerce_orders_updated_at" BEFORE UPDATE ON "public"."commerce_orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: display_devices trg_display_devices_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_display_devices_updated_at" BEFORE UPDATE ON "public"."display_devices" FOR EACH ROW EXECUTE FUNCTION "public"."fn_display_devices_updated_at"();


--
-- Name: forum_poll_votes trg_enforce_one_vote_per_poll; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_enforce_one_vote_per_poll" AFTER INSERT ON "public"."forum_poll_votes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_one_vote_per_poll"();


--
-- Name: event_communications trg_event_communications_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_event_communications_updated_at" BEFORE UPDATE ON "public"."event_communications" FOR EACH ROW EXECUTE FUNCTION "public"."fn_event_communications_updated_at"();


--
-- Name: events trg_event_created; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_event_created" AFTER INSERT ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."on_event_created"();


--
-- Name: event_followups trg_event_followups_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_event_followups_updated_at" BEFORE UPDATE ON "public"."event_followups" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: event_leads trg_event_leads_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_event_leads_updated_at" BEFORE UPDATE ON "public"."event_leads" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: event_offer_items trg_event_offer_items_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_event_offer_items_updated_at" BEFORE UPDATE ON "public"."event_offer_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: event_offer_templates trg_event_offer_templates_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_event_offer_templates_updated_at" BEFORE UPDATE ON "public"."event_offer_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: event_offers trg_event_offers_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_event_offers_updated_at" BEFORE UPDATE ON "public"."event_offers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: event_resource_allocations trg_event_resource_allocations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_event_resource_allocations_updated_at" BEFORE UPDATE ON "public"."event_resource_allocations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: event_resource_blocks trg_event_resource_blocks_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_event_resource_blocks_updated_at" BEFORE UPDATE ON "public"."event_resource_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: event_resource_catalog trg_event_resource_catalog_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_event_resource_catalog_updated_at" BEFORE UPDATE ON "public"."event_resource_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: corporate_orders trg_generate_order_number; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_generate_order_number" BEFORE INSERT ON "public"."corporate_orders" FOR EACH ROW WHEN ((("new"."order_number" IS NULL) OR ("new"."order_number" = ''::"text"))) EXECUTE FUNCTION "public"."generate_order_number"();


--
-- Name: investor_assets trg_investor_assets_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_investor_assets_updated_at" BEFORE UPDATE ON "public"."investor_assets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: investor_leads trg_investor_leads_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_investor_leads_updated_at" BEFORE UPDATE ON "public"."investor_leads" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: investor_settings trg_investor_settings_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_investor_settings_updated_at" BEFORE UPDATE ON "public"."investor_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: matches trg_match_completed; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_match_completed" AFTER UPDATE ON "public"."matches" FOR EACH ROW EXECUTE FUNCTION "public"."on_match_completed"();


--
-- Name: ops_check_state trg_ops_check_state_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_ops_check_state_updated_at" BEFORE UPDATE ON "public"."ops_check_state" FOR EACH ROW EXECUTE FUNCTION "public"."fn_ops_updated_at"();


--
-- Name: ops_incidents trg_ops_incidents_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_ops_incidents_updated_at" BEFORE UPDATE ON "public"."ops_incidents" FOR EACH ROW EXECUTE FUNCTION "public"."fn_ops_updated_at"();


--
-- Name: ops_signals trg_ops_signals_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_ops_signals_updated_at" BEFORE UPDATE ON "public"."ops_signals" FOR EACH ROW EXECUTE FUNCTION "public"."fn_ops_updated_at"();


--
-- Name: product_relationships trg_product_relationships_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_product_relationships_updated_at" BEFORE UPDATE ON "public"."product_relationships" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: score_matches trg_score_matches_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_score_matches_updated_at" BEFORE UPDATE ON "public"."score_matches" FOR EACH ROW EXECUTE FUNCTION "public"."fn_score_updated_at"();


--
-- Name: score_player_links trg_score_player_links_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_score_player_links_updated_at" BEFORE UPDATE ON "public"."score_player_links" FOR EACH ROW EXECUTE FUNCTION "public"."fn_score_player_links_updated_at"();


--
-- Name: score_sessions trg_score_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_score_sessions_updated_at" BEFORE UPDATE ON "public"."score_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."fn_score_updated_at"();


--
-- Name: venue_operation_overrides trg_venue_operation_overrides_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "trg_venue_operation_overrides_updated_at" BEFORE UPDATE ON "public"."venue_operation_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: activity_session_hosts update_activity_session_hosts_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_activity_session_hosts_updated_at" BEFORE UPDATE ON "public"."activity_session_hosts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: activity_session_interests update_activity_session_interests_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_activity_session_interests_updated_at" BEFORE UPDATE ON "public"."activity_session_interests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: booking_participant_invites update_booking_participant_invites_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_booking_participant_invites_updated_at" BEFORE UPDATE ON "public"."booking_participant_invites" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: booking_participants update_booking_participants_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_booking_participants_updated_at" BEFORE UPDATE ON "public"."booking_participants" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: booking_receipts update_booking_receipts_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_booking_receipts_updated_at" BEFORE UPDATE ON "public"."booking_receipts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: bookings update_bookings_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_bookings_updated_at" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: corporate_accounts update_corporate_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_corporate_accounts_updated_at" BEFORE UPDATE ON "public"."corporate_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: corporate_packages update_corporate_packages_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_corporate_packages_updated_at" BEFORE UPDATE ON "public"."corporate_packages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: courts update_courts_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_courts_updated_at" BEFORE UPDATE ON "public"."courts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: crew_sessions update_crew_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_crew_sessions_updated_at" BEFORE UPDATE ON "public"."crew_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: crews update_crews_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_crews_updated_at" BEFORE UPDATE ON "public"."crews" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: customer_identities update_customer_identities_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_customer_identities_updated_at" BEFORE UPDATE ON "public"."customer_identities" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: customer_venue_profiles update_customer_venue_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_customer_venue_profiles_updated_at" BEFORE UPDATE ON "public"."customer_venue_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: customers update_customers_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_customers_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: event_offers update_event_offers_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_event_offers_updated_at" BEFORE UPDATE ON "public"."event_offers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: event_templates update_event_templates_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_event_templates_updated_at" BEFORE UPDATE ON "public"."event_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: events update_events_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_events_updated_at" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: franchisees update_franchisees_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_franchisees_updated_at" BEFORE UPDATE ON "public"."franchisees" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: ladder_challenges update_ladder_challenges_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_ladder_challenges_updated_at" BEFORE UPDATE ON "public"."ladder_challenges" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: ladder_entries update_ladder_entries_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_ladder_entries_updated_at" BEFORE UPDATE ON "public"."ladder_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: ladder_matches update_ladder_matches_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_ladder_matches_updated_at" BEFORE UPDATE ON "public"."ladder_matches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: matches update_matches_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_matches_updated_at" BEFORE UPDATE ON "public"."matches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: membership_tiers update_membership_tiers_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_membership_tiers_updated_at" BEFORE UPDATE ON "public"."membership_tiers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: memberships update_memberships_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_memberships_updated_at" BEFORE UPDATE ON "public"."memberships" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: organization_members update_organization_members_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_organization_members_updated_at" BEFORE UPDATE ON "public"."organization_members" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: organizations update_organizations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_organizations_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: player_profiles update_player_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_player_profiles_updated_at" BEFORE UPDATE ON "public"."player_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: players update_players_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_players_updated_at" BEFORE UPDATE ON "public"."players" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: pricing_rules update_pricing_rules_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_pricing_rules_updated_at" BEFORE UPDATE ON "public"."pricing_rules" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: pulse_tokens update_pulse_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_pulse_tokens_updated_at" BEFORE UPDATE ON "public"."pulse_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: seasons update_seasons_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_seasons_updated_at" BEFORE UPDATE ON "public"."seasons" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: standings update_standings_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_standings_updated_at" BEFORE UPDATE ON "public"."standings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: teams update_teams_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_teams_updated_at" BEFORE UPDATE ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: venue_courts update_venue_courts_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_venue_courts_updated_at" BEFORE UPDATE ON "public"."venue_courts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: venue_event_categories update_venue_event_categories_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_venue_event_categories_updated_at" BEFORE UPDATE ON "public"."venue_event_categories" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: venue_links update_venue_links_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_venue_links_updated_at" BEFORE UPDATE ON "public"."venue_links" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: venue_staff update_venue_staff_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_venue_staff_updated_at" BEFORE UPDATE ON "public"."venue_staff" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: venues update_venues_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_venues_updated_at" BEFORE UPDATE ON "public"."venues" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: wellness_receipt_profiles update_wellness_receipt_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_wellness_receipt_profiles_updated_at" BEFORE UPDATE ON "public"."wellness_receipt_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: access_entitlements access_entitlements_activity_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_entitlements"
    ADD CONSTRAINT "access_entitlements_activity_session_id_fkey" FOREIGN KEY ("activity_session_id") REFERENCES "public"."activity_sessions"("id") ON DELETE SET NULL;


--
-- Name: access_entitlements access_entitlements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_entitlements"
    ADD CONSTRAINT "access_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: access_entitlements access_entitlements_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_entitlements"
    ADD CONSTRAINT "access_entitlements_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: access_products access_products_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_products"
    ADD CONSTRAINT "access_products_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: access_vouchers access_vouchers_claimed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_vouchers"
    ADD CONSTRAINT "access_vouchers_claimed_by_user_id_fkey" FOREIGN KEY ("claimed_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: access_vouchers access_vouchers_purchaser_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_vouchers"
    ADD CONSTRAINT "access_vouchers_purchaser_user_id_fkey" FOREIGN KEY ("purchaser_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: access_vouchers access_vouchers_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."access_vouchers"
    ADD CONSTRAINT "access_vouchers_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: activity_series activity_series_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_series"
    ADD CONSTRAINT "activity_series_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: activity_session_hosts activity_session_hosts_activity_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_hosts"
    ADD CONSTRAINT "activity_session_hosts_activity_session_id_fkey" FOREIGN KEY ("activity_session_id") REFERENCES "public"."activity_sessions"("id") ON DELETE CASCADE;


--
-- Name: activity_session_hosts activity_session_hosts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_hosts"
    ADD CONSTRAINT "activity_session_hosts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: activity_session_hosts activity_session_hosts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_hosts"
    ADD CONSTRAINT "activity_session_hosts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;


--
-- Name: activity_session_hosts activity_session_hosts_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_hosts"
    ADD CONSTRAINT "activity_session_hosts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: activity_session_interests activity_session_interests_activity_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_interests"
    ADD CONSTRAINT "activity_session_interests_activity_session_id_fkey" FOREIGN KEY ("activity_session_id") REFERENCES "public"."activity_sessions"("id") ON DELETE CASCADE;


--
-- Name: activity_session_interests activity_session_interests_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_interests"
    ADD CONSTRAINT "activity_session_interests_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE SET NULL;


--
-- Name: activity_session_overrides activity_session_overrides_activity_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_overrides"
    ADD CONSTRAINT "activity_session_overrides_activity_session_id_fkey" FOREIGN KEY ("activity_session_id") REFERENCES "public"."activity_sessions"("id") ON DELETE CASCADE;


--
-- Name: activity_session_overrides activity_session_overrides_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_overrides"
    ADD CONSTRAINT "activity_session_overrides_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: activity_session_overrides activity_session_overrides_venue_operation_override_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_session_overrides"
    ADD CONSTRAINT "activity_session_overrides_venue_operation_override_id_fkey" FOREIGN KEY ("venue_operation_override_id") REFERENCES "public"."venue_operation_overrides"("id") ON DELETE SET NULL;


--
-- Name: activity_sessions activity_sessions_series_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_sessions"
    ADD CONSTRAINT "activity_sessions_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "public"."activity_series"("id") ON DELETE SET NULL;


--
-- Name: activity_sessions activity_sessions_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."activity_sessions"
    ADD CONSTRAINT "activity_sessions_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: audit_log audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: audit_log audit_log_franchisee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_franchisee_id_fkey" FOREIGN KEY ("franchisee_id") REFERENCES "public"."franchisees"("id") ON DELETE SET NULL;


--
-- Name: audit_log audit_log_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;


--
-- Name: audit_log audit_log_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE SET NULL;


--
-- Name: booking_participant_invites booking_participant_invites_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participant_invites"
    ADD CONSTRAINT "booking_participant_invites_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;


--
-- Name: booking_participant_invites booking_participant_invites_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participant_invites"
    ADD CONSTRAINT "booking_participant_invites_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: booking_participant_invites booking_participant_invites_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participant_invites"
    ADD CONSTRAINT "booking_participant_invites_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: booking_participants booking_participants_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participants"
    ADD CONSTRAINT "booking_participants_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;


--
-- Name: booking_participants booking_participants_booking_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participants"
    ADD CONSTRAINT "booking_participants_booking_receipt_id_fkey" FOREIGN KEY ("booking_receipt_id") REFERENCES "public"."booking_receipts"("id") ON DELETE SET NULL;


--
-- Name: booking_participants booking_participants_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participants"
    ADD CONSTRAINT "booking_participants_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: booking_participants booking_participants_invite_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participants"
    ADD CONSTRAINT "booking_participants_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "public"."booking_participant_invites"("id") ON DELETE SET NULL;


--
-- Name: booking_participants booking_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participants"
    ADD CONSTRAINT "booking_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: booking_participants booking_participants_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_participants"
    ADD CONSTRAINT "booking_participants_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: booking_receipts booking_receipts_commerce_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_commerce_order_id_fkey" FOREIGN KEY ("commerce_order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE SET NULL;


--
-- Name: booking_receipts booking_receipts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: booking_receipts booking_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: booking_receipts booking_receipts_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE SET NULL;


--
-- Name: bookings bookings_booked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_booked_by_fkey" FOREIGN KEY ("booked_by") REFERENCES "auth"."users"("id");


--
-- Name: bookings bookings_corporate_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_corporate_package_id_fkey" FOREIGN KEY ("corporate_package_id") REFERENCES "public"."corporate_packages"("id");


--
-- Name: bookings bookings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: bookings bookings_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE SET NULL;


--
-- Name: bookings bookings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: bookings bookings_venue_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_venue_court_id_fkey" FOREIGN KEY ("venue_court_id") REFERENCES "public"."venue_courts"("id") ON DELETE CASCADE;


--
-- Name: bookings bookings_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: capacity_holds capacity_holds_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."capacity_holds"
    ADD CONSTRAINT "capacity_holds_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: capacity_holds capacity_holds_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."capacity_holds"
    ADD CONSTRAINT "capacity_holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: capacity_holds capacity_holds_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."capacity_holds"
    ADD CONSTRAINT "capacity_holds_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "public"."chat_messages"("id") ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: chat_participants chat_participants_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_participants"
    ADD CONSTRAINT "chat_participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE CASCADE;


--
-- Name: chat_participants chat_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_participants"
    ADD CONSTRAINT "chat_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: chat_reactions chat_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_reactions"
    ADD CONSTRAINT "chat_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE CASCADE;


--
-- Name: chat_reactions chat_reactions_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_reactions"
    ADD CONSTRAINT "chat_reactions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE CASCADE;


--
-- Name: chat_reactions chat_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_reactions"
    ADD CONSTRAINT "chat_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: chat_rooms chat_rooms_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."chat_rooms"
    ADD CONSTRAINT "chat_rooms_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: comment_votes comment_votes_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."comment_votes"
    ADD CONSTRAINT "comment_votes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."post_comments"("id") ON DELETE CASCADE;


--
-- Name: commerce_order_lines commerce_order_lines_activity_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_order_lines"
    ADD CONSTRAINT "commerce_order_lines_activity_session_id_fkey" FOREIGN KEY ("activity_session_id") REFERENCES "public"."activity_sessions"("id") ON DELETE SET NULL;


--
-- Name: commerce_order_lines commerce_order_lines_beneficiary_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_order_lines"
    ADD CONSTRAINT "commerce_order_lines_beneficiary_customer_id_fkey" FOREIGN KEY ("beneficiary_customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: commerce_order_lines commerce_order_lines_beneficiary_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_order_lines"
    ADD CONSTRAINT "commerce_order_lines_beneficiary_user_id_fkey" FOREIGN KEY ("beneficiary_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: commerce_order_lines commerce_order_lines_capacity_hold_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_order_lines"
    ADD CONSTRAINT "commerce_order_lines_capacity_hold_id_fkey" FOREIGN KEY ("capacity_hold_id") REFERENCES "public"."capacity_holds"("id") ON DELETE SET NULL;


--
-- Name: commerce_order_lines commerce_order_lines_commerce_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_order_lines"
    ADD CONSTRAINT "commerce_order_lines_commerce_order_id_fkey" FOREIGN KEY ("commerce_order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE CASCADE;


--
-- Name: commerce_order_lines commerce_order_lines_fulfilled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_order_lines"
    ADD CONSTRAINT "commerce_order_lines_fulfilled_by_fkey" FOREIGN KEY ("fulfilled_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: commerce_order_lines commerce_order_lines_parent_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_order_lines"
    ADD CONSTRAINT "commerce_order_lines_parent_line_id_fkey" FOREIGN KEY ("parent_line_id") REFERENCES "public"."commerce_order_lines"("id") ON DELETE SET NULL;


--
-- Name: commerce_order_lines commerce_order_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_order_lines"
    ADD CONSTRAINT "commerce_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."access_products"("id") ON DELETE SET NULL;


--
-- Name: commerce_order_lines commerce_order_lines_session_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_order_lines"
    ADD CONSTRAINT "commerce_order_lines_session_registration_id_fkey" FOREIGN KEY ("session_registration_id") REFERENCES "public"."session_registrations"("id") ON DELETE SET NULL;


--
-- Name: commerce_orders commerce_orders_booking_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_orders"
    ADD CONSTRAINT "commerce_orders_booking_receipt_id_fkey" FOREIGN KEY ("booking_receipt_id") REFERENCES "public"."booking_receipts"("id") ON DELETE SET NULL;


--
-- Name: commerce_orders commerce_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_orders"
    ADD CONSTRAINT "commerce_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: commerce_orders commerce_orders_ledger_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_orders"
    ADD CONSTRAINT "commerce_orders_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE SET NULL;


--
-- Name: commerce_orders commerce_orders_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_orders"
    ADD CONSTRAINT "commerce_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;


--
-- Name: commerce_orders commerce_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_orders"
    ADD CONSTRAINT "commerce_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: commerce_orders commerce_orders_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_orders"
    ADD CONSTRAINT "commerce_orders_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE RESTRICT;


--
-- Name: commerce_receipt_lines commerce_receipt_lines_booking_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_receipt_lines"
    ADD CONSTRAINT "commerce_receipt_lines_booking_receipt_id_fkey" FOREIGN KEY ("booking_receipt_id") REFERENCES "public"."booking_receipts"("id") ON DELETE CASCADE;


--
-- Name: commerce_receipt_lines commerce_receipt_lines_commerce_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_receipt_lines"
    ADD CONSTRAINT "commerce_receipt_lines_commerce_order_id_fkey" FOREIGN KEY ("commerce_order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE RESTRICT;


--
-- Name: commerce_receipt_lines commerce_receipt_lines_commerce_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_receipt_lines"
    ADD CONSTRAINT "commerce_receipt_lines_commerce_order_line_id_fkey" FOREIGN KEY ("commerce_order_line_id") REFERENCES "public"."commerce_order_lines"("id") ON DELETE RESTRICT;


--
-- Name: commerce_receipt_lines commerce_receipt_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."commerce_receipt_lines"
    ADD CONSTRAINT "commerce_receipt_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."access_products"("id") ON DELETE SET NULL;


--
-- Name: community_feed community_feed_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."community_feed"
    ADD CONSTRAINT "community_feed_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: community_feed community_feed_player_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."community_feed"
    ADD CONSTRAINT "community_feed_player_profile_id_fkey" FOREIGN KEY ("player_profile_id") REFERENCES "public"."player_profiles"("id") ON DELETE CASCADE;


--
-- Name: community_feed community_feed_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."community_feed"
    ADD CONSTRAINT "community_feed_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: community_stories community_stories_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."community_stories"
    ADD CONSTRAINT "community_stories_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: corporate_accounts corporate_accounts_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_accounts"
    ADD CONSTRAINT "corporate_accounts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: corporate_members corporate_members_corporate_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_members"
    ADD CONSTRAINT "corporate_members_corporate_account_id_fkey" FOREIGN KEY ("corporate_account_id") REFERENCES "public"."corporate_accounts"("id") ON DELETE CASCADE;


--
-- Name: corporate_order_items corporate_order_items_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_order_items"
    ADD CONSTRAINT "corporate_order_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");


--
-- Name: corporate_order_items corporate_order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_order_items"
    ADD CONSTRAINT "corporate_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."corporate_orders"("id") ON DELETE CASCADE;


--
-- Name: corporate_orders corporate_orders_corporate_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_orders"
    ADD CONSTRAINT "corporate_orders_corporate_account_id_fkey" FOREIGN KEY ("corporate_account_id") REFERENCES "public"."corporate_accounts"("id") ON DELETE CASCADE;


--
-- Name: corporate_orders corporate_orders_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_orders"
    ADD CONSTRAINT "corporate_orders_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");


--
-- Name: corporate_packages corporate_packages_corporate_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_packages"
    ADD CONSTRAINT "corporate_packages_corporate_account_id_fkey" FOREIGN KEY ("corporate_account_id") REFERENCES "public"."corporate_accounts"("id") ON DELETE CASCADE;


--
-- Name: corporate_packages corporate_packages_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."corporate_packages"
    ADD CONSTRAINT "corporate_packages_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: courts courts_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."courts"
    ADD CONSTRAINT "courts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: crew_challenges crew_challenges_challenged_crew_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_challenges"
    ADD CONSTRAINT "crew_challenges_challenged_crew_id_fkey" FOREIGN KEY ("challenged_crew_id") REFERENCES "public"."crews"("id") ON DELETE CASCADE;


--
-- Name: crew_challenges crew_challenges_challenger_crew_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_challenges"
    ADD CONSTRAINT "crew_challenges_challenger_crew_id_fkey" FOREIGN KEY ("challenger_crew_id") REFERENCES "public"."crews"("id") ON DELETE CASCADE;


--
-- Name: crew_members crew_members_crew_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_members"
    ADD CONSTRAINT "crew_members_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE CASCADE;


--
-- Name: crew_members crew_members_player_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_members"
    ADD CONSTRAINT "crew_members_player_profile_id_fkey" FOREIGN KEY ("player_profile_id") REFERENCES "public"."player_profiles"("id") ON DELETE CASCADE;


--
-- Name: crew_session_signups crew_session_signups_crew_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_session_signups"
    ADD CONSTRAINT "crew_session_signups_crew_session_id_fkey" FOREIGN KEY ("crew_session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE CASCADE;


--
-- Name: crew_session_signups crew_session_signups_player_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_session_signups"
    ADD CONSTRAINT "crew_session_signups_player_profile_id_fkey" FOREIGN KEY ("player_profile_id") REFERENCES "public"."player_profiles"("id") ON DELETE CASCADE;


--
-- Name: crew_sessions crew_sessions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_sessions"
    ADD CONSTRAINT "crew_sessions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");


--
-- Name: crew_sessions crew_sessions_crew_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_sessions"
    ADD CONSTRAINT "crew_sessions_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE CASCADE;


--
-- Name: crew_sessions crew_sessions_venue_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_sessions"
    ADD CONSTRAINT "crew_sessions_venue_court_id_fkey" FOREIGN KEY ("venue_court_id") REFERENCES "public"."venue_courts"("id");


--
-- Name: crew_sessions crew_sessions_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crew_sessions"
    ADD CONSTRAINT "crew_sessions_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");


--
-- Name: crews crews_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."crews"
    ADD CONSTRAINT "crews_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE SET NULL;


--
-- Name: customer_identities customer_identities_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customer_identities"
    ADD CONSTRAINT "customer_identities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;


--
-- Name: customer_identities customer_identities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customer_identities"
    ADD CONSTRAINT "customer_identities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: customer_venue_profiles customer_venue_profiles_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customer_venue_profiles"
    ADD CONSTRAINT "customer_venue_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;


--
-- Name: customer_venue_profiles customer_venue_profiles_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customer_venue_profiles"
    ADD CONSTRAINT "customer_venue_profiles_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: customers customers_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: customers customers_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: customers customers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: day_pass_grants day_pass_grants_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_pass_grants"
    ADD CONSTRAINT "day_pass_grants_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE CASCADE;


--
-- Name: day_pass_grants day_pass_grants_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_pass_grants"
    ADD CONSTRAINT "day_pass_grants_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: day_pass_shares day_pass_shares_day_pass_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_pass_shares"
    ADD CONSTRAINT "day_pass_shares_day_pass_id_fkey" FOREIGN KEY ("day_pass_id") REFERENCES "public"."day_passes"("id") ON DELETE CASCADE;


--
-- Name: day_passes day_passes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_passes"
    ADD CONSTRAINT "day_passes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: day_passes day_passes_shared_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_passes"
    ADD CONSTRAINT "day_passes_shared_from_fkey" FOREIGN KEY ("shared_from") REFERENCES "public"."day_pass_shares"("id");


--
-- Name: day_passes day_passes_sold_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_passes"
    ADD CONSTRAINT "day_passes_sold_by_fkey" FOREIGN KEY ("sold_by") REFERENCES "auth"."users"("id");


--
-- Name: day_passes day_passes_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."day_passes"
    ADD CONSTRAINT "day_passes_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: display_devices display_devices_venue_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."display_devices"
    ADD CONSTRAINT "display_devices_venue_court_id_fkey" FOREIGN KEY ("venue_court_id") REFERENCES "public"."venue_courts"("id") ON DELETE SET NULL;


--
-- Name: display_devices display_devices_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."display_devices"
    ADD CONSTRAINT "display_devices_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: event_checkins event_checkins_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_checkins"
    ADD CONSTRAINT "event_checkins_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: event_checkins event_checkins_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_checkins"
    ADD CONSTRAINT "event_checkins_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;


--
-- Name: event_communications event_communications_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_communications"
    ADD CONSTRAINT "event_communications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: event_communications event_communications_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_communications"
    ADD CONSTRAINT "event_communications_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: event_communications event_communications_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_communications"
    ADD CONSTRAINT "event_communications_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE SET NULL;


--
-- Name: event_courts event_courts_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_courts"
    ADD CONSTRAINT "event_courts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: event_courts event_courts_venue_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_courts"
    ADD CONSTRAINT "event_courts_venue_court_id_fkey" FOREIGN KEY ("venue_court_id") REFERENCES "public"."venue_courts"("id") ON DELETE CASCADE;


--
-- Name: event_followups event_followups_event_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_followups"
    ADD CONSTRAINT "event_followups_event_lead_id_fkey" FOREIGN KEY ("event_lead_id") REFERENCES "public"."event_leads"("id") ON DELETE CASCADE;


--
-- Name: event_followups event_followups_event_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_followups"
    ADD CONSTRAINT "event_followups_event_offer_id_fkey" FOREIGN KEY ("event_offer_id") REFERENCES "public"."event_offers"("id") ON DELETE SET NULL;


--
-- Name: event_followups event_followups_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_followups"
    ADD CONSTRAINT "event_followups_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: event_lead_activities event_lead_activities_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_lead_activities"
    ADD CONSTRAINT "event_lead_activities_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: event_lead_activities event_lead_activities_event_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_lead_activities"
    ADD CONSTRAINT "event_lead_activities_event_lead_id_fkey" FOREIGN KEY ("event_lead_id") REFERENCES "public"."event_leads"("id") ON DELETE CASCADE;


--
-- Name: event_lead_activities event_lead_activities_event_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_lead_activities"
    ADD CONSTRAINT "event_lead_activities_event_offer_id_fkey" FOREIGN KEY ("event_offer_id") REFERENCES "public"."event_offers"("id") ON DELETE SET NULL;


--
-- Name: event_lead_activities event_lead_activities_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_lead_activities"
    ADD CONSTRAINT "event_lead_activities_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: event_leads event_leads_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_leads"
    ADD CONSTRAINT "event_leads_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;


--
-- Name: event_leads event_leads_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_leads"
    ADD CONSTRAINT "event_leads_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: event_likes event_likes_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_likes"
    ADD CONSTRAINT "event_likes_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: event_likes event_likes_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_likes"
    ADD CONSTRAINT "event_likes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: event_offer_items event_offer_items_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offer_items"
    ADD CONSTRAINT "event_offer_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."event_offer_templates"("id") ON DELETE CASCADE;


--
-- Name: event_offer_items event_offer_items_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offer_items"
    ADD CONSTRAINT "event_offer_items_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: event_offer_templates event_offer_templates_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offer_templates"
    ADD CONSTRAINT "event_offer_templates_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: event_offers event_offers_booking_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offers"
    ADD CONSTRAINT "event_offers_booking_confirmed_by_fkey" FOREIGN KEY ("booking_confirmed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: event_offers event_offers_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offers"
    ADD CONSTRAINT "event_offers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: event_offers event_offers_event_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offers"
    ADD CONSTRAINT "event_offers_event_lead_id_fkey" FOREIGN KEY ("event_lead_id") REFERENCES "public"."event_leads"("id") ON DELETE CASCADE;


--
-- Name: event_offers event_offers_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offers"
    ADD CONSTRAINT "event_offers_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: event_offers event_offers_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_offers"
    ADD CONSTRAINT "event_offers_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: event_resource_allocations event_resource_allocations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_allocations"
    ADD CONSTRAINT "event_resource_allocations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: event_resource_allocations event_resource_allocations_resource_catalog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_allocations"
    ADD CONSTRAINT "event_resource_allocations_resource_catalog_id_fkey" FOREIGN KEY ("resource_catalog_id") REFERENCES "public"."event_resource_catalog"("id") ON DELETE SET NULL;


--
-- Name: event_resource_allocations event_resource_allocations_venue_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_allocations"
    ADD CONSTRAINT "event_resource_allocations_venue_court_id_fkey" FOREIGN KEY ("venue_court_id") REFERENCES "public"."venue_courts"("id") ON DELETE SET NULL;


--
-- Name: event_resource_allocations event_resource_allocations_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_allocations"
    ADD CONSTRAINT "event_resource_allocations_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: event_resource_allocations event_resource_allocations_venue_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_allocations"
    ADD CONSTRAINT "event_resource_allocations_venue_staff_id_fkey" FOREIGN KEY ("venue_staff_id") REFERENCES "public"."venue_staff"("id") ON DELETE SET NULL;


--
-- Name: event_resource_blocks event_resource_blocks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_blocks"
    ADD CONSTRAINT "event_resource_blocks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: event_resource_blocks event_resource_blocks_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_blocks"
    ADD CONSTRAINT "event_resource_blocks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: event_resource_blocks event_resource_blocks_event_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_blocks"
    ADD CONSTRAINT "event_resource_blocks_event_lead_id_fkey" FOREIGN KEY ("event_lead_id") REFERENCES "public"."event_leads"("id") ON DELETE SET NULL;


--
-- Name: event_resource_blocks event_resource_blocks_event_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_blocks"
    ADD CONSTRAINT "event_resource_blocks_event_offer_id_fkey" FOREIGN KEY ("event_offer_id") REFERENCES "public"."event_offers"("id") ON DELETE SET NULL;


--
-- Name: event_resource_blocks event_resource_blocks_resource_catalog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_blocks"
    ADD CONSTRAINT "event_resource_blocks_resource_catalog_id_fkey" FOREIGN KEY ("resource_catalog_id") REFERENCES "public"."event_resource_catalog"("id") ON DELETE SET NULL;


--
-- Name: event_resource_blocks event_resource_blocks_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_blocks"
    ADD CONSTRAINT "event_resource_blocks_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: event_resource_catalog event_resource_catalog_venue_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_catalog"
    ADD CONSTRAINT "event_resource_catalog_venue_court_id_fkey" FOREIGN KEY ("venue_court_id") REFERENCES "public"."venue_courts"("id") ON DELETE CASCADE;


--
-- Name: event_resource_catalog event_resource_catalog_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_catalog"
    ADD CONSTRAINT "event_resource_catalog_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: event_resource_catalog event_resource_catalog_venue_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."event_resource_catalog"
    ADD CONSTRAINT "event_resource_catalog_venue_staff_id_fkey" FOREIGN KEY ("venue_staff_id") REFERENCES "public"."venue_staff"("id") ON DELETE SET NULL;


--
-- Name: events events_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."event_templates"("id");


--
-- Name: events events_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE SET NULL;


--
-- Name: events events_winner_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_winner_team_id_fkey" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;


--
-- Name: feed_likes feed_likes_feed_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feed_likes"
    ADD CONSTRAINT "feed_likes_feed_item_id_fkey" FOREIGN KEY ("feed_item_id") REFERENCES "public"."community_feed"("id") ON DELETE CASCADE;


--
-- Name: forum_poll_options forum_poll_options_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_poll_options"
    ADD CONSTRAINT "forum_poll_options_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE CASCADE;


--
-- Name: forum_poll_votes forum_poll_votes_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_poll_votes"
    ADD CONSTRAINT "forum_poll_votes_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."forum_poll_options"("id") ON DELETE CASCADE;


--
-- Name: forum_post_signups forum_post_signups_player_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_post_signups"
    ADD CONSTRAINT "forum_post_signups_player_profile_id_fkey" FOREIGN KEY ("player_profile_id") REFERENCES "public"."player_profiles"("id") ON DELETE CASCADE;


--
-- Name: forum_post_signups forum_post_signups_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_post_signups"
    ADD CONSTRAINT "forum_post_signups_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE CASCADE;


--
-- Name: forum_posts forum_posts_author_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_posts"
    ADD CONSTRAINT "forum_posts_author_profile_id_fkey" FOREIGN KEY ("author_profile_id") REFERENCES "public"."player_profiles"("id") ON DELETE CASCADE;


--
-- Name: forum_posts forum_posts_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."forum_posts"
    ADD CONSTRAINT "forum_posts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE SET NULL;


--
-- Name: franchisees franchisees_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."franchisees"
    ADD CONSTRAINT "franchisees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: investor_assets investor_assets_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."investor_assets"
    ADD CONSTRAINT "investor_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;


--
-- Name: investor_settings investor_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."investor_settings"
    ADD CONSTRAINT "investor_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;


--
-- Name: ladder_challenges ladder_challenges_challenged_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_challenges"
    ADD CONSTRAINT "ladder_challenges_challenged_entry_id_fkey" FOREIGN KEY ("challenged_entry_id") REFERENCES "public"."ladder_entries"("id") ON DELETE CASCADE;


--
-- Name: ladder_challenges ladder_challenges_challenger_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_challenges"
    ADD CONSTRAINT "ladder_challenges_challenger_entry_id_fkey" FOREIGN KEY ("challenger_entry_id") REFERENCES "public"."ladder_entries"("id") ON DELETE CASCADE;


--
-- Name: ladder_challenges ladder_challenges_challenger_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_challenges"
    ADD CONSTRAINT "ladder_challenges_challenger_player_id_fkey" FOREIGN KEY ("challenger_player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;


--
-- Name: ladder_challenges ladder_challenges_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_challenges"
    ADD CONSTRAINT "ladder_challenges_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: ladder_entries ladder_entries_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_entries"
    ADD CONSTRAINT "ladder_entries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: ladder_entries ladder_entries_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_entries"
    ADD CONSTRAINT "ladder_entries_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;


--
-- Name: ladder_entries ladder_entries_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_entries"
    ADD CONSTRAINT "ladder_entries_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;


--
-- Name: ladder_matches ladder_matches_challenged_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_matches"
    ADD CONSTRAINT "ladder_matches_challenged_entry_id_fkey" FOREIGN KEY ("challenged_entry_id") REFERENCES "public"."ladder_entries"("id") ON DELETE CASCADE;


--
-- Name: ladder_matches ladder_matches_challenger_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_matches"
    ADD CONSTRAINT "ladder_matches_challenger_entry_id_fkey" FOREIGN KEY ("challenger_entry_id") REFERENCES "public"."ladder_entries"("id") ON DELETE CASCADE;


--
-- Name: ladder_matches ladder_matches_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_matches"
    ADD CONSTRAINT "ladder_matches_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: ladder_matches ladder_matches_winner_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ladder_matches"
    ADD CONSTRAINT "ladder_matches_winner_entry_id_fkey" FOREIGN KEY ("winner_entry_id") REFERENCES "public"."ladder_entries"("id") ON DELETE SET NULL;


--
-- Name: ledger_entries ledger_entries_booking_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_booking_receipt_id_fkey" FOREIGN KEY ("booking_receipt_id") REFERENCES "public"."booking_receipts"("id") ON DELETE SET NULL;


--
-- Name: ledger_entries ledger_entries_commerce_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_commerce_order_id_fkey" FOREIGN KEY ("commerce_order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE SET NULL;


--
-- Name: ledger_entries ledger_entries_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: ledger_entries ledger_entries_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE RESTRICT;


--
-- Name: matches matches_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE SET NULL;


--
-- Name: matches matches_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: matches matches_team1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_team1_id_fkey" FOREIGN KEY ("team1_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;


--
-- Name: matches matches_team2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_team2_id_fkey" FOREIGN KEY ("team2_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;


--
-- Name: membership_entitlements membership_entitlements_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_entitlements"
    ADD CONSTRAINT "membership_entitlements_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "public"."membership_tiers"("id") ON DELETE CASCADE;


--
-- Name: membership_tier_pricing membership_tier_pricing_pricing_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_tier_pricing"
    ADD CONSTRAINT "membership_tier_pricing_pricing_rule_id_fkey" FOREIGN KEY ("pricing_rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE SET NULL;


--
-- Name: membership_tier_pricing membership_tier_pricing_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_tier_pricing"
    ADD CONSTRAINT "membership_tier_pricing_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "public"."membership_tiers"("id") ON DELETE CASCADE;


--
-- Name: membership_tiers membership_tiers_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_tiers"
    ADD CONSTRAINT "membership_tiers_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: membership_usage membership_usage_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."membership_usage"
    ADD CONSTRAINT "membership_usage_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: memberships memberships_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: memberships memberships_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "public"."membership_tiers"("id") ON DELETE CASCADE;


--
-- Name: memberships memberships_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: open_play_sessions open_play_sessions_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."open_play_sessions"
    ADD CONSTRAINT "open_play_sessions_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: opening_hours opening_hours_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."opening_hours"
    ADD CONSTRAINT "opening_hours_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: operations_integration_health operations_integration_health_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."operations_integration_health"
    ADD CONSTRAINT "operations_integration_health_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: ops_agent_runs ops_agent_runs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_agent_runs"
    ADD CONSTRAINT "ops_agent_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: ops_agent_runs ops_agent_runs_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_agent_runs"
    ADD CONSTRAINT "ops_agent_runs_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: ops_check_state ops_check_state_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_check_state"
    ADD CONSTRAINT "ops_check_state_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: ops_check_state ops_check_state_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_check_state"
    ADD CONSTRAINT "ops_check_state_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: ops_client_events ops_client_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_client_events"
    ADD CONSTRAINT "ops_client_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: ops_client_events ops_client_events_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_client_events"
    ADD CONSTRAINT "ops_client_events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE SET NULL;


--
-- Name: ops_incidents ops_incidents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_incidents"
    ADD CONSTRAINT "ops_incidents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: ops_incidents ops_incidents_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_incidents"
    ADD CONSTRAINT "ops_incidents_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: ops_incidents ops_incidents_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_incidents"
    ADD CONSTRAINT "ops_incidents_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: ops_signals ops_signals_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_signals"
    ADD CONSTRAINT "ops_signals_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: ops_signals ops_signals_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ops_signals"
    ADD CONSTRAINT "ops_signals_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: organization_members organization_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: player_profiles player_profiles_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."player_profiles"
    ADD CONSTRAINT "player_profiles_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: player_profiles player_profiles_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."player_profiles"
    ADD CONSTRAINT "player_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: player_profiles player_profiles_preferred_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."player_profiles"
    ADD CONSTRAINT "player_profiles_preferred_venue_id_fkey" FOREIGN KEY ("preferred_venue_id") REFERENCES "public"."venues"("id") ON DELETE SET NULL;


--
-- Name: players players_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: players players_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: players players_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;


--
-- Name: post_comments post_comments_author_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_author_profile_id_fkey" FOREIGN KEY ("author_profile_id") REFERENCES "public"."player_profiles"("id") ON DELETE CASCADE;


--
-- Name: post_comments post_comments_parent_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."post_comments"("id") ON DELETE CASCADE;


--
-- Name: post_comments post_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE CASCADE;


--
-- Name: post_votes post_votes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."post_votes"
    ADD CONSTRAINT "post_votes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE CASCADE;


--
-- Name: pricing_rules pricing_rules_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."pricing_rules"
    ADD CONSTRAINT "pricing_rules_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: product_relationships product_relationships_source_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."product_relationships"
    ADD CONSTRAINT "product_relationships_source_product_id_fkey" FOREIGN KEY ("source_product_id") REFERENCES "public"."access_products"("id") ON DELETE CASCADE;


--
-- Name: product_relationships product_relationships_target_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."product_relationships"
    ADD CONSTRAINT "product_relationships_target_product_id_fkey" FOREIGN KEY ("target_product_id") REFERENCES "public"."access_products"("id") ON DELETE CASCADE;


--
-- Name: product_relationships product_relationships_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."product_relationships"
    ADD CONSTRAINT "product_relationships_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: pulse_tokens pulse_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."pulse_tokens"
    ADD CONSTRAINT "pulse_tokens_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: pulse_tokens pulse_tokens_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."pulse_tokens"
    ADD CONSTRAINT "pulse_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;


--
-- Name: pulse_tokens pulse_tokens_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."pulse_tokens"
    ADD CONSTRAINT "pulse_tokens_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: pulse_tokens pulse_tokens_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."pulse_tokens"
    ADD CONSTRAINT "pulse_tokens_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE SET NULL;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: score_events score_events_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_events"
    ADD CONSTRAINT "score_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."score_matches"("id") ON DELETE CASCADE;


--
-- Name: score_events score_events_score_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_events"
    ADD CONSTRAINT "score_events_score_session_id_fkey" FOREIGN KEY ("score_session_id") REFERENCES "public"."score_sessions"("id") ON DELETE CASCADE;


--
-- Name: score_events score_events_venue_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_events"
    ADD CONSTRAINT "score_events_venue_court_id_fkey" FOREIGN KEY ("venue_court_id") REFERENCES "public"."venue_courts"("id") ON DELETE SET NULL;


--
-- Name: score_matches score_matches_display_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_matches"
    ADD CONSTRAINT "score_matches_display_device_id_fkey" FOREIGN KEY ("display_device_id") REFERENCES "public"."display_devices"("id") ON DELETE SET NULL;


--
-- Name: score_matches score_matches_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_matches"
    ADD CONSTRAINT "score_matches_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;


--
-- Name: score_matches score_matches_player1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_matches"
    ADD CONSTRAINT "score_matches_player1_id_fkey" FOREIGN KEY ("player1_id") REFERENCES "public"."score_players"("id") ON DELETE SET NULL;


--
-- Name: score_matches score_matches_player2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_matches"
    ADD CONSTRAINT "score_matches_player2_id_fkey" FOREIGN KEY ("player2_id") REFERENCES "public"."score_players"("id") ON DELETE SET NULL;


--
-- Name: score_matches score_matches_score_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_matches"
    ADD CONSTRAINT "score_matches_score_session_id_fkey" FOREIGN KEY ("score_session_id") REFERENCES "public"."score_sessions"("id") ON DELETE CASCADE;


--
-- Name: score_matches score_matches_venue_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_matches"
    ADD CONSTRAINT "score_matches_venue_court_id_fkey" FOREIGN KEY ("venue_court_id") REFERENCES "public"."venue_courts"("id") ON DELETE SET NULL;


--
-- Name: score_matches score_matches_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_matches"
    ADD CONSTRAINT "score_matches_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: score_matches score_matches_winner_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_matches"
    ADD CONSTRAINT "score_matches_winner_player_id_fkey" FOREIGN KEY ("winner_player_id") REFERENCES "public"."score_players"("id") ON DELETE SET NULL;


--
-- Name: score_player_links score_player_links_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_player_links"
    ADD CONSTRAINT "score_player_links_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: score_player_links score_player_links_display_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_player_links"
    ADD CONSTRAINT "score_player_links_display_device_id_fkey" FOREIGN KEY ("display_device_id") REFERENCES "public"."display_devices"("id") ON DELETE CASCADE;


--
-- Name: score_player_links score_player_links_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_player_links"
    ADD CONSTRAINT "score_player_links_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: score_players score_players_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_players"
    ADD CONSTRAINT "score_players_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: score_players score_players_score_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_players"
    ADD CONSTRAINT "score_players_score_session_id_fkey" FOREIGN KEY ("score_session_id") REFERENCES "public"."score_sessions"("id") ON DELETE CASCADE;


--
-- Name: score_sessions score_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_sessions"
    ADD CONSTRAINT "score_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: score_sessions score_sessions_created_from_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_sessions"
    ADD CONSTRAINT "score_sessions_created_from_device_id_fkey" FOREIGN KEY ("created_from_device_id") REFERENCES "public"."display_devices"("id") ON DELETE SET NULL;


--
-- Name: score_sessions score_sessions_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_sessions"
    ADD CONSTRAINT "score_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;


--
-- Name: score_sessions score_sessions_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_sessions"
    ADD CONSTRAINT "score_sessions_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: score_turns score_turns_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_turns"
    ADD CONSTRAINT "score_turns_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."score_matches"("id") ON DELETE CASCADE;


--
-- Name: score_turns score_turns_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_turns"
    ADD CONSTRAINT "score_turns_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."score_players"("id") ON DELETE SET NULL;


--
-- Name: score_turns score_turns_score_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_turns"
    ADD CONSTRAINT "score_turns_score_session_id_fkey" FOREIGN KEY ("score_session_id") REFERENCES "public"."score_sessions"("id") ON DELETE CASCADE;


--
-- Name: score_turns score_turns_venue_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."score_turns"
    ADD CONSTRAINT "score_turns_venue_court_id_fkey" FOREIGN KEY ("venue_court_id") REFERENCES "public"."venue_courts"("id") ON DELETE SET NULL;


--
-- Name: season_standings season_standings_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."season_standings"
    ADD CONSTRAINT "season_standings_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;


--
-- Name: season_standings season_standings_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."season_standings"
    ADD CONSTRAINT "season_standings_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;


--
-- Name: seasons seasons_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."seasons"
    ADD CONSTRAINT "seasons_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: session_registrations session_registrations_activity_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."session_registrations"
    ADD CONSTRAINT "session_registrations_activity_session_id_fkey" FOREIGN KEY ("activity_session_id") REFERENCES "public"."activity_sessions"("id") ON DELETE CASCADE;


--
-- Name: session_registrations session_registrations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."session_registrations"
    ADD CONSTRAINT "session_registrations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: session_registrations session_registrations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."session_registrations"
    ADD CONSTRAINT "session_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: session_registrations session_registrations_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."session_registrations"
    ADD CONSTRAINT "session_registrations_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: standings standings_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."standings"
    ADD CONSTRAINT "standings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: standings standings_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."standings"
    ADD CONSTRAINT "standings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;


--
-- Name: teams teams_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: venue_checkins venue_checkins_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_checkins"
    ADD CONSTRAINT "venue_checkins_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: venue_checkins venue_checkins_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_checkins"
    ADD CONSTRAINT "venue_checkins_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: venue_courts venue_courts_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_courts"
    ADD CONSTRAINT "venue_courts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: venue_event_categories venue_event_categories_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_event_categories"
    ADD CONSTRAINT "venue_event_categories_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: venue_links venue_links_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_links"
    ADD CONSTRAINT "venue_links_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: venue_operation_overrides venue_operation_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_operation_overrides"
    ADD CONSTRAINT "venue_operation_overrides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: venue_operation_overrides venue_operation_overrides_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_operation_overrides"
    ADD CONSTRAINT "venue_operation_overrides_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: venue_staff venue_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_staff"
    ADD CONSTRAINT "venue_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: venue_staff venue_staff_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venue_staff"
    ADD CONSTRAINT "venue_staff_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: venues venues_franchisee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_franchisee_id_fkey" FOREIGN KEY ("franchisee_id") REFERENCES "public"."franchisees"("id") ON DELETE RESTRICT;


--
-- Name: venues venues_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;


--
-- Name: wellness_receipt_profiles wellness_receipt_profiles_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."wellness_receipt_profiles"
    ADD CONSTRAINT "wellness_receipt_profiles_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: zettle_connections zettle_connections_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."zettle_connections"
    ADD CONSTRAINT "zettle_connections_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: zettle_purchases zettle_purchases_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."zettle_purchases"
    ADD CONSTRAINT "zettle_purchases_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."zettle_connections"("id") ON DELETE SET NULL;


--
-- Name: zettle_purchases zettle_purchases_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."zettle_purchases"
    ADD CONSTRAINT "zettle_purchases_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;


--
-- Name: courts Admin can manage courts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage courts" ON "public"."courts" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: event_courts Admin can manage event courts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage event courts" ON "public"."event_courts" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: events Admin can manage events; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage events" ON "public"."events" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: ladder_challenges Admin can manage ladder challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage ladder challenges" ON "public"."ladder_challenges" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: ladder_entries Admin can manage ladder entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage ladder entries" ON "public"."ladder_entries" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: ladder_matches Admin can manage ladder matches; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage ladder matches" ON "public"."ladder_matches" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: matches Admin can manage matches; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage matches" ON "public"."matches" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: opening_hours Admin can manage opening hours; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage opening hours" ON "public"."opening_hours" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: players Admin can manage players; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage players" ON "public"."players" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: pricing_rules Admin can manage pricing; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage pricing" ON "public"."pricing_rules" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: season_standings Admin can manage season standings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage season standings" ON "public"."season_standings" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());


--
-- Name: seasons Admin can manage seasons; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage seasons" ON "public"."seasons" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: standings Admin can manage standings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage standings" ON "public"."standings" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: teams Admin can manage teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage teams" ON "public"."teams" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: venue_courts Admin can manage venue courts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage venue courts" ON "public"."venue_courts" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: venue_event_categories Admin can manage venue event categories; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage venue event categories" ON "public"."venue_event_categories" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: venue_links Admin can manage venue links; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage venue links" ON "public"."venue_links" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: venue_staff Admin can manage venue staff; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin can manage venue staff" ON "public"."venue_staff" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: bookings Admin manages bookings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin manages bookings" ON "public"."bookings" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: corporate_accounts Admin manages corporate accounts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin manages corporate accounts" ON "public"."corporate_accounts" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: corporate_members Admin manages corporate members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin manages corporate members" ON "public"."corporate_members" TO "authenticated" USING (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."corporate_accounts" "ca"
  WHERE (("ca"."id" = "corporate_members"."corporate_account_id") AND "public"."is_venue_admin"("auth"."uid"(), "ca"."venue_id")))))) WITH CHECK (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."corporate_accounts" "ca"
  WHERE (("ca"."id" = "corporate_members"."corporate_account_id") AND "public"."is_venue_admin"("auth"."uid"(), "ca"."venue_id"))))));


--
-- Name: corporate_orders Admin manages corporate orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin manages corporate orders" ON "public"."corporate_orders" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: corporate_packages Admin manages corporate packages; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin manages corporate packages" ON "public"."corporate_packages" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: day_passes Admin manages day passes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin manages day passes" ON "public"."day_passes" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: day_pass_grants Admin manages grants; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin manages grants" ON "public"."day_pass_grants" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: corporate_order_items Admin manages order items; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin manages order items" ON "public"."corporate_order_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."corporate_orders" "co"
  WHERE (("co"."id" = "corporate_order_items"."order_id") AND ("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "co"."venue_id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."corporate_orders" "co"
  WHERE (("co"."id" = "corporate_order_items"."order_id") AND ("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "co"."venue_id"))))));


--
-- Name: membership_tier_pricing Admin manages tier pricing; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin manages tier pricing" ON "public"."membership_tier_pricing" USING (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."membership_tiers" "t"
  WHERE (("t"."id" = "membership_tier_pricing"."tier_id") AND "public"."is_venue_admin"("auth"."uid"(), "t"."venue_id")))))) WITH CHECK (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."membership_tiers" "t"
  WHERE (("t"."id" = "membership_tier_pricing"."tier_id") AND "public"."is_venue_admin"("auth"."uid"(), "t"."venue_id"))))));


--
-- Name: membership_tiers Admin manages tiers; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admin manages tiers" ON "public"."membership_tiers" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: comment_votes Anyone can read comment votes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can read comment votes" ON "public"."comment_votes" FOR SELECT USING (true);


--
-- Name: post_comments Anyone can read comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can read comments" ON "public"."post_comments" FOR SELECT USING (true);


--
-- Name: forum_posts Anyone can read forum posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can read forum posts" ON "public"."forum_posts" FOR SELECT USING (true);


--
-- Name: forum_poll_options Anyone can read poll options; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can read poll options" ON "public"."forum_poll_options" FOR SELECT USING (true);


--
-- Name: forum_poll_votes Anyone can read poll votes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can read poll votes" ON "public"."forum_poll_votes" FOR SELECT USING (true);


--
-- Name: forum_post_signups Anyone can read post signups; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can read post signups" ON "public"."forum_post_signups" FOR SELECT USING (true);


--
-- Name: post_votes Anyone can read votes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can read votes" ON "public"."post_votes" FOR SELECT USING (true);


--
-- Name: post_comments Authenticated can comment; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated can comment" ON "public"."post_comments" FOR INSERT TO "authenticated" WITH CHECK (("author_profile_id" = "public"."get_player_profile_id"("auth"."uid"())));


--
-- Name: crews Authenticated can create crews; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated can create crews" ON "public"."crews" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));


--
-- Name: forum_posts Authenticated can create posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated can create posts" ON "public"."forum_posts" FOR INSERT TO "authenticated" WITH CHECK (("author_profile_id" = "public"."get_player_profile_id"("auth"."uid"())));


--
-- Name: crew_members Authenticated can join crew; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated can join crew" ON "public"."crew_members" FOR INSERT TO "authenticated" WITH CHECK (("player_profile_id" = "public"."get_player_profile_id"("auth"."uid"())));


--
-- Name: event_checkins Authenticated can manage checkins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated can manage checkins" ON "public"."event_checkins" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id")))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "public"."get_venue_id_for_event"("event_id"))));


--
-- Name: chat_messages Authenticated can send messages; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated can send messages" ON "public"."chat_messages" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: forum_poll_votes Authenticated can vote; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authenticated can vote" ON "public"."forum_poll_votes" FOR INSERT TO "authenticated" WITH CHECK (("auth_user_id" = "auth"."uid"()));


--
-- Name: post_comments Authors can delete own comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authors can delete own comments" ON "public"."post_comments" FOR DELETE TO "authenticated" USING ((("author_profile_id" = "public"."get_player_profile_id"("auth"."uid"())) OR "public"."is_super_admin"()));


--
-- Name: forum_posts Authors can delete own posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authors can delete own posts" ON "public"."forum_posts" FOR DELETE TO "authenticated" USING ((("author_profile_id" = "public"."get_player_profile_id"("auth"."uid"())) OR "public"."is_super_admin"()));


--
-- Name: post_comments Authors can update own comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authors can update own comments" ON "public"."post_comments" FOR UPDATE TO "authenticated" USING (("author_profile_id" = "public"."get_player_profile_id"("auth"."uid"())));


--
-- Name: forum_posts Authors can update own posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Authors can update own posts" ON "public"."forum_posts" FOR UPDATE TO "authenticated" USING (("author_profile_id" = "public"."get_player_profile_id"("auth"."uid"())));


--
-- Name: corporate_members Corporate admins manage members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Corporate admins manage members" ON "public"."corporate_members" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."corporate_members" "cm2"
  WHERE (("cm2"."corporate_account_id" = "corporate_members"."corporate_account_id") AND ("cm2"."user_id" = "auth"."uid"()) AND ("cm2"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."corporate_members" "cm2"
  WHERE (("cm2"."corporate_account_id" = "corporate_members"."corporate_account_id") AND ("cm2"."user_id" = "auth"."uid"()) AND ("cm2"."role" = 'admin'::"text")))));


--
-- Name: corporate_order_items Corporate admins manage own order items; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Corporate admins manage own order items" ON "public"."corporate_order_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."corporate_orders" "co"
     JOIN "public"."corporate_members" "cm" ON (("cm"."corporate_account_id" = "co"."corporate_account_id")))
  WHERE (("co"."id" = "corporate_order_items"."order_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."corporate_orders" "co"
     JOIN "public"."corporate_members" "cm" ON (("cm"."corporate_account_id" = "co"."corporate_account_id")))
  WHERE (("co"."id" = "corporate_order_items"."order_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = 'admin'::"text")))));


--
-- Name: corporate_order_items Corporate members read own order items; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Corporate members read own order items" ON "public"."corporate_order_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."corporate_orders" "co"
     JOIN "public"."corporate_members" "cm" ON (("cm"."corporate_account_id" = "co"."corporate_account_id")))
  WHERE (("co"."id" = "corporate_order_items"."order_id") AND ("cm"."user_id" = "auth"."uid"())))));


--
-- Name: crew_challenges Leader can create challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Leader can create challenges" ON "public"."crew_challenges" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_crew_leader"("auth"."uid"(), "challenger_crew_id"));


--
-- Name: crews Leader can delete crew; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Leader can delete crew" ON "public"."crews" FOR DELETE TO "authenticated" USING ("public"."is_crew_leader"("auth"."uid"(), "id"));


--
-- Name: crew_challenges Leader can update challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Leader can update challenges" ON "public"."crew_challenges" FOR UPDATE TO "authenticated" USING (("public"."is_crew_leader"("auth"."uid"(), "challenger_crew_id") OR "public"."is_crew_leader"("auth"."uid"(), "challenged_crew_id")));


--
-- Name: crews Leader can update crew; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Leader can update crew" ON "public"."crews" FOR UPDATE TO "authenticated" USING ("public"."is_crew_leader"("auth"."uid"(), "id"));


--
-- Name: crew_members Leader can update member roles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Leader can update member roles" ON "public"."crew_members" FOR UPDATE TO "authenticated" USING ("public"."is_crew_leader"("auth"."uid"(), "crew_id"));


--
-- Name: crew_sessions Leader/co-leader can create sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Leader/co-leader can create sessions" ON "public"."crew_sessions" FOR INSERT WITH CHECK ("public"."is_crew_leader"("auth"."uid"(), "crew_id"));


--
-- Name: crew_sessions Leader/co-leader can delete sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Leader/co-leader can delete sessions" ON "public"."crew_sessions" FOR DELETE USING ("public"."is_crew_leader"("auth"."uid"(), "crew_id"));


--
-- Name: crew_sessions Leader/co-leader can update sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Leader/co-leader can update sessions" ON "public"."crew_sessions" FOR UPDATE USING ("public"."is_crew_leader"("auth"."uid"(), "crew_id"));


--
-- Name: crew_session_signups Members can cancel own signup; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Members can cancel own signup" ON "public"."crew_session_signups" FOR DELETE USING (("player_profile_id" = "public"."get_player_profile_id"("auth"."uid"())));


--
-- Name: crew_members Members can leave crew; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Members can leave crew" ON "public"."crew_members" FOR DELETE TO "authenticated" USING ((("player_profile_id" = "public"."get_player_profile_id"("auth"."uid"())) OR "public"."is_crew_leader"("auth"."uid"(), "crew_id")));


--
-- Name: crew_session_signups Members can sign up; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Members can sign up" ON "public"."crew_session_signups" FOR INSERT WITH CHECK (("player_profile_id" = "public"."get_player_profile_id"("auth"."uid"())));


--
-- Name: corporate_members Members read own membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Members read own membership" ON "public"."corporate_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));


--
-- Name: score_player_links Own score player links; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Own score player links" ON "public"."score_player_links" FOR SELECT TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));


--
-- Name: forum_poll_options Post author can create poll options; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Post author can create poll options" ON "public"."forum_poll_options" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."forum_posts" "fp"
  WHERE (("fp"."id" = "forum_poll_options"."post_id") AND ("fp"."author_profile_id" = "public"."get_player_profile_id"("auth"."uid"()))))));


--
-- Name: access_products Public can read active access products; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read active access products" ON "public"."access_products" FOR SELECT USING ((("is_active" = true) OR "public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: activity_series Public can read active activity series; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read active activity series" ON "public"."activity_series" FOR SELECT USING ((("status" = 'active'::"text") OR "public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: activity_sessions Public can read active activity sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read active activity sessions" ON "public"."activity_sessions" FOR SELECT USING ((("is_active" = true) OR "public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: event_templates Public can read active templates; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read active templates" ON "public"."event_templates" FOR SELECT USING ((("is_active" = true) OR "public"."is_super_admin"()));


--
-- Name: membership_tiers Public can read active tiers; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read active tiers" ON "public"."membership_tiers" FOR SELECT USING ((("is_active" = true) OR "public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id")));


--
-- Name: venue_links Public can read active venue links; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read active venue links" ON "public"."venue_links" FOR SELECT USING (("is_active" = true));


--
-- Name: venues Public can read active venues; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read active venues" ON "public"."venues" FOR SELECT USING ((("is_public" = true) OR "public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "id")));


--
-- Name: event_checkins Public can read checkins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read checkins" ON "public"."event_checkins" FOR SELECT USING (true);


--
-- Name: community_feed Public can read community feed; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read community feed" ON "public"."community_feed" FOR SELECT USING (true);


--
-- Name: courts Public can read courts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read courts" ON "public"."courts" FOR SELECT USING (true);


--
-- Name: crew_challenges Public can read crew challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read crew challenges" ON "public"."crew_challenges" FOR SELECT USING (true);


--
-- Name: crew_members Public can read crew members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read crew members" ON "public"."crew_members" FOR SELECT USING (true);


--
-- Name: crew_sessions Public can read crew sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read crew sessions" ON "public"."crew_sessions" FOR SELECT USING (true);


--
-- Name: crews Public can read crews; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read crews" ON "public"."crews" FOR SELECT USING (true);


--
-- Name: event_courts Public can read event courts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read event courts" ON "public"."event_courts" FOR SELECT USING (true);


--
-- Name: events Public can read events; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read events" ON "public"."events" FOR SELECT USING ((("is_public" = true) OR "public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: feed_likes Public can read feed likes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read feed likes" ON "public"."feed_likes" FOR SELECT USING (true);


--
-- Name: ladder_challenges Public can read ladder challenges; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read ladder challenges" ON "public"."ladder_challenges" FOR SELECT USING (true);


--
-- Name: ladder_entries Public can read ladder entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read ladder entries" ON "public"."ladder_entries" FOR SELECT USING (true);


--
-- Name: ladder_matches Public can read ladder matches; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read ladder matches" ON "public"."ladder_matches" FOR SELECT USING (true);


--
-- Name: event_likes Public can read likes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read likes" ON "public"."event_likes" FOR SELECT USING (true);


--
-- Name: matches Public can read matches; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read matches" ON "public"."matches" FOR SELECT USING (true);


--
-- Name: open_play_sessions Public can read open play sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read open play sessions" ON "public"."open_play_sessions" FOR SELECT USING ((("is_active" = true) OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: opening_hours Public can read opening hours; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read opening hours" ON "public"."opening_hours" FOR SELECT USING (true);


--
-- Name: pricing_rules Public can read pricing; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read pricing" ON "public"."pricing_rules" FOR SELECT USING (true);


--
-- Name: season_standings Public can read season standings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read season standings" ON "public"."season_standings" FOR SELECT USING (true);


--
-- Name: seasons Public can read seasons; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read seasons" ON "public"."seasons" FOR SELECT USING (true);


--
-- Name: crew_session_signups Public can read signups; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read signups" ON "public"."crew_session_signups" FOR SELECT USING (true);


--
-- Name: standings Public can read standings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read standings" ON "public"."standings" FOR SELECT USING (true);


--
-- Name: community_stories Public can read stories; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read stories" ON "public"."community_stories" FOR SELECT USING (true);


--
-- Name: teams Public can read teams; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read teams" ON "public"."teams" FOR SELECT USING (true);


--
-- Name: membership_tier_pricing Public can read tier pricing; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read tier pricing" ON "public"."membership_tier_pricing" FOR SELECT USING (true);


--
-- Name: venue_courts Public can read venue courts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read venue courts" ON "public"."venue_courts" FOR SELECT USING (true);


--
-- Name: venue_event_categories Public can read venue event categories; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public can read venue event categories" ON "public"."venue_event_categories" FOR SELECT USING (true);


--
-- Name: membership_entitlements Public read membership_entitlements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public read membership_entitlements" ON "public"."membership_entitlements" FOR SELECT TO "authenticated", "anon" USING (true);


--
-- Name: score_events Public read score events; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public read score events" ON "public"."score_events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."score_sessions" "s"
  WHERE (("s"."id" = "score_events"."score_session_id") AND ("s"."status" = ANY (ARRAY['draft'::"text", 'live'::"text", 'completed'::"text"]))))));


--
-- Name: score_matches Public read score matches; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public read score matches" ON "public"."score_matches" FOR SELECT USING (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text"])));


--
-- Name: score_players Public read score players; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public read score players" ON "public"."score_players" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."score_sessions" "s"
  WHERE (("s"."id" = "score_players"."score_session_id") AND ("s"."status" = ANY (ARRAY['draft'::"text", 'live'::"text", 'completed'::"text"]))))));


--
-- Name: score_sessions Public read score sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public read score sessions" ON "public"."score_sessions" FOR SELECT USING (("status" = ANY (ARRAY['draft'::"text", 'live'::"text", 'completed'::"text"])));


--
-- Name: score_turns Public read score turns; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Public read score turns" ON "public"."score_turns" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."score_matches" "m"
  WHERE (("m"."id" = "score_turns"."match_id") AND ("m"."status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text"]))))));


--
-- Name: chat_messages Read messages in accessible rooms; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Read messages in accessible rooms" ON "public"."chat_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."chat_rooms" "r"
  WHERE (("r"."id" = "chat_messages"."room_id") AND (("r"."is_public" = true) OR (EXISTS ( SELECT 1
           FROM "public"."chat_participants" "cp"
          WHERE (("cp"."room_id" = "r"."id") AND ("cp"."user_id" = "auth"."uid"()) AND (("cp"."visible_from" IS NULL) OR ("chat_messages"."created_at" >= "cp"."visible_from"))))))))));


--
-- Name: community_feed Service role inserts feed; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role inserts feed" ON "public"."community_feed" FOR INSERT WITH CHECK (false);


--
-- Name: booking_receipts Service role manages booking receipts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages booking receipts" ON "public"."booking_receipts" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: capacity_holds Service role manages capacity holds; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages capacity holds" ON "public"."capacity_holds" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: commerce_order_lines Service role manages commerce order lines; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages commerce order lines" ON "public"."commerce_order_lines" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: commerce_orders Service role manages commerce orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages commerce orders" ON "public"."commerce_orders" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: commerce_receipt_lines Service role manages commerce receipt lines; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages commerce receipt lines" ON "public"."commerce_receipt_lines" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: display_devices Service role manages display devices; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages display devices" ON "public"."display_devices" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: event_communications Service role manages event communications; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages event communications" ON "public"."event_communications" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: ops_agent_runs Service role manages ops agent runs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages ops agent runs" ON "public"."ops_agent_runs" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: ops_client_events Service role manages ops client events; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages ops client events" ON "public"."ops_client_events" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: product_relationships Service role manages product relationships; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages product relationships" ON "public"."product_relationships" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: score_events Service role manages score events; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages score events" ON "public"."score_events" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: score_matches Service role manages score matches; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages score matches" ON "public"."score_matches" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: score_player_links Service role manages score player links; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages score player links" ON "public"."score_player_links" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: score_players Service role manages score players; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages score players" ON "public"."score_players" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: score_sessions Service role manages score sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages score sessions" ON "public"."score_sessions" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: score_turns Service role manages score turns; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service role manages score turns" ON "public"."score_turns" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: day_pass_shares Service updates shares; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Service updates shares" ON "public"."day_pass_shares" FOR UPDATE TO "authenticated" USING ((("shared_by" = "auth"."uid"()) OR ("claimed_by" = "auth"."uid"()) OR "public"."is_super_admin"()));


--
-- Name: day_passes Staff can create day passes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff can create day passes" ON "public"."day_passes" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: community_stories Staff can create stories; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff can create stories" ON "public"."community_stories" FOR INSERT WITH CHECK (("public"."is_super_admin"() OR (("venue_id" IS NOT NULL) AND "public"."is_venue_member"("auth"."uid"(), "venue_id"))));


--
-- Name: community_stories Staff can delete stories; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff can delete stories" ON "public"."community_stories" FOR DELETE USING ((("created_by" = "auth"."uid"()) OR "public"."is_super_admin"() OR (("venue_id" IS NOT NULL) AND "public"."is_venue_member"("auth"."uid"(), "venue_id"))));


--
-- Name: activity_session_hosts Staff can read activity session hosts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff can read activity session hosts" ON "public"."activity_session_hosts" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."user_id" = "auth"."uid"()) AND ("vs"."venue_id" = "activity_session_hosts"."venue_id") AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "activity_session_hosts"."customer_id") AND ("c"."auth_user_id" = "auth"."uid"()))))));


--
-- Name: booking_participant_invites Staff can read booking participant invites; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff can read booking participant invites" ON "public"."booking_participant_invites" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff"
  WHERE (("venue_staff"."user_id" = "auth"."uid"()) AND ("venue_staff"."venue_id" = "booking_participant_invites"."venue_id") AND ("venue_staff"."is_active" = true)))) OR "public"."is_super_admin"()));


--
-- Name: venue_staff Staff can read own venue staff; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff can read own venue staff" ON "public"."venue_staff" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id") OR ("user_id" = "auth"."uid"())));


--
-- Name: push_subscriptions Staff can read venue push subscriptions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff can read venue push subscriptions" ON "public"."push_subscriptions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."venue_staff"
  WHERE (("venue_staff"."user_id" = "auth"."uid"()) AND ("venue_staff"."venue_id" = "push_subscriptions"."venue_id") AND ("venue_staff"."is_active" = true)))));


--
-- Name: ledger_entries Staff can view venue ledger_entries; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff can view venue ledger_entries" ON "public"."ledger_entries" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['super_admin'::"public"."app_role", 'venue_admin'::"public"."app_role"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."user_id" = "auth"."uid"()) AND ("vs"."venue_id" = "ledger_entries"."venue_id") AND ("vs"."is_active" = true))))));


--
-- Name: zettle_purchases Staff can view zettle_purchases; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff can view zettle_purchases" ON "public"."zettle_purchases" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff"
  WHERE (("venue_staff"."user_id" = "auth"."uid"()) AND ("venue_staff"."venue_id" = "zettle_purchases"."venue_id") AND ("venue_staff"."is_active" = true) AND ("venue_staff"."role" = ANY (ARRAY['super_admin'::"public"."app_role", 'venue_admin'::"public"."app_role"]))))) OR "public"."is_super_admin"()));


--
-- Name: memberships Staff manages memberships; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff manages memberships" ON "public"."memberships" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: venue_checkins Staff manages venue checkins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Staff manages venue checkins" ON "public"."venue_checkins" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: investor_leads Super admin can delete investor leads; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Super admin can delete investor leads" ON "public"."investor_leads" FOR DELETE TO "authenticated" USING ("public"."is_super_admin"());


--
-- Name: venues Super admin can manage venues; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Super admin can manage venues" ON "public"."venues" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());


--
-- Name: investor_leads Super admin can read investor leads; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Super admin can read investor leads" ON "public"."investor_leads" FOR SELECT TO "authenticated" USING ("public"."is_super_admin"());


--
-- Name: investor_leads Super admin can update investor leads; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Super admin can update investor leads" ON "public"."investor_leads" FOR UPDATE TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());


--
-- Name: open_play_sessions Super admin manages open play sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Super admin manages open play sessions" ON "public"."open_play_sessions" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());


--
-- Name: player_profiles Super admin manages profiles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Super admin manages profiles" ON "public"."player_profiles" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());


--
-- Name: user_roles Super admin manages roles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Super admin manages roles" ON "public"."user_roles" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());


--
-- Name: event_templates Super admin manages templates; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Super admin manages templates" ON "public"."event_templates" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());


--
-- Name: wellness_receipt_profiles Super admins read wellness receipt profiles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Super admins read wellness receipt profiles" ON "public"."wellness_receipt_profiles" FOR SELECT TO "authenticated" USING ("public"."is_super_admin"());


--
-- Name: booking_participants Users and staff can read booking participants; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users and staff can read booking participants" ON "public"."booking_participants" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."bookings"
  WHERE (("bookings"."id" = "booking_participants"."booking_id") AND ("bookings"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."venue_staff"
  WHERE (("venue_staff"."user_id" = "auth"."uid"()) AND ("venue_staff"."venue_id" = "booking_participants"."venue_id") AND ("venue_staff"."is_active" = true)))) OR "public"."is_super_admin"()));


--
-- Name: player_profiles Users and staff can read player profiles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users and staff can read player profiles" ON "public"."player_profiles" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "auth_user_id") OR "public"."is_super_admin"() OR "public"."is_any_active_venue_staff"("auth"."uid"())));


--
-- Name: forum_post_signups Users can cancel own signup; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can cancel own signup" ON "public"."forum_post_signups" FOR DELETE TO "authenticated" USING (("player_profile_id" = "public"."get_player_profile_id"("auth"."uid"())));


--
-- Name: comment_votes Users can change comment vote; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can change comment vote" ON "public"."comment_votes" FOR UPDATE TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));


--
-- Name: forum_poll_votes Users can change vote; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can change vote" ON "public"."forum_poll_votes" FOR DELETE TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));


--
-- Name: post_votes Users can change vote; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can change vote" ON "public"."post_votes" FOR UPDATE TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));


--
-- Name: chat_participants Users can join chat rooms; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can join chat rooms" ON "public"."chat_participants" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: feed_likes Users can like posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can like posts" ON "public"."feed_likes" FOR INSERT WITH CHECK (("auth_user_id" = "auth"."uid"()));


--
-- Name: user_roles Users can read own roles; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can read own roles" ON "public"."user_roles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"()));


--
-- Name: comment_votes Users can remove comment vote; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can remove comment vote" ON "public"."comment_votes" FOR DELETE TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));


--
-- Name: post_votes Users can remove vote; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can remove vote" ON "public"."post_votes" FOR DELETE TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));


--
-- Name: forum_post_signups Users can sign up for posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can sign up for posts" ON "public"."forum_post_signups" FOR INSERT TO "authenticated" WITH CHECK (("player_profile_id" = "public"."get_player_profile_id"("auth"."uid"())));


--
-- Name: feed_likes Users can unlike own likes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can unlike own likes" ON "public"."feed_likes" FOR DELETE USING (("auth_user_id" = "auth"."uid"()));


--
-- Name: post_votes Users can vote; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can vote" ON "public"."post_votes" FOR INSERT TO "authenticated" WITH CHECK (("auth_user_id" = "auth"."uid"()));


--
-- Name: comment_votes Users can vote on comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can vote on comments" ON "public"."comment_votes" FOR INSERT TO "authenticated" WITH CHECK (("auth_user_id" = "auth"."uid"()));


--
-- Name: activity_session_interests Users create own activity interests; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users create own activity interests" ON "public"."activity_session_interests" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: bookings Users create own bookings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users create own bookings" ON "public"."bookings" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: day_pass_shares Users create shares; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users create shares" ON "public"."day_pass_shares" FOR INSERT TO "authenticated" WITH CHECK (("shared_by" = "auth"."uid"()));


--
-- Name: activity_session_interests Users delete own activity interests; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users delete own activity interests" ON "public"."activity_session_interests" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: event_likes Users delete own likes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users delete own likes" ON "public"."event_likes" FOR DELETE TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));


--
-- Name: event_likes Users manage own likes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users manage own likes" ON "public"."event_likes" FOR INSERT TO "authenticated" WITH CHECK (("auth_user_id" = "auth"."uid"()));


--
-- Name: player_profiles Users manage own profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users manage own profile" ON "public"."player_profiles" TO "authenticated" USING (("auth_user_id" = "auth"."uid"())) WITH CHECK (("auth_user_id" = "auth"."uid"()));


--
-- Name: push_subscriptions Users manage own push subscriptions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users manage own push subscriptions" ON "public"."push_subscriptions" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: wellness_receipt_profiles Users manage own wellness receipt profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users manage own wellness receipt profile" ON "public"."wellness_receipt_profiles" TO "authenticated" USING (("auth_user_id" = "auth"."uid"())) WITH CHECK (("auth_user_id" = "auth"."uid"()));


--
-- Name: access_entitlements Users read own access entitlements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own access entitlements" ON "public"."access_entitlements" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: activity_session_interests Users read own activity interests; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own activity interests" ON "public"."activity_session_interests" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: bookings Users read own bookings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: chat_participants Users read own chat participation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own chat participation" ON "public"."chat_participants" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));


--
-- Name: day_passes Users read own day passes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own day passes" ON "public"."day_passes" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: day_pass_grants Users read own grants; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own grants" ON "public"."day_pass_grants" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."memberships" "m"
  WHERE (("m"."id" = "day_pass_grants"."membership_id") AND ("m"."user_id" = "auth"."uid"())))) OR "public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: memberships Users read own membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own membership" ON "public"."memberships" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: session_registrations Users read own session registrations; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own session registrations" ON "public"."session_registrations" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: day_pass_shares Users read own shares; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own shares" ON "public"."day_pass_shares" FOR SELECT TO "authenticated" USING ((("shared_by" = "auth"."uid"()) OR ("claimed_by" = "auth"."uid"()) OR "public"."is_super_admin"()));


--
-- Name: membership_usage Users read own usage; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own usage" ON "public"."membership_usage" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."venue_staff"
  WHERE (("venue_staff"."user_id" = "auth"."uid"()) AND ("venue_staff"."venue_id" = "membership_usage"."venue_id") AND ("venue_staff"."is_active" = true))))));


--
-- Name: access_vouchers Users read own vouchers; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own vouchers" ON "public"."access_vouchers" FOR SELECT TO "authenticated" USING ((("purchaser_user_id" = "auth"."uid"()) OR ("claimed_by_user_id" = "auth"."uid"()) OR "public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: venues Venue admin can update own venue; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue admin can update own venue" ON "public"."venues" FOR UPDATE TO "authenticated" USING ("public"."is_venue_admin"("auth"."uid"(), "id"));


--
-- Name: activity_session_hosts Venue admins can manage activity session hosts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue admins can manage activity session hosts" ON "public"."activity_session_hosts" TO "authenticated" USING (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."user_id" = "auth"."uid"()) AND ("vs"."venue_id" = "activity_session_hosts"."venue_id") AND ("vs"."is_active" = true) AND ("vs"."role" = 'venue_admin'::"public"."app_role")))))) WITH CHECK (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."user_id" = "auth"."uid"()) AND ("vs"."venue_id" = "activity_session_hosts"."venue_id") AND ("vs"."is_active" = true) AND ("vs"."role" = 'venue_admin'::"public"."app_role"))))));


--
-- Name: access_entitlements Venue staff can manage access entitlements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff can manage access entitlements" ON "public"."access_entitlements" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: access_products Venue staff can manage access products; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff can manage access products" ON "public"."access_products" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: activity_series Venue staff can manage activity series; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff can manage activity series" ON "public"."activity_series" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: activity_sessions Venue staff can manage activity sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff can manage activity sessions" ON "public"."activity_sessions" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: open_play_sessions Venue staff can manage open play sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff can manage open play sessions" ON "public"."open_play_sessions" TO "authenticated" USING ("public"."is_venue_member"("auth"."uid"(), "venue_id")) WITH CHECK ("public"."is_venue_member"("auth"."uid"(), "venue_id"));


--
-- Name: session_registrations Venue staff can manage session registrations; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff can manage session registrations" ON "public"."session_registrations" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: access_vouchers Venue staff can manage vouchers; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff can manage vouchers" ON "public"."access_vouchers" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: venue_checkins Venue staff can read all checkins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff can read all checkins" ON "public"."venue_checkins" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff"
  WHERE (("venue_staff"."user_id" = "auth"."uid"()) AND ("venue_staff"."venue_id" = "venue_checkins"."venue_id") AND ("venue_staff"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: corporate_accounts Venue staff can read corporate accounts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff can read corporate accounts" ON "public"."corporate_accounts" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff"
  WHERE (("venue_staff"."user_id" = "auth"."uid"()) AND ("venue_staff"."venue_id" = "corporate_accounts"."venue_id") AND ("venue_staff"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: corporate_orders Venue staff can read corporate orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff can read corporate orders" ON "public"."corporate_orders" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff"
  WHERE (("venue_staff"."user_id" = "auth"."uid"()) AND ("venue_staff"."venue_id" = "corporate_orders"."venue_id") AND ("venue_staff"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: ops_check_state Venue staff manage ops check state; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff manage ops check state" ON "public"."ops_check_state" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: ops_incidents Venue staff manage ops incidents; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff manage ops incidents" ON "public"."ops_incidents" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: ops_signals Venue staff manage ops signals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff manage ops signals" ON "public"."ops_signals" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: score_events Venue staff manage score events; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff manage score events" ON "public"."score_events" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."score_sessions" "s"
  WHERE (("s"."id" = "score_events"."score_session_id") AND ("public"."is_venue_member"("auth"."uid"(), "s"."venue_id") OR "public"."is_super_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."score_sessions" "s"
  WHERE (("s"."id" = "score_events"."score_session_id") AND ("public"."is_venue_member"("auth"."uid"(), "s"."venue_id") OR "public"."is_super_admin"())))));


--
-- Name: score_matches Venue staff manage score matches; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff manage score matches" ON "public"."score_matches" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: score_players Venue staff manage score players; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff manage score players" ON "public"."score_players" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."score_sessions" "s"
  WHERE (("s"."id" = "score_players"."score_session_id") AND ("public"."is_venue_member"("auth"."uid"(), "s"."venue_id") OR "public"."is_super_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."score_sessions" "s"
  WHERE (("s"."id" = "score_players"."score_session_id") AND ("public"."is_venue_member"("auth"."uid"(), "s"."venue_id") OR "public"."is_super_admin"())))));


--
-- Name: score_sessions Venue staff manage score sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff manage score sessions" ON "public"."score_sessions" TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: score_turns Venue staff manage score turns; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff manage score turns" ON "public"."score_turns" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."score_matches" "m"
  WHERE (("m"."id" = "score_turns"."match_id") AND ("public"."is_venue_member"("auth"."uid"(), "m"."venue_id") OR "public"."is_super_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."score_matches" "m"
  WHERE (("m"."id" = "score_turns"."match_id") AND ("public"."is_venue_member"("auth"."uid"(), "m"."venue_id") OR "public"."is_super_admin"())))));


--
-- Name: capacity_holds Venue staff read capacity holds; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff read capacity holds" ON "public"."capacity_holds" FOR SELECT TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: display_devices Venue staff read display devices; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff read display devices" ON "public"."display_devices" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "display_devices"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))));


--
-- Name: event_communications Venue staff read event communications; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff read event communications" ON "public"."event_communications" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."events" "e"
     JOIN "public"."venue_staff" "vs" ON (("vs"."venue_id" = "e"."venue_id")))
  WHERE (("e"."id" = "event_communications"."event_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))));


--
-- Name: ops_agent_runs Venue staff read ops agent runs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff read ops agent runs" ON "public"."ops_agent_runs" FOR SELECT TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: ops_check_state Venue staff read ops check state; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff read ops check state" ON "public"."ops_check_state" FOR SELECT TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: ops_client_events Venue staff read ops client events; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff read ops client events" ON "public"."ops_client_events" FOR SELECT TO "authenticated" USING ((("venue_id" IS NULL) OR "public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: ops_incidents Venue staff read ops incidents; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff read ops incidents" ON "public"."ops_incidents" FOR SELECT TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: ops_signals Venue staff read ops signals; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff read ops signals" ON "public"."ops_signals" FOR SELECT TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: score_player_links Venue staff read score player links; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff read score player links" ON "public"."score_player_links" FOR SELECT TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: corporate_accounts Venue staff reads corporate accounts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff reads corporate accounts" ON "public"."corporate_accounts" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: corporate_orders Venue staff reads corporate orders; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff reads corporate orders" ON "public"."corporate_orders" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: corporate_packages Venue staff reads corporate packages; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff reads corporate packages" ON "public"."corporate_packages" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id")));


--
-- Name: activity_session_interests Venue staff update activity interests; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Venue staff update activity interests" ON "public"."activity_session_interests" FOR UPDATE TO "authenticated" USING (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"())) WITH CHECK (("public"."is_venue_member"("auth"."uid"(), "venue_id") OR "public"."is_super_admin"()));


--
-- Name: access_entitlements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."access_entitlements" ENABLE ROW LEVEL SECURITY;

--
-- Name: access_products; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."access_products" ENABLE ROW LEVEL SECURITY;

--
-- Name: access_vouchers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."access_vouchers" ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_series; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."activity_series" ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_session_hosts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."activity_session_hosts" ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_session_interests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."activity_session_interests" ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_session_overrides; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."activity_session_overrides" ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_session_overrides activity_session_overrides_public_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "activity_session_overrides_public_read" ON "public"."activity_session_overrides" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."venues" "v"
  WHERE (("v"."id" = "activity_session_overrides"."venue_id") AND ("v"."is_public" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "activity_session_overrides"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: activity_session_overrides activity_session_overrides_staff_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "activity_session_overrides_staff_write" ON "public"."activity_session_overrides" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "activity_session_overrides"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role")))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "activity_session_overrides"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: activity_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."activity_sessions" ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_scoped_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "audit_log_scoped_read" ON "public"."audit_log" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR (("venue_id" IS NOT NULL) AND "public"."is_venue_admin"("auth"."uid"(), "venue_id")) OR (("organization_id" IS NOT NULL) AND "public"."is_organization_admin"("auth"."uid"(), "organization_id"))));


--
-- Name: audit_log audit_log_service_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "audit_log_service_insert" ON "public"."audit_log" FOR INSERT TO "service_role" WITH CHECK (true);


--
-- Name: booking_participant_invites; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."booking_participant_invites" ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_participants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."booking_participants" ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_receipts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."booking_receipts" ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;

--
-- Name: capacity_holds; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."capacity_holds" ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages chat_messages_update_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "chat_messages_update_own" ON "public"."chat_messages" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: chat_participants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."chat_participants" ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_participants chat_participants_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "chat_participants_own" ON "public"."chat_participants" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: chat_reactions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."chat_reactions" ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_rooms; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."chat_rooms" ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_rooms chat_rooms_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "chat_rooms_insert" ON "public"."chat_rooms" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));


--
-- Name: chat_rooms chat_rooms_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "chat_rooms_select" ON "public"."chat_rooms" FOR SELECT TO "authenticated" USING ((("is_public" = true) OR (("room_type" = 'booking'::"text") AND ("resource_id" IS NOT NULL) AND ("resource_id" IN ( SELECT "bookings"."booking_ref"
   FROM "public"."bookings"
  WHERE ("bookings"."user_id" = "auth"."uid"())))) OR ("id" IN ( SELECT "chat_participants"."room_id"
   FROM "public"."chat_participants"
  WHERE ("chat_participants"."user_id" = "auth"."uid"())))));


--
-- Name: chat_rooms chat_rooms_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "chat_rooms_update" ON "public"."chat_rooms" FOR UPDATE TO "authenticated" USING (("auth"."uid"() IS NOT NULL));


--
-- Name: comment_votes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."comment_votes" ENABLE ROW LEVEL SECURITY;

--
-- Name: commerce_order_lines; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."commerce_order_lines" ENABLE ROW LEVEL SECURITY;

--
-- Name: commerce_orders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."commerce_orders" ENABLE ROW LEVEL SECURITY;

--
-- Name: commerce_receipt_lines; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."commerce_receipt_lines" ENABLE ROW LEVEL SECURITY;

--
-- Name: community_feed; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."community_feed" ENABLE ROW LEVEL SECURITY;

--
-- Name: community_stories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."community_stories" ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_accounts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."corporate_accounts" ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."corporate_members" ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_order_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."corporate_order_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_orders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."corporate_orders" ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_packages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."corporate_packages" ENABLE ROW LEVEL SECURITY;

--
-- Name: courts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."courts" ENABLE ROW LEVEL SECURITY;

--
-- Name: crew_challenges; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."crew_challenges" ENABLE ROW LEVEL SECURITY;

--
-- Name: crew_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."crew_members" ENABLE ROW LEVEL SECURITY;

--
-- Name: crew_session_signups; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."crew_session_signups" ENABLE ROW LEVEL SECURITY;

--
-- Name: crew_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."crew_sessions" ENABLE ROW LEVEL SECURITY;

--
-- Name: crews; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."crews" ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_identities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."customer_identities" ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_identities customer_identities_org_admin_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "customer_identities_org_admin_write" ON "public"."customer_identities" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_organization_admin"("auth"."uid"(), "organization_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_organization_admin"("auth"."uid"(), "organization_id")));


--
-- Name: customer_identities customer_identities_self_and_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "customer_identities_self_and_staff_read" ON "public"."customer_identities" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_organization_member"("auth"."uid"(), "organization_id") OR (EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_identities"."customer_id") AND ("c"."auth_user_id" = "auth"."uid"()))))));


--
-- Name: customer_venue_profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."customer_venue_profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_venue_profiles customer_venue_profiles_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "customer_venue_profiles_staff_read" ON "public"."customer_venue_profiles" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_member"("auth"."uid"(), "venue_id") OR (EXISTS ( SELECT 1
   FROM "public"."venues" "v"
  WHERE (("v"."id" = "customer_venue_profiles"."venue_id") AND "public"."is_organization_member"("auth"."uid"(), "v"."organization_id")))) OR (EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_venue_profiles"."customer_id") AND ("c"."auth_user_id" = "auth"."uid"()))))));


--
-- Name: customer_venue_profiles customer_venue_profiles_staff_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "customer_venue_profiles_staff_write" ON "public"."customer_venue_profiles" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id") OR (EXISTS ( SELECT 1
   FROM "public"."venues" "v"
  WHERE (("v"."id" = "customer_venue_profiles"."venue_id") AND "public"."is_organization_admin"("auth"."uid"(), "v"."organization_id")))))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_venue_admin"("auth"."uid"(), "venue_id") OR (EXISTS ( SELECT 1
   FROM "public"."venues" "v"
  WHERE (("v"."id" = "customer_venue_profiles"."venue_id") AND "public"."is_organization_admin"("auth"."uid"(), "v"."organization_id"))))));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_org_admin_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "customers_org_admin_write" ON "public"."customers" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_organization_admin"("auth"."uid"(), "organization_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_organization_admin"("auth"."uid"(), "organization_id")));


--
-- Name: customers customers_self_and_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "customers_self_and_staff_read" ON "public"."customers" FOR SELECT TO "authenticated" USING ((("auth_user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_organization_member"("auth"."uid"(), "organization_id")));


--
-- Name: customers customers_self_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "customers_self_update" ON "public"."customers" FOR UPDATE TO "authenticated" USING (("auth_user_id" = "auth"."uid"())) WITH CHECK (("auth_user_id" = "auth"."uid"()));


--
-- Name: day_pass_grants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."day_pass_grants" ENABLE ROW LEVEL SECURITY;

--
-- Name: day_pass_shares; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."day_pass_shares" ENABLE ROW LEVEL SECURITY;

--
-- Name: day_passes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."day_passes" ENABLE ROW LEVEL SECURITY;

--
-- Name: display_devices; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."display_devices" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_checkins; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_checkins" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_communications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_communications" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_courts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_courts" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_followups; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_followups" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_followups event_followups_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_followups_staff_read" ON "public"."event_followups" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_followups"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: event_lead_activities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_lead_activities" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_lead_activities event_lead_activities_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_lead_activities_staff_read" ON "public"."event_lead_activities" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_lead_activities"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: event_leads; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_leads" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_leads event_leads_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_leads_staff_read" ON "public"."event_leads" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_leads"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: event_likes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_likes" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_offer_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_offer_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_offer_items event_offer_items_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_offer_items_staff_read" ON "public"."event_offer_items" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_offer_items"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: event_offer_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_offer_templates" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_offer_templates event_offer_templates_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_offer_templates_staff_read" ON "public"."event_offer_templates" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_offer_templates"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: event_offers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_offers" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_offers event_offers_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_offers_staff_read" ON "public"."event_offers" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_offers"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: event_resource_allocations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_resource_allocations" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_resource_allocations event_resource_allocations_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_resource_allocations_staff_read" ON "public"."event_resource_allocations" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_resource_allocations"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: event_resource_blocks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_resource_blocks" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_resource_blocks event_resource_blocks_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_resource_blocks_staff_read" ON "public"."event_resource_blocks" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_resource_blocks"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: event_resource_blocks event_resource_blocks_staff_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_resource_blocks_staff_write" ON "public"."event_resource_blocks" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_resource_blocks"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role")))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_resource_blocks"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: event_resource_catalog; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_resource_catalog" ENABLE ROW LEVEL SECURITY;

--
-- Name: event_resource_catalog event_resource_catalog_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "event_resource_catalog_staff_read" ON "public"."event_resource_catalog" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "event_resource_catalog"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: event_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."event_templates" ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;

--
-- Name: feed_likes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."feed_likes" ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_poll_options; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."forum_poll_options" ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_poll_votes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."forum_poll_votes" ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_post_signups; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."forum_post_signups" ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_posts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."forum_posts" ENABLE ROW LEVEL SECURITY;

--
-- Name: franchisees; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."franchisees" ENABLE ROW LEVEL SECURITY;

--
-- Name: franchisees franchisees_org_admin_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "franchisees_org_admin_write" ON "public"."franchisees" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_organization_admin"("auth"."uid"(), "organization_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_organization_admin"("auth"."uid"(), "organization_id")));


--
-- Name: franchisees franchisees_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "franchisees_staff_read" ON "public"."franchisees" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_organization_member"("auth"."uid"(), "organization_id")));


--
-- Name: investor_assets; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."investor_assets" ENABLE ROW LEVEL SECURITY;

--
-- Name: investor_assets investor_assets_public_active_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "investor_assets_public_active_read" ON "public"."investor_assets" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));


--
-- Name: investor_assets investor_assets_super_admin_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "investor_assets_super_admin_write" ON "public"."investor_assets" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());


--
-- Name: investor_leads; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."investor_leads" ENABLE ROW LEVEL SECURITY;

--
-- Name: investor_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."investor_settings" ENABLE ROW LEVEL SECURITY;

--
-- Name: investor_settings investor_settings_super_admin_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "investor_settings_super_admin_read" ON "public"."investor_settings" FOR SELECT TO "authenticated" USING ("public"."is_super_admin"());


--
-- Name: investor_settings investor_settings_super_admin_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "investor_settings_super_admin_write" ON "public"."investor_settings" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());


--
-- Name: ladder_challenges; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ladder_challenges" ENABLE ROW LEVEL SECURITY;

--
-- Name: ladder_entries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ladder_entries" ENABLE ROW LEVEL SECURITY;

--
-- Name: ladder_matches; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ladder_matches" ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_entries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ledger_entries" ENABLE ROW LEVEL SECURITY;

--
-- Name: matches; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."matches" ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_entitlements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."membership_entitlements" ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_tier_pricing; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."membership_tier_pricing" ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_tiers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."membership_tiers" ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_usage; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."membership_usage" ENABLE ROW LEVEL SECURITY;

--
-- Name: memberships; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."memberships" ENABLE ROW LEVEL SECURITY;

--
-- Name: open_play_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."open_play_sessions" ENABLE ROW LEVEL SECURITY;

--
-- Name: opening_hours; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."opening_hours" ENABLE ROW LEVEL SECURITY;

--
-- Name: operations_integration_health; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."operations_integration_health" ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_agent_runs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ops_agent_runs" ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_check_state; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ops_check_state" ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_client_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ops_client_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_incidents; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ops_incidents" ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_signals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ops_signals" ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members organization_members_org_admin_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "organization_members_org_admin_write" ON "public"."organization_members" TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_organization_admin"("auth"."uid"(), "organization_id"))) WITH CHECK (("public"."is_super_admin"() OR "public"."is_organization_admin"("auth"."uid"(), "organization_id")));


--
-- Name: organization_members organization_members_self_and_admin_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "organization_members_self_and_admin_read" ON "public"."organization_members" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_organization_admin"("auth"."uid"(), "organization_id")));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "organizations_staff_read" ON "public"."organizations" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR "public"."is_organization_member"("auth"."uid"(), "id")));


--
-- Name: organizations organizations_super_admin_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "organizations_super_admin_write" ON "public"."organizations" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());


--
-- Name: player_profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."player_profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: players; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;

--
-- Name: post_comments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."post_comments" ENABLE ROW LEVEL SECURITY;

--
-- Name: post_votes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."post_votes" ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_rules; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."pricing_rules" ENABLE ROW LEVEL SECURITY;

--
-- Name: product_relationships; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."product_relationships" ENABLE ROW LEVEL SECURITY;

--
-- Name: pulse_tokens; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."pulse_tokens" ENABLE ROW LEVEL SECURITY;

--
-- Name: pulse_tokens pulse_tokens_service_only; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "pulse_tokens_service_only" ON "public"."pulse_tokens" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_reactions reactions_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reactions_delete" ON "public"."chat_reactions" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));


--
-- Name: chat_reactions reactions_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reactions_insert" ON "public"."chat_reactions" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: chat_reactions reactions_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "reactions_select" ON "public"."chat_reactions" FOR SELECT TO "authenticated" USING (true);


--
-- Name: score_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."score_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: score_matches; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."score_matches" ENABLE ROW LEVEL SECURITY;

--
-- Name: score_player_links; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."score_player_links" ENABLE ROW LEVEL SECURITY;

--
-- Name: score_players; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."score_players" ENABLE ROW LEVEL SECURITY;

--
-- Name: score_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."score_sessions" ENABLE ROW LEVEL SECURITY;

--
-- Name: score_turns; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."score_turns" ENABLE ROW LEVEL SECURITY;

--
-- Name: season_standings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."season_standings" ENABLE ROW LEVEL SECURITY;

--
-- Name: seasons; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."seasons" ENABLE ROW LEVEL SECURITY;

--
-- Name: session_registrations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."session_registrations" ENABLE ROW LEVEL SECURITY;

--
-- Name: standings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."standings" ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."stripe_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_checkins; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."venue_checkins" ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_courts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."venue_courts" ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_event_categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."venue_event_categories" ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_links; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."venue_links" ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_operation_overrides; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."venue_operation_overrides" ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_operation_overrides venue_operation_overrides_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "venue_operation_overrides_staff_read" ON "public"."venue_operation_overrides" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "venue_operation_overrides"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: venue_operation_overrides venue_operation_overrides_staff_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "venue_operation_overrides_staff_write" ON "public"."venue_operation_overrides" USING (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "venue_operation_overrides"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role")))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."venue_staff" "vs"
  WHERE (("vs"."venue_id" = "venue_operation_overrides"."venue_id") AND ("vs"."user_id" = "auth"."uid"()) AND ("vs"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'super_admin'::"public"."app_role"))))));


--
-- Name: venue_staff; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."venue_staff" ENABLE ROW LEVEL SECURITY;

--
-- Name: venues; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."venues" ENABLE ROW LEVEL SECURITY;

--
-- Name: wellness_receipt_profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."wellness_receipt_profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: zettle_connections; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."zettle_connections" ENABLE ROW LEVEL SECURITY;

--
-- Name: zettle_purchases; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."zettle_purchases" ENABLE ROW LEVEL SECURITY;

--
-- Name: FUNCTION "acquire_capacity_hold"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_capacity" integer, "p_user_id" "uuid", "p_customer_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_idempotency_key" "text", "p_metadata" "jsonb", "p_ttl_seconds" integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."acquire_capacity_hold"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_capacity" integer, "p_user_id" "uuid", "p_customer_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_idempotency_key" "text", "p_metadata" "jsonb", "p_ttl_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."acquire_capacity_hold"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_capacity" integer, "p_user_id" "uuid", "p_customer_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_idempotency_key" "text", "p_metadata" "jsonb", "p_ttl_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."acquire_capacity_hold"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_capacity" integer, "p_user_id" "uuid", "p_customer_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_idempotency_key" "text", "p_metadata" "jsonb", "p_ttl_seconds" integer) TO "service_role";


--
-- Name: FUNCTION "attach_capacity_hold_stripe_session"("p_hold_id" "uuid", "p_stripe_session_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."attach_capacity_hold_stripe_session"("p_hold_id" "uuid", "p_stripe_session_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."attach_capacity_hold_stripe_session"("p_hold_id" "uuid", "p_stripe_session_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."attach_capacity_hold_stripe_session"("p_hold_id" "uuid", "p_stripe_session_id" "text") TO "service_role";


--
-- Name: FUNCTION "attach_commerce_order_stripe_session"("p_order_id" "uuid", "p_version" integer, "p_stripe_session_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."attach_commerce_order_stripe_session"("p_order_id" "uuid", "p_version" integer, "p_stripe_session_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."attach_commerce_order_stripe_session"("p_order_id" "uuid", "p_version" integer, "p_stripe_session_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."attach_commerce_order_stripe_session"("p_order_id" "uuid", "p_version" integer, "p_stripe_session_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."attach_commerce_order_stripe_session"("p_order_id" "uuid", "p_version" integer, "p_stripe_session_id" "text") TO "service_role";


--
-- Name: FUNCTION "cancel_booking_participant_capacity"("p_participant_id" "uuid", "p_actor_user_id" "uuid", "p_metadata" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."cancel_booking_participant_capacity"("p_participant_id" "uuid", "p_actor_user_id" "uuid", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_booking_participant_capacity"("p_participant_id" "uuid", "p_actor_user_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_booking_participant_capacity"("p_participant_id" "uuid", "p_actor_user_id" "uuid", "p_metadata" "jsonb") TO "service_role";


--
-- Name: FUNCTION "capacity_active_holds_count"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_exclude_hold_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."capacity_active_holds_count"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_exclude_hold_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."capacity_active_holds_count"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_exclude_hold_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."capacity_active_holds_count"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_exclude_hold_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "capacity_committed_count"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_exclude_registration_id" "uuid", "p_exclude_participant_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."capacity_committed_count"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_exclude_registration_id" "uuid", "p_exclude_participant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."capacity_committed_count"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_exclude_registration_id" "uuid", "p_exclude_participant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."capacity_committed_count"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_exclude_registration_id" "uuid", "p_exclude_participant_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "capacity_fill"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_capacity" integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."capacity_fill"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_capacity" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."capacity_fill"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_capacity" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."capacity_fill"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date", "p_capacity" integer) TO "service_role";


--
-- Name: FUNCTION "capacity_lock_scope"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."capacity_lock_scope"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."capacity_lock_scope"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."capacity_lock_scope"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_session_date" "date") TO "service_role";


--
-- Name: FUNCTION "capacity_scope_capacity"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_capacity" integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."capacity_scope_capacity"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_capacity" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."capacity_scope_capacity"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_capacity" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."capacity_scope_capacity"("p_venue_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_capacity" integer) TO "service_role";


--
-- Name: FUNCTION "commit_activity_registration_capacity"("p_venue_id" "uuid", "p_activity_session_id" "uuid", "p_session_date" "date", "p_user_id" "uuid", "p_customer_id" "uuid", "p_status" "text", "p_price_paid_sek" integer, "p_stripe_session_id" "text", "p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb", "p_hold_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."commit_activity_registration_capacity"("p_venue_id" "uuid", "p_activity_session_id" "uuid", "p_session_date" "date", "p_user_id" "uuid", "p_customer_id" "uuid", "p_status" "text", "p_price_paid_sek" integer, "p_stripe_session_id" "text", "p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb", "p_hold_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."commit_activity_registration_capacity"("p_venue_id" "uuid", "p_activity_session_id" "uuid", "p_session_date" "date", "p_user_id" "uuid", "p_customer_id" "uuid", "p_status" "text", "p_price_paid_sek" integer, "p_stripe_session_id" "text", "p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb", "p_hold_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."commit_activity_registration_capacity"("p_venue_id" "uuid", "p_activity_session_id" "uuid", "p_session_date" "date", "p_user_id" "uuid", "p_customer_id" "uuid", "p_status" "text", "p_price_paid_sek" integer, "p_stripe_session_id" "text", "p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb", "p_hold_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "commit_booking_participant_capacity"("p_venue_id" "uuid", "p_booking_id" "uuid", "p_booking_group_key" "text", "p_session_date" "date", "p_capacity" integer, "p_invite_id" "uuid", "p_customer_id" "uuid", "p_user_id" "uuid", "p_display_name" "text", "p_email" "text", "p_phone" "text", "p_role" "text", "p_price_minor" integer, "p_payment_status" "text", "p_payment_method" "text", "p_payment_stripe_session_id" "text", "p_booking_receipt_id" "uuid", "p_metadata" "jsonb", "p_hold_id" "uuid", "p_participant_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."commit_booking_participant_capacity"("p_venue_id" "uuid", "p_booking_id" "uuid", "p_booking_group_key" "text", "p_session_date" "date", "p_capacity" integer, "p_invite_id" "uuid", "p_customer_id" "uuid", "p_user_id" "uuid", "p_display_name" "text", "p_email" "text", "p_phone" "text", "p_role" "text", "p_price_minor" integer, "p_payment_status" "text", "p_payment_method" "text", "p_payment_stripe_session_id" "text", "p_booking_receipt_id" "uuid", "p_metadata" "jsonb", "p_hold_id" "uuid", "p_participant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."commit_booking_participant_capacity"("p_venue_id" "uuid", "p_booking_id" "uuid", "p_booking_group_key" "text", "p_session_date" "date", "p_capacity" integer, "p_invite_id" "uuid", "p_customer_id" "uuid", "p_user_id" "uuid", "p_display_name" "text", "p_email" "text", "p_phone" "text", "p_role" "text", "p_price_minor" integer, "p_payment_status" "text", "p_payment_method" "text", "p_payment_stripe_session_id" "text", "p_booking_receipt_id" "uuid", "p_metadata" "jsonb", "p_hold_id" "uuid", "p_participant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."commit_booking_participant_capacity"("p_venue_id" "uuid", "p_booking_id" "uuid", "p_booking_group_key" "text", "p_session_date" "date", "p_capacity" integer, "p_invite_id" "uuid", "p_customer_id" "uuid", "p_user_id" "uuid", "p_display_name" "text", "p_email" "text", "p_phone" "text", "p_role" "text", "p_price_minor" integer, "p_payment_status" "text", "p_payment_method" "text", "p_payment_stripe_session_id" "text", "p_booking_receipt_id" "uuid", "p_metadata" "jsonb", "p_hold_id" "uuid", "p_participant_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "enforce_commerce_order_lifecycle"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."enforce_commerce_order_lifecycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_commerce_order_lifecycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_commerce_order_lifecycle"() TO "service_role";


--
-- Name: FUNCTION "enforce_commerce_order_line_lifecycle"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."enforce_commerce_order_line_lifecycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_commerce_order_line_lifecycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_commerce_order_line_lifecycle"() TO "service_role";


--
-- Name: FUNCTION "enforce_one_vote_per_poll"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."enforce_one_vote_per_poll"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_one_vote_per_poll"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_one_vote_per_poll"() TO "service_role";


--
-- Name: FUNCTION "ensure_customer_identity_for_auth_user_safe"("_auth_user_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."ensure_customer_identity_for_auth_user_safe"("_auth_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_customer_identity_for_auth_user_safe"("_auth_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_customer_identity_for_auth_user_safe"("_auth_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_customer_identity_for_auth_user_safe"("_auth_user_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "finalize_commerce_payment"("p_order_id" "uuid", "p_order_version" integer, "p_stripe_session_id" "text", "p_payment_intent_id" "text", "p_customer_id" "uuid", "p_user_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_payment_method" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."finalize_commerce_payment"("p_order_id" "uuid", "p_order_version" integer, "p_stripe_session_id" "text", "p_payment_intent_id" "text", "p_customer_id" "uuid", "p_user_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_payment_method" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_commerce_payment"("p_order_id" "uuid", "p_order_version" integer, "p_stripe_session_id" "text", "p_payment_intent_id" "text", "p_customer_id" "uuid", "p_user_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_payment_method" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_commerce_payment"("p_order_id" "uuid", "p_order_version" integer, "p_stripe_session_id" "text", "p_payment_intent_id" "text", "p_customer_id" "uuid", "p_user_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_payment_method" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_commerce_payment"("p_order_id" "uuid", "p_order_version" integer, "p_stripe_session_id" "text", "p_payment_intent_id" "text", "p_customer_id" "uuid", "p_user_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_payment_method" "text") TO "service_role";


--
-- Name: FUNCTION "fn_bump_room_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."fn_bump_room_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_bump_room_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_bump_room_updated_at"() TO "service_role";


--
-- Name: FUNCTION "fn_display_devices_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."fn_display_devices_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_display_devices_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_display_devices_updated_at"() TO "service_role";


--
-- Name: FUNCTION "fn_event_communications_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."fn_event_communications_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_event_communications_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_event_communications_updated_at"() TO "service_role";


--
-- Name: FUNCTION "fn_generate_booking_receipt_number"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."fn_generate_booking_receipt_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_generate_booking_receipt_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_generate_booking_receipt_number"() TO "service_role";


--
-- Name: FUNCTION "fn_ops_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."fn_ops_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_ops_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_ops_updated_at"() TO "service_role";


--
-- Name: FUNCTION "fn_score_player_links_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."fn_score_player_links_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_score_player_links_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_score_player_links_updated_at"() TO "service_role";


--
-- Name: FUNCTION "fn_score_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."fn_score_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_score_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_score_updated_at"() TO "service_role";


--
-- Name: FUNCTION "freeze_commerce_order"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."freeze_commerce_order"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."freeze_commerce_order"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."freeze_commerce_order"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."freeze_commerce_order"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb") TO "service_role";


--
-- Name: FUNCTION "generate_booking_ref"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."generate_booking_ref"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_booking_ref"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_booking_ref"() TO "service_role";


--
-- Name: FUNCTION "generate_order_number"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."generate_order_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_order_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_order_number"() TO "service_role";


--
-- Name: FUNCTION "get_player_profile_id"("_user_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."get_player_profile_id"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_player_profile_id"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_player_profile_id"("_user_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "get_public_activity_session_hosts"("session_ids" "uuid"[]); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."get_public_activity_session_hosts"("session_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_activity_session_hosts"("session_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_activity_session_hosts"("session_ids" "uuid"[]) TO "service_role";


--
-- Name: FUNCTION "get_public_profile"("profile_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."get_public_profile"("profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_profile"("profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_profile"("profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_profile"("profile_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "get_venue_id_for_event"("_event_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."get_venue_id_for_event"("_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_venue_id_for_event"("_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_venue_id_for_event"("_event_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "handle_new_user"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


--
-- Name: FUNCTION "has_role"("_user_id" "uuid", "_role" "public"."app_role"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "service_role";


--
-- Name: FUNCTION "is_any_active_venue_staff"("_user_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."is_any_active_venue_staff"("_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_any_active_venue_staff"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_any_active_venue_staff"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_any_active_venue_staff"("_user_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "is_crew_leader"("_user_id" "uuid", "_crew_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."is_crew_leader"("_user_id" "uuid", "_crew_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_crew_leader"("_user_id" "uuid", "_crew_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_crew_leader"("_user_id" "uuid", "_crew_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "is_franchisee_admin"("_user_id" "uuid", "_franchisee_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."is_franchisee_admin"("_user_id" "uuid", "_franchisee_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_franchisee_admin"("_user_id" "uuid", "_franchisee_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_franchisee_admin"("_user_id" "uuid", "_franchisee_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "is_franchisee_member"("_user_id" "uuid", "_franchisee_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."is_franchisee_member"("_user_id" "uuid", "_franchisee_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_franchisee_member"("_user_id" "uuid", "_franchisee_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_franchisee_member"("_user_id" "uuid", "_franchisee_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "is_organization_admin"("_user_id" "uuid", "_organization_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."is_organization_admin"("_user_id" "uuid", "_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_organization_admin"("_user_id" "uuid", "_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_organization_admin"("_user_id" "uuid", "_organization_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "is_organization_member"("_user_id" "uuid", "_organization_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."is_organization_member"("_user_id" "uuid", "_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_organization_member"("_user_id" "uuid", "_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_organization_member"("_user_id" "uuid", "_organization_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "is_super_admin"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";


--
-- Name: FUNCTION "is_venue_admin"("_user_id" "uuid", "_venue_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."is_venue_admin"("_user_id" "uuid", "_venue_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_venue_admin"("_user_id" "uuid", "_venue_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_venue_admin"("_user_id" "uuid", "_venue_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "is_venue_member"("_user_id" "uuid", "_venue_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."is_venue_member"("_user_id" "uuid", "_venue_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_venue_member"("_user_id" "uuid", "_venue_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_venue_member"("_user_id" "uuid", "_venue_id" "uuid") TO "service_role";


--
-- Name: TABLE "chat_rooms"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."chat_rooms" TO "anon";
GRANT ALL ON TABLE "public"."chat_rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_rooms" TO "service_role";


--
-- Name: FUNCTION "join_chat_room"("p_room_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."join_chat_room"("p_room_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."join_chat_room"("p_room_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_chat_room"("p_room_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "on_crew_challenge_change"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."on_crew_challenge_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_crew_challenge_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_crew_challenge_change"() TO "service_role";


--
-- Name: FUNCTION "on_crew_session_created"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."on_crew_session_created"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_crew_session_created"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_crew_session_created"() TO "service_role";


--
-- Name: FUNCTION "on_event_created"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."on_event_created"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_event_created"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_event_created"() TO "service_role";


--
-- Name: FUNCTION "on_match_completed"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."on_match_completed"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_match_completed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_match_completed"() TO "service_role";


--
-- Name: FUNCTION "on_venue_checkin_created"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."on_venue_checkin_created"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_venue_checkin_created"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_venue_checkin_created"() TO "service_role";


--
-- Name: FUNCTION "open_booking_note_is_allowed"("p_note" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."open_booking_note_is_allowed"("p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."open_booking_note_is_allowed"("p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."open_booking_note_is_allowed"("p_note" "text") TO "service_role";


--
-- Name: FUNCTION "prevent_audit_log_mutation"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."prevent_audit_log_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_mutation"() TO "service_role";


--
-- Name: FUNCTION "prevent_ledger_entries_mutation"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."prevent_ledger_entries_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_ledger_entries_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_ledger_entries_mutation"() TO "service_role";


--
-- Name: FUNCTION "release_capacity_hold"("p_hold_id" "uuid", "p_reason" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."release_capacity_hold"("p_hold_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."release_capacity_hold"("p_hold_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_capacity_hold"("p_hold_id" "uuid", "p_reason" "text") TO "service_role";


--
-- Name: FUNCTION "reopen_commerce_order_after_checkout_failure"("p_order_id" "uuid", "p_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."reopen_commerce_order_after_checkout_failure"("p_order_id" "uuid", "p_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reopen_commerce_order_after_checkout_failure"("p_order_id" "uuid", "p_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."reopen_commerce_order_after_checkout_failure"("p_order_id" "uuid", "p_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reopen_commerce_order_after_checkout_failure"("p_order_id" "uuid", "p_version" integer) TO "service_role";


--
-- Name: FUNCTION "replace_commerce_cart_lines"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."replace_commerce_cart_lines"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_commerce_cart_lines"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."replace_commerce_cart_lines"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_commerce_cart_lines"("p_order_id" "uuid", "p_expected_version" integer, "p_lines" "jsonb", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") TO "service_role";


--
-- Name: FUNCTION "rls_auto_enable"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";


--
-- Name: FUNCTION "set_open_booking_slots"("p_action" "text", "p_actor_user_id" "uuid", "p_booking_ids" "uuid"[], "p_booking_group_key" "text", "p_opened_places" integer, "p_pace" "text", "p_note" "text", "p_request_id" "text", "p_user_agent" "text", "p_ip" "text", "p_allow_staff_close" boolean); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."set_open_booking_slots"("p_action" "text", "p_actor_user_id" "uuid", "p_booking_ids" "uuid"[], "p_booking_group_key" "text", "p_opened_places" integer, "p_pace" "text", "p_note" "text", "p_request_id" "text", "p_user_agent" "text", "p_ip" "text", "p_allow_staff_close" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_open_booking_slots"("p_action" "text", "p_actor_user_id" "uuid", "p_booking_ids" "uuid"[], "p_booking_group_key" "text", "p_opened_places" integer, "p_pace" "text", "p_note" "text", "p_request_id" "text", "p_user_agent" "text", "p_ip" "text", "p_allow_staff_close" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_open_booking_slots"("p_action" "text", "p_actor_user_id" "uuid", "p_booking_ids" "uuid"[], "p_booking_group_key" "text", "p_opened_places" integer, "p_pace" "text", "p_note" "text", "p_request_id" "text", "p_user_agent" "text", "p_ip" "text", "p_allow_staff_close" boolean) TO "service_role";


--
-- Name: FUNCTION "set_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


--
-- Name: FUNCTION "set_venue_commerce_enabled"("p_venue_id" "uuid", "p_enabled" boolean, "p_actor_user_id" "uuid", "p_request_id" "text", "p_ip" "text", "p_user_agent" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."set_venue_commerce_enabled"("p_venue_id" "uuid", "p_enabled" boolean, "p_actor_user_id" "uuid", "p_request_id" "text", "p_ip" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_venue_commerce_enabled"("p_venue_id" "uuid", "p_enabled" boolean, "p_actor_user_id" "uuid", "p_request_id" "text", "p_ip" "text", "p_user_agent" "text") TO "service_role";


--
-- Name: TABLE "commerce_order_lines"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."commerce_order_lines" TO "anon";
GRANT ALL ON TABLE "public"."commerce_order_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."commerce_order_lines" TO "service_role";


--
-- Name: FUNCTION "transition_commerce_fulfillment"("p_line_id" "uuid", "p_next_status" "text", "p_actor_user_id" "uuid", "p_request_id" "text", "p_metadata" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."transition_commerce_fulfillment"("p_line_id" "uuid", "p_next_status" "text", "p_actor_user_id" "uuid", "p_request_id" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_commerce_fulfillment"("p_line_id" "uuid", "p_next_status" "text", "p_actor_user_id" "uuid", "p_request_id" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."transition_commerce_fulfillment"("p_line_id" "uuid", "p_next_status" "text", "p_actor_user_id" "uuid", "p_request_id" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transition_commerce_fulfillment"("p_line_id" "uuid", "p_next_status" "text", "p_actor_user_id" "uuid", "p_request_id" "text", "p_metadata" "jsonb") TO "service_role";


--
-- Name: FUNCTION "update_post_comment_count"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_post_comment_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_post_comment_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_post_comment_count"() TO "service_role";


--
-- Name: FUNCTION "update_post_vote_count"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_post_vote_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_post_vote_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_post_vote_count"() TO "service_role";


--
-- Name: FUNCTION "update_updated_at_column"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


--
-- Name: FUNCTION "upsert_daily_chat_room"("p_venue_id" "uuid", "p_session_date" "date", "p_name" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."upsert_daily_chat_room"("p_venue_id" "uuid", "p_session_date" "date", "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_daily_chat_room"("p_venue_id" "uuid", "p_session_date" "date", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_daily_chat_room"("p_venue_id" "uuid", "p_session_date" "date", "p_name" "text") TO "service_role";


--
-- Name: FUNCTION "upsert_resource_chat_room"("p_venue_id" "uuid", "p_resource_id" "text", "p_room_type" "text", "p_title" "text", "p_subtitle" "text", "p_emoji" "text", "p_is_public" boolean); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."upsert_resource_chat_room"("p_venue_id" "uuid", "p_resource_id" "text", "p_room_type" "text", "p_title" "text", "p_subtitle" "text", "p_emoji" "text", "p_is_public" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_resource_chat_room"("p_venue_id" "uuid", "p_resource_id" "text", "p_room_type" "text", "p_title" "text", "p_subtitle" "text", "p_emoji" "text", "p_is_public" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_resource_chat_room"("p_venue_id" "uuid", "p_resource_id" "text", "p_room_type" "text", "p_title" "text", "p_subtitle" "text", "p_emoji" "text", "p_is_public" boolean) TO "service_role";


--
-- Name: TABLE "access_entitlements"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."access_entitlements" TO "anon";
GRANT ALL ON TABLE "public"."access_entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."access_entitlements" TO "service_role";


--
-- Name: TABLE "access_products"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."access_products" TO "anon";
GRANT ALL ON TABLE "public"."access_products" TO "authenticated";
GRANT ALL ON TABLE "public"."access_products" TO "service_role";


--
-- Name: TABLE "access_vouchers"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."access_vouchers" TO "anon";
GRANT ALL ON TABLE "public"."access_vouchers" TO "authenticated";
GRANT ALL ON TABLE "public"."access_vouchers" TO "service_role";


--
-- Name: TABLE "activity_series"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."activity_series" TO "anon";
GRANT ALL ON TABLE "public"."activity_series" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_series" TO "service_role";


--
-- Name: TABLE "activity_session_hosts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."activity_session_hosts" TO "anon";
GRANT ALL ON TABLE "public"."activity_session_hosts" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_session_hosts" TO "service_role";


--
-- Name: TABLE "activity_session_interests"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."activity_session_interests" TO "anon";
GRANT ALL ON TABLE "public"."activity_session_interests" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_session_interests" TO "service_role";


--
-- Name: TABLE "activity_session_overrides"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."activity_session_overrides" TO "anon";
GRANT ALL ON TABLE "public"."activity_session_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_session_overrides" TO "service_role";


--
-- Name: TABLE "activity_sessions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."activity_sessions" TO "anon";
GRANT ALL ON TABLE "public"."activity_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_sessions" TO "service_role";


--
-- Name: TABLE "audit_log"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";


--
-- Name: TABLE "booking_participant_invites"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."booking_participant_invites" TO "anon";
GRANT ALL ON TABLE "public"."booking_participant_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_participant_invites" TO "service_role";


--
-- Name: TABLE "booking_participants"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."booking_participants" TO "anon";
GRANT ALL ON TABLE "public"."booking_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_participants" TO "service_role";


--
-- Name: SEQUENCE "booking_receipt_number_seq"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE "public"."booking_receipt_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booking_receipt_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_receipt_number_seq" TO "service_role";


--
-- Name: TABLE "booking_receipts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."booking_receipts" TO "anon";
GRANT ALL ON TABLE "public"."booking_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_receipts" TO "service_role";


--
-- Name: TABLE "bookings"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";


--
-- Name: TABLE "capacity_holds"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."capacity_holds" TO "anon";
GRANT ALL ON TABLE "public"."capacity_holds" TO "authenticated";
GRANT ALL ON TABLE "public"."capacity_holds" TO "service_role";


--
-- Name: TABLE "chat_messages"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";


--
-- Name: TABLE "chat_participants"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."chat_participants" TO "anon";
GRANT ALL ON TABLE "public"."chat_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_participants" TO "service_role";


--
-- Name: TABLE "chat_reactions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."chat_reactions" TO "anon";
GRANT ALL ON TABLE "public"."chat_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_reactions" TO "service_role";


--
-- Name: TABLE "comment_votes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."comment_votes" TO "anon";
GRANT ALL ON TABLE "public"."comment_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."comment_votes" TO "service_role";


--
-- Name: TABLE "commerce_orders"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."commerce_orders" TO "anon";
GRANT ALL ON TABLE "public"."commerce_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."commerce_orders" TO "service_role";


--
-- Name: TABLE "commerce_receipt_lines"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."commerce_receipt_lines" TO "anon";
GRANT ALL ON TABLE "public"."commerce_receipt_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."commerce_receipt_lines" TO "service_role";


--
-- Name: TABLE "community_feed"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."community_feed" TO "anon";
GRANT ALL ON TABLE "public"."community_feed" TO "authenticated";
GRANT ALL ON TABLE "public"."community_feed" TO "service_role";


--
-- Name: TABLE "community_stories"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."community_stories" TO "anon";
GRANT ALL ON TABLE "public"."community_stories" TO "authenticated";
GRANT ALL ON TABLE "public"."community_stories" TO "service_role";


--
-- Name: TABLE "corporate_accounts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."corporate_accounts" TO "anon";
GRANT ALL ON TABLE "public"."corporate_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."corporate_accounts" TO "service_role";


--
-- Name: TABLE "corporate_members"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."corporate_members" TO "anon";
GRANT ALL ON TABLE "public"."corporate_members" TO "authenticated";
GRANT ALL ON TABLE "public"."corporate_members" TO "service_role";


--
-- Name: TABLE "corporate_order_items"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."corporate_order_items" TO "anon";
GRANT ALL ON TABLE "public"."corporate_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."corporate_order_items" TO "service_role";


--
-- Name: TABLE "corporate_orders"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."corporate_orders" TO "anon";
GRANT ALL ON TABLE "public"."corporate_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."corporate_orders" TO "service_role";


--
-- Name: TABLE "corporate_packages"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."corporate_packages" TO "anon";
GRANT ALL ON TABLE "public"."corporate_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."corporate_packages" TO "service_role";


--
-- Name: TABLE "courts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."courts" TO "anon";
GRANT ALL ON TABLE "public"."courts" TO "authenticated";
GRANT ALL ON TABLE "public"."courts" TO "service_role";


--
-- Name: TABLE "crew_challenges"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."crew_challenges" TO "anon";
GRANT ALL ON TABLE "public"."crew_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_challenges" TO "service_role";


--
-- Name: TABLE "crew_members"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."crew_members" TO "anon";
GRANT ALL ON TABLE "public"."crew_members" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_members" TO "service_role";


--
-- Name: TABLE "crew_session_signups"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."crew_session_signups" TO "anon";
GRANT ALL ON TABLE "public"."crew_session_signups" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_session_signups" TO "service_role";


--
-- Name: TABLE "crew_sessions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."crew_sessions" TO "anon";
GRANT ALL ON TABLE "public"."crew_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_sessions" TO "service_role";


--
-- Name: TABLE "crews"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."crews" TO "anon";
GRANT ALL ON TABLE "public"."crews" TO "authenticated";
GRANT ALL ON TABLE "public"."crews" TO "service_role";


--
-- Name: TABLE "customer_identities"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."customer_identities" TO "anon";
GRANT ALL ON TABLE "public"."customer_identities" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_identities" TO "service_role";


--
-- Name: TABLE "customer_venue_profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."customer_venue_profiles" TO "anon";
GRANT ALL ON TABLE "public"."customer_venue_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_venue_profiles" TO "service_role";


--
-- Name: TABLE "customers"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";


--
-- Name: TABLE "day_pass_grants"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."day_pass_grants" TO "anon";
GRANT ALL ON TABLE "public"."day_pass_grants" TO "authenticated";
GRANT ALL ON TABLE "public"."day_pass_grants" TO "service_role";


--
-- Name: TABLE "day_pass_shares"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."day_pass_shares" TO "anon";
GRANT ALL ON TABLE "public"."day_pass_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."day_pass_shares" TO "service_role";


--
-- Name: TABLE "day_passes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."day_passes" TO "anon";
GRANT ALL ON TABLE "public"."day_passes" TO "authenticated";
GRANT ALL ON TABLE "public"."day_passes" TO "service_role";


--
-- Name: TABLE "display_devices"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."display_devices" TO "anon";
GRANT ALL ON TABLE "public"."display_devices" TO "authenticated";
GRANT ALL ON TABLE "public"."display_devices" TO "service_role";


--
-- Name: TABLE "event_checkins"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_checkins" TO "anon";
GRANT ALL ON TABLE "public"."event_checkins" TO "authenticated";
GRANT ALL ON TABLE "public"."event_checkins" TO "service_role";


--
-- Name: TABLE "event_communications"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_communications" TO "anon";
GRANT ALL ON TABLE "public"."event_communications" TO "authenticated";
GRANT ALL ON TABLE "public"."event_communications" TO "service_role";


--
-- Name: TABLE "event_courts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_courts" TO "anon";
GRANT ALL ON TABLE "public"."event_courts" TO "authenticated";
GRANT ALL ON TABLE "public"."event_courts" TO "service_role";


--
-- Name: TABLE "event_followups"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_followups" TO "anon";
GRANT ALL ON TABLE "public"."event_followups" TO "authenticated";
GRANT ALL ON TABLE "public"."event_followups" TO "service_role";


--
-- Name: TABLE "event_lead_activities"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_lead_activities" TO "anon";
GRANT ALL ON TABLE "public"."event_lead_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."event_lead_activities" TO "service_role";


--
-- Name: TABLE "event_leads"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_leads" TO "anon";
GRANT ALL ON TABLE "public"."event_leads" TO "authenticated";
GRANT ALL ON TABLE "public"."event_leads" TO "service_role";


--
-- Name: TABLE "event_likes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_likes" TO "anon";
GRANT ALL ON TABLE "public"."event_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."event_likes" TO "service_role";


--
-- Name: TABLE "event_offer_items"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_offer_items" TO "anon";
GRANT ALL ON TABLE "public"."event_offer_items" TO "authenticated";
GRANT ALL ON TABLE "public"."event_offer_items" TO "service_role";


--
-- Name: TABLE "event_offer_templates"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_offer_templates" TO "anon";
GRANT ALL ON TABLE "public"."event_offer_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."event_offer_templates" TO "service_role";


--
-- Name: TABLE "event_offers"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_offers" TO "anon";
GRANT ALL ON TABLE "public"."event_offers" TO "authenticated";
GRANT ALL ON TABLE "public"."event_offers" TO "service_role";


--
-- Name: TABLE "event_resource_allocations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_resource_allocations" TO "anon";
GRANT ALL ON TABLE "public"."event_resource_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."event_resource_allocations" TO "service_role";


--
-- Name: TABLE "event_resource_blocks"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_resource_blocks" TO "anon";
GRANT ALL ON TABLE "public"."event_resource_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."event_resource_blocks" TO "service_role";


--
-- Name: TABLE "event_resource_catalog"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_resource_catalog" TO "anon";
GRANT ALL ON TABLE "public"."event_resource_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."event_resource_catalog" TO "service_role";


--
-- Name: TABLE "event_templates"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."event_templates" TO "anon";
GRANT ALL ON TABLE "public"."event_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."event_templates" TO "service_role";


--
-- Name: TABLE "events"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";


--
-- Name: TABLE "feed_likes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."feed_likes" TO "anon";
GRANT ALL ON TABLE "public"."feed_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."feed_likes" TO "service_role";


--
-- Name: TABLE "forum_poll_options"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."forum_poll_options" TO "anon";
GRANT ALL ON TABLE "public"."forum_poll_options" TO "authenticated";
GRANT ALL ON TABLE "public"."forum_poll_options" TO "service_role";


--
-- Name: TABLE "forum_poll_votes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."forum_poll_votes" TO "anon";
GRANT ALL ON TABLE "public"."forum_poll_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."forum_poll_votes" TO "service_role";


--
-- Name: TABLE "forum_post_signups"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."forum_post_signups" TO "anon";
GRANT ALL ON TABLE "public"."forum_post_signups" TO "authenticated";
GRANT ALL ON TABLE "public"."forum_post_signups" TO "service_role";


--
-- Name: TABLE "forum_posts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."forum_posts" TO "anon";
GRANT ALL ON TABLE "public"."forum_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."forum_posts" TO "service_role";


--
-- Name: TABLE "franchisees"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."franchisees" TO "anon";
GRANT ALL ON TABLE "public"."franchisees" TO "authenticated";
GRANT ALL ON TABLE "public"."franchisees" TO "service_role";


--
-- Name: TABLE "investor_assets"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."investor_assets" TO "anon";
GRANT ALL ON TABLE "public"."investor_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."investor_assets" TO "service_role";


--
-- Name: TABLE "investor_leads"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."investor_leads" TO "anon";
GRANT ALL ON TABLE "public"."investor_leads" TO "authenticated";
GRANT ALL ON TABLE "public"."investor_leads" TO "service_role";


--
-- Name: TABLE "investor_settings"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."investor_settings" TO "anon";
GRANT ALL ON TABLE "public"."investor_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."investor_settings" TO "service_role";


--
-- Name: TABLE "ladder_challenges"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."ladder_challenges" TO "anon";
GRANT ALL ON TABLE "public"."ladder_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."ladder_challenges" TO "service_role";


--
-- Name: TABLE "ladder_entries"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."ladder_entries" TO "anon";
GRANT ALL ON TABLE "public"."ladder_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."ladder_entries" TO "service_role";


--
-- Name: TABLE "ladder_matches"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."ladder_matches" TO "anon";
GRANT ALL ON TABLE "public"."ladder_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."ladder_matches" TO "service_role";


--
-- Name: TABLE "ledger_entries"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."ledger_entries" TO "anon";
GRANT ALL ON TABLE "public"."ledger_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."ledger_entries" TO "service_role";


--
-- Name: TABLE "matches"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."matches" TO "anon";
GRANT ALL ON TABLE "public"."matches" TO "authenticated";
GRANT ALL ON TABLE "public"."matches" TO "service_role";


--
-- Name: TABLE "membership_entitlements"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."membership_entitlements" TO "anon";
GRANT ALL ON TABLE "public"."membership_entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."membership_entitlements" TO "service_role";


--
-- Name: TABLE "membership_tier_pricing"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."membership_tier_pricing" TO "anon";
GRANT ALL ON TABLE "public"."membership_tier_pricing" TO "authenticated";
GRANT ALL ON TABLE "public"."membership_tier_pricing" TO "service_role";


--
-- Name: TABLE "membership_tiers"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."membership_tiers" TO "anon";
GRANT ALL ON TABLE "public"."membership_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."membership_tiers" TO "service_role";


--
-- Name: TABLE "membership_usage"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."membership_usage" TO "anon";
GRANT ALL ON TABLE "public"."membership_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."membership_usage" TO "service_role";


--
-- Name: TABLE "memberships"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."memberships" TO "anon";
GRANT ALL ON TABLE "public"."memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."memberships" TO "service_role";


--
-- Name: TABLE "open_play_sessions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."open_play_sessions" TO "anon";
GRANT ALL ON TABLE "public"."open_play_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."open_play_sessions" TO "service_role";


--
-- Name: TABLE "opening_hours"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."opening_hours" TO "anon";
GRANT ALL ON TABLE "public"."opening_hours" TO "authenticated";
GRANT ALL ON TABLE "public"."opening_hours" TO "service_role";


--
-- Name: TABLE "operations_integration_health"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."operations_integration_health" TO "anon";
GRANT ALL ON TABLE "public"."operations_integration_health" TO "authenticated";
GRANT ALL ON TABLE "public"."operations_integration_health" TO "service_role";


--
-- Name: TABLE "ops_agent_runs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."ops_agent_runs" TO "anon";
GRANT ALL ON TABLE "public"."ops_agent_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."ops_agent_runs" TO "service_role";


--
-- Name: TABLE "ops_check_state"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."ops_check_state" TO "anon";
GRANT ALL ON TABLE "public"."ops_check_state" TO "authenticated";
GRANT ALL ON TABLE "public"."ops_check_state" TO "service_role";


--
-- Name: TABLE "ops_client_events"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."ops_client_events" TO "anon";
GRANT ALL ON TABLE "public"."ops_client_events" TO "authenticated";
GRANT ALL ON TABLE "public"."ops_client_events" TO "service_role";


--
-- Name: TABLE "ops_incidents"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."ops_incidents" TO "anon";
GRANT ALL ON TABLE "public"."ops_incidents" TO "authenticated";
GRANT ALL ON TABLE "public"."ops_incidents" TO "service_role";


--
-- Name: TABLE "ops_signals"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."ops_signals" TO "anon";
GRANT ALL ON TABLE "public"."ops_signals" TO "authenticated";
GRANT ALL ON TABLE "public"."ops_signals" TO "service_role";


--
-- Name: TABLE "organization_members"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."organization_members" TO "anon";
GRANT ALL ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";


--
-- Name: TABLE "organizations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";


--
-- Name: TABLE "player_profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."player_profiles" TO "anon";
GRANT ALL ON TABLE "public"."player_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."player_profiles" TO "service_role";


--
-- Name: TABLE "players"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."players" TO "anon";
GRANT ALL ON TABLE "public"."players" TO "authenticated";
GRANT ALL ON TABLE "public"."players" TO "service_role";


--
-- Name: TABLE "post_comments"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."post_comments" TO "anon";
GRANT ALL ON TABLE "public"."post_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."post_comments" TO "service_role";


--
-- Name: TABLE "post_votes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."post_votes" TO "anon";
GRANT ALL ON TABLE "public"."post_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."post_votes" TO "service_role";


--
-- Name: TABLE "pricing_rules"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."pricing_rules" TO "anon";
GRANT ALL ON TABLE "public"."pricing_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."pricing_rules" TO "service_role";


--
-- Name: TABLE "product_relationships"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."product_relationships" TO "anon";
GRANT ALL ON TABLE "public"."product_relationships" TO "authenticated";
GRANT ALL ON TABLE "public"."product_relationships" TO "service_role";


--
-- Name: TABLE "pulse_tokens"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."pulse_tokens" TO "anon";
GRANT ALL ON TABLE "public"."pulse_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."pulse_tokens" TO "service_role";


--
-- Name: TABLE "push_subscriptions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";


--
-- Name: TABLE "score_events"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."score_events" TO "anon";
GRANT ALL ON TABLE "public"."score_events" TO "authenticated";
GRANT ALL ON TABLE "public"."score_events" TO "service_role";


--
-- Name: TABLE "score_matches"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."score_matches" TO "anon";
GRANT ALL ON TABLE "public"."score_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."score_matches" TO "service_role";


--
-- Name: TABLE "score_player_links"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."score_player_links" TO "anon";
GRANT ALL ON TABLE "public"."score_player_links" TO "authenticated";
GRANT ALL ON TABLE "public"."score_player_links" TO "service_role";


--
-- Name: TABLE "score_players"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."score_players" TO "anon";
GRANT ALL ON TABLE "public"."score_players" TO "authenticated";
GRANT ALL ON TABLE "public"."score_players" TO "service_role";


--
-- Name: TABLE "score_sessions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."score_sessions" TO "anon";
GRANT ALL ON TABLE "public"."score_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."score_sessions" TO "service_role";


--
-- Name: TABLE "score_turns"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."score_turns" TO "anon";
GRANT ALL ON TABLE "public"."score_turns" TO "authenticated";
GRANT ALL ON TABLE "public"."score_turns" TO "service_role";


--
-- Name: TABLE "season_standings"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."season_standings" TO "anon";
GRANT ALL ON TABLE "public"."season_standings" TO "authenticated";
GRANT ALL ON TABLE "public"."season_standings" TO "service_role";


--
-- Name: TABLE "seasons"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."seasons" TO "anon";
GRANT ALL ON TABLE "public"."seasons" TO "authenticated";
GRANT ALL ON TABLE "public"."seasons" TO "service_role";


--
-- Name: TABLE "session_registrations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."session_registrations" TO "anon";
GRANT ALL ON TABLE "public"."session_registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."session_registrations" TO "service_role";


--
-- Name: TABLE "standings"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."standings" TO "anon";
GRANT ALL ON TABLE "public"."standings" TO "authenticated";
GRANT ALL ON TABLE "public"."standings" TO "service_role";


--
-- Name: TABLE "stripe_events"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."stripe_events" TO "anon";
GRANT ALL ON TABLE "public"."stripe_events" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_events" TO "service_role";


--
-- Name: TABLE "teams"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";


--
-- Name: TABLE "user_roles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";


--
-- Name: TABLE "venue_checkins"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."venue_checkins" TO "anon";
GRANT ALL ON TABLE "public"."venue_checkins" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_checkins" TO "service_role";


--
-- Name: TABLE "venue_courts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."venue_courts" TO "anon";
GRANT ALL ON TABLE "public"."venue_courts" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_courts" TO "service_role";


--
-- Name: TABLE "venue_event_categories"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."venue_event_categories" TO "anon";
GRANT ALL ON TABLE "public"."venue_event_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_event_categories" TO "service_role";


--
-- Name: TABLE "venue_links"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."venue_links" TO "anon";
GRANT ALL ON TABLE "public"."venue_links" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_links" TO "service_role";


--
-- Name: TABLE "venue_operation_overrides"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."venue_operation_overrides" TO "anon";
GRANT ALL ON TABLE "public"."venue_operation_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_operation_overrides" TO "service_role";


--
-- Name: TABLE "venue_staff"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."venue_staff" TO "anon";
GRANT ALL ON TABLE "public"."venue_staff" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_staff" TO "service_role";


--
-- Name: TABLE "venues"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."venues" TO "anon";
GRANT ALL ON TABLE "public"."venues" TO "authenticated";
GRANT ALL ON TABLE "public"."venues" TO "service_role";


--
-- Name: TABLE "wellness_receipt_profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."wellness_receipt_profiles" TO "anon";
GRANT ALL ON TABLE "public"."wellness_receipt_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."wellness_receipt_profiles" TO "service_role";


--
-- Name: TABLE "zettle_connections"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."zettle_connections" TO "anon";
GRANT ALL ON TABLE "public"."zettle_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."zettle_connections" TO "service_role";


--
-- Name: TABLE "zettle_purchases"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."zettle_purchases" TO "anon";
GRANT ALL ON TABLE "public"."zettle_purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."zettle_purchases" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Application-owned objects outside the public schema
--

-- Production contains exactly this one canonical Storage bucket. The row is
-- application configuration, not copied customer content.
INSERT INTO "storage"."buckets" (
    "id",
    "name",
    "public",
    "file_size_limit",
    "allowed_mime_types"
)
VALUES (
    'investor-assets',
    'investor-assets',
    true,
    20971520,
    ARRAY[
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/svg+xml',
        'application/pdf'
    ]::"text"[]
)
ON CONFLICT ("id") DO UPDATE
SET "name" = EXCLUDED."name",
    "public" = EXCLUDED."public",
    "file_size_limit" = EXCLUDED."file_size_limit",
    "allowed_mime_types" = EXCLUDED."allowed_mime_types";

DROP POLICY IF EXISTS "Public can read investor assets" ON "storage"."objects";
CREATE POLICY "Public can read investor assets"
ON "storage"."objects"
FOR SELECT
USING (("bucket_id" = 'investor-assets'::"text"));

DROP POLICY IF EXISTS "Super admin can delete investor assets" ON "storage"."objects";
CREATE POLICY "Super admin can delete investor assets"
ON "storage"."objects"
FOR DELETE
USING (
    ("bucket_id" = 'investor-assets'::"text")
    AND "public"."is_super_admin"()
);

DROP POLICY IF EXISTS "Super admin can update investor assets" ON "storage"."objects";
CREATE POLICY "Super admin can update investor assets"
ON "storage"."objects"
FOR UPDATE
USING (
    ("bucket_id" = 'investor-assets'::"text")
    AND "public"."is_super_admin"()
)
WITH CHECK (
    ("bucket_id" = 'investor-assets'::"text")
    AND "public"."is_super_admin"()
);

DROP POLICY IF EXISTS "Super admin can upload investor assets" ON "storage"."objects";
CREATE POLICY "Super admin can upload investor assets"
ON "storage"."objects"
FOR INSERT
WITH CHECK (
    ("bucket_id" = 'investor-assets'::"text")
    AND "public"."is_super_admin"()
);

-- pg_dump schema filters classify this trigger under auth, although its
-- implementation is application-owned in public.handle_new_user().
DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created"
AFTER INSERT ON "auth"."users"
FOR EACH ROW
EXECUTE FUNCTION "public"."handle_new_user"();
