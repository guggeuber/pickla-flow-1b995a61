-- Correct Release B open-booking capacity semantics.
--
-- The original v1 model stored a binary 2/4 total-player choice. Production has
-- already received that migration, so this is an additive correction:
-- - owner chooses additional places to open
-- - public capacity is committed Play Rights at publication/update + opened places
-- - old open_for_more_total_players remains only as deprecated compatibility

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS open_for_more_opened_places integer,
  ADD COLUMN IF NOT EXISTS open_for_more_public_capacity integer,
  ADD COLUMN IF NOT EXISTS open_for_more_committed_at_publication integer;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_open_for_more_total_players_check;

COMMENT ON COLUMN public.bookings.open_for_more_total_players IS
  'Deprecated compatibility field from Release B v1. Use open_for_more_opened_places + open_for_more_public_capacity.';
COMMENT ON COLUMN public.bookings.open_for_more_opened_places IS
  'Additional Play Rights the owner chose to open for this published private booking.';
COMMENT ON COLUMN public.bookings.open_for_more_public_capacity IS
  'Canonical capacity cap for public open-booking claims; never derived from court count.';
COMMENT ON COLUMN public.bookings.open_for_more_committed_at_publication IS
  'Committed Play Rights counted when the open-booking capacity was last published/updated.';

WITH open_rows AS (
  SELECT
    b.id,
    b.venue_id,
    b.open_for_more_total_players,
    CASE
      WHEN b.stripe_session_id IS NOT NULL THEN 'stripe:' || b.stripe_session_id
      WHEN b.access_code IS NOT NULL THEN 'code:' || b.access_code || ':' || b.start_time || ':' || b.end_time
      ELSE 'booking:' || COALESCE(b.id::text, b.booking_ref)
    END AS booking_group_key
  FROM public.bookings b
  WHERE b.open_for_more_status = 'open'
),
group_counts AS (
  SELECT
    r.venue_id,
    r.booking_group_key,
    GREATEST(COALESCE(MAX(r.open_for_more_total_players), 0), 0)::integer AS legacy_capacity,
    COUNT(bp.id)::integer AS committed_count
  FROM open_rows r
  LEFT JOIN public.booking_participants bp
    ON bp.venue_id = r.venue_id
   AND bp.booking_group_key = r.booking_group_key
   AND bp.payment_status IN ('paid', 'free')
  GROUP BY r.venue_id, r.booking_group_key
),
derived AS (
  SELECT
    r.id,
    g.committed_count,
    GREATEST(g.legacy_capacity, g.committed_count)::integer AS public_capacity,
    GREATEST(GREATEST(g.legacy_capacity, g.committed_count) - g.committed_count, 0)::integer AS opened_places
  FROM open_rows r
  JOIN group_counts g
    ON g.venue_id = r.venue_id
   AND g.booking_group_key = r.booking_group_key
)
UPDATE public.bookings b
SET open_for_more_committed_at_publication = COALESCE(b.open_for_more_committed_at_publication, d.committed_count),
    open_for_more_public_capacity = COALESCE(b.open_for_more_public_capacity, d.public_capacity),
    open_for_more_opened_places = COALESCE(b.open_for_more_opened_places, d.opened_places)
FROM derived d
WHERE b.id = d.id;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_open_for_more_corrected_capacity_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_open_for_more_corrected_capacity_check
  CHECK (
    (open_for_more_opened_places IS NULL OR open_for_more_opened_places >= 0)
    AND (open_for_more_public_capacity IS NULL OR open_for_more_public_capacity >= 0)
    AND (open_for_more_committed_at_publication IS NULL OR open_for_more_committed_at_publication >= 0)
    AND (
      open_for_more_public_capacity IS NULL
      OR open_for_more_committed_at_publication IS NULL
      OR open_for_more_public_capacity >= open_for_more_committed_at_publication
    )
  );

DROP FUNCTION IF EXISTS public.set_open_booking_slots(
  text, uuid, uuid[], text, integer, text, text, text, text, text, boolean
);

CREATE OR REPLACE FUNCTION public.set_open_booking_slots(
  p_action text,
  p_actor_user_id uuid,
  p_booking_ids uuid[],
  p_booking_group_key text,
  p_opened_places integer DEFAULT NULL,
  p_pace text DEFAULT 'all_levels',
  p_note text DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_allow_staff_close boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

GRANT EXECUTE ON FUNCTION public.set_open_booking_slots(
  text, uuid, uuid[], text, integer, text, text, text, text, text, boolean
) TO service_role;

-- Reminder after manual SQL editor execution:
-- NOTIFY pgrst, 'reload schema';
