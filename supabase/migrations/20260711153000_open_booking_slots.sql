-- Open booking slots v1
-- Stores owner-controlled publication state on booking rows.
-- Booking rows still own resource/time; booking_participants remain the Play Right layer.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS open_for_more_status text NOT NULL DEFAULT 'closed'
    CHECK (open_for_more_status IN ('closed', 'open')),
  ADD COLUMN IF NOT EXISTS open_for_more_total_players integer
    CHECK (open_for_more_total_players IN (2, 4)),
  ADD COLUMN IF NOT EXISTS open_for_more_pace text,
  ADD COLUMN IF NOT EXISTS open_for_more_note text,
  ADD COLUMN IF NOT EXISTS open_for_more_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS open_for_more_closed_at timestamptz;

-- Keep the taxonomy reusable for activity_sessions later. Tempo describes the
-- session, never the player.
ALTER TABLE public.activity_sessions
  ADD COLUMN IF NOT EXISTS pace text;

UPDATE public.bookings
SET open_for_more_pace = CASE open_for_more_pace
  WHEN 'newer_players' THEN 'calm_pace'
  WHEN 'experienced_players' THEN 'familiar_pace'
  WHEN 'high_tempo' THEN 'high_pace'
  ELSE open_for_more_pace
END
WHERE open_for_more_pace IN ('newer_players', 'experienced_players', 'high_tempo');

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_open_for_more_pace_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_open_for_more_pace_check
  CHECK (
    open_for_more_pace IS NULL
    OR open_for_more_pace IN ('all_levels', 'calm_pace', 'familiar_pace', 'high_pace')
  );

ALTER TABLE public.activity_sessions
  DROP CONSTRAINT IF EXISTS activity_sessions_pace_check;

ALTER TABLE public.activity_sessions
  ADD CONSTRAINT activity_sessions_pace_check
  CHECK (
    pace IS NULL
    OR pace IN ('all_levels', 'calm_pace', 'familiar_pace', 'high_pace')
  );

ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS visible_from timestamptz;

CREATE INDEX IF NOT EXISTS idx_bookings_open_for_more
  ON public.bookings (venue_id, start_time)
  WHERE open_for_more_status = 'open';

CREATE INDEX IF NOT EXISTS idx_chat_participants_visible_from
  ON public.chat_participants (room_id, user_id, visible_from);

-- `visible_from` is the history boundary for public claims. Users may join
-- rooms as themselves, but they must not be able to edit their own boundary.
DROP POLICY IF EXISTS "Users manage own participation" ON public.chat_participants;

CREATE POLICY "Users can join chat rooms"
  ON public.chat_participants FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users read own chat participation"
  ON public.chat_participants FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Read messages in accessible rooms" ON public.chat_messages;
CREATE POLICY "Read messages in accessible rooms"
  ON public.chat_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_rooms r
      WHERE r.id = chat_messages.room_id
        AND (
          r.is_public = true
          OR EXISTS (
            SELECT 1
            FROM public.chat_participants cp
            WHERE cp.room_id = r.id
              AND cp.user_id = auth.uid()
              AND (
                cp.visible_from IS NULL
                OR chat_messages.created_at >= cp.visible_from
              )
          )
        )
    )
  );

CREATE OR REPLACE FUNCTION public.open_booking_note_is_allowed(p_note text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NOT (
    COALESCE(p_note, '') ~* '(^|[^[:alpha:]])(endast|bara)[[:space:]]+(damer|kvinnor|tjejer|män|killar)([^[:alpha:]]|$)'
    OR COALESCE(p_note, '') ~* '(^|[^[:alnum:]])minst[[:space:]]+4[,.]0([+]?)([^[:alnum:]]|$)'
    OR COALESCE(p_note, '') ~* '(^|[^[:alnum:]])4[,.]0[+]([^[:alnum:]]|$)'
    OR COALESCE(p_note, '') ~* '(^|[^[:alpha:]])inga[[:space:]]+nybörjare([^[:alpha:]]|$)'
    OR COALESCE(p_note, '') ~* '(^|[^[:alpha:]])endast[[:space:]]+medlemmar([^[:alpha:]]|$)'
  );
$$;

DROP FUNCTION IF EXISTS public.set_open_booking_slots(
  text, uuid, uuid[], text, integer, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.set_open_booking_slots(
  p_action text,
  p_actor_user_id uuid,
  p_booking_ids uuid[],
  p_booking_group_key text,
  p_total_players integer DEFAULT NULL,
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
  v_note text := NULLIF(left(btrim(COALESCE(p_note, '')), 120), '');
  v_now timestamptz := now();
  v_invite public.booking_participant_invites%ROWTYPE;
  v_token text;
  v_open_spots integer := 0;
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

  IF p_total_players NOT IN (2, 4) THEN
    RAISE EXCEPTION 'Välj totalt 2 eller 4 spelare';
  END IF;
  IF p_pace NOT IN ('all_levels', 'calm_pace', 'familiar_pace', 'high_pace') THEN
    RAISE EXCEPTION 'Välj tempokategori';
  END IF;
  IF NOT public.open_booking_note_is_allowed(v_note) THEN
    RAISE EXCEPTION 'Beskriv spelet och tempot — inte vilka människor som får vara med.';
  END IF;
  IF v_committed_count >= p_total_players THEN
    RAISE EXCEPTION 'Det finns inga öppna platser att publicera';
  END IF;

  v_open_spots := GREATEST(p_total_players - v_committed_count, 0);

  UPDATE public.bookings
  SET open_for_more_status = 'open',
      open_for_more_total_players = p_total_players,
      open_for_more_pace = p_pace,
      open_for_more_note = v_note,
      open_for_more_published_at = v_now,
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
        'open_booking_total_players', p_total_players
      )
    )
    RETURNING * INTO v_invite;
  ELSE
    v_token := v_invite.token;
    UPDATE public.booking_participant_invites
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'open_booking_published_at', v_now,
          'open_booking_total_players', p_total_players
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
      'total_players', p_total_players,
      'open_spots', v_open_spots,
      'pace', p_pace,
      'has_note', v_note IS NOT NULL
    ),
    jsonb_build_object('booking_group_key', p_booking_group_key, 'invite_id', v_invite.id),
    p_ip, p_user_agent
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'open',
    'total_players', p_total_players,
    'open_spots', v_open_spots,
    'pace', p_pace,
    'note', v_note,
    'token', v_invite.token,
    'invite_id', v_invite.id,
    'published_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_open_booking_slots(
  text, uuid, uuid[], text, integer, text, text, text, text, text, boolean
) TO service_role;

-- Reminder after manual SQL editor execution:
-- NOTIFY pgrst, 'reload schema';
