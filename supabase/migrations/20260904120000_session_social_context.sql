-- Session Social Context v3
-- Canonical mapping in the current schema:
--   Person        -> customers (+ player_profiles for avatar presentation)
--   Session       -> activity_sessions
--   Participation -> session_registrations
--
-- Public callers receive counts only. Authenticated, verified callers may
-- receive privacy-filtered Person identity. Shared history is derived from
-- Participation and is never persisted as a social edge.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS social_visibility TEXT;

UPDATE public.customers
SET social_visibility = CASE WHEN auth_user_id IS NULL THEN 'hidden' ELSE 'visible' END
WHERE social_visibility IS NULL;

ALTER TABLE public.customers
  ALTER COLUMN social_visibility SET DEFAULT 'visible',
  ALTER COLUMN social_visibility SET NOT NULL;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_social_visibility_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_social_visibility_check
  CHECK (social_visibility IN ('visible', 'hidden'));

COMMENT ON COLUMN public.customers.social_visibility IS
  'Person-controlled visibility in authenticated participant lists. Auth-less guest Persons are always hidden; canonical claim defaults them to visible.';

CREATE OR REPLACE FUNCTION public.enforce_customer_social_visibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.auth_user_id IS NULL THEN
    NEW.social_visibility := 'hidden';
  ELSIF TG_OP = 'UPDATE' AND OLD.auth_user_id IS NULL THEN
    NEW.social_visibility := 'visible';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_social_visibility ON public.customers;
CREATE TRIGGER trg_customer_social_visibility
BEFORE INSERT OR UPDATE OF auth_user_id, social_visibility ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_social_visibility();

ALTER TABLE public.session_registrations
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'participant';

ALTER TABLE public.session_registrations
  DROP CONSTRAINT IF EXISTS session_registrations_role_check;
ALTER TABLE public.session_registrations
  ADD CONSTRAINT session_registrations_role_check
  CHECK (role IN ('participant', 'host'));

ALTER TABLE public.session_registrations
  DROP CONSTRAINT IF EXISTS session_registrations_status_check;
ALTER TABLE public.session_registrations
  ADD CONSTRAINT session_registrations_status_check
  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'checked_in', 'attended', 'no_show'));

UPDATE public.session_registrations AS participation
SET role = 'host'
WHERE participation.role <> 'host'
  AND (
    participation.source_type IN ('playing_host', 'host_comp')
    OR participation.metadata->>'role' IN ('playing_host', 'host_comp', 'host')
    OR participation.metadata->>'entitlement_type' IN ('playing_host', 'host_comp')
    OR participation.metadata->>'pricing_reason' IN ('playing_host', 'host_comp')
    OR participation.metadata->>'compensation_type' IN ('playing_host', 'host_comp')
    OR EXISTS (
      SELECT 1
      FROM public.activity_session_hosts AS host_assignment
      WHERE host_assignment.activity_session_id = participation.activity_session_id
        AND host_assignment.customer_id = participation.customer_id
        AND host_assignment.status = 'active'
    )
  );

CREATE OR REPLACE FUNCTION public.derive_session_participation_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'host'
    OR NEW.source_type IN ('playing_host', 'host_comp')
    OR NEW.metadata->>'role' IN ('playing_host', 'host_comp', 'host')
    OR NEW.metadata->>'entitlement_type' IN ('playing_host', 'host_comp')
    OR NEW.metadata->>'pricing_reason' IN ('playing_host', 'host_comp')
    OR NEW.metadata->>'compensation_type' IN ('playing_host', 'host_comp')
    OR EXISTS (
      SELECT 1
      FROM public.activity_session_hosts AS host_assignment
      WHERE host_assignment.activity_session_id = NEW.activity_session_id
        AND host_assignment.customer_id = NEW.customer_id
        AND host_assignment.status = 'active'
    )
  THEN
    NEW.role := 'host';
  ELSE
    NEW.role := 'participant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_session_participation_role ON public.session_registrations;
CREATE TRIGGER trg_derive_session_participation_role
BEFORE INSERT OR UPDATE OF activity_session_id, customer_id, source_type, metadata, role
ON public.session_registrations
FOR EACH ROW EXECUTE FUNCTION public.derive_session_participation_role();

CREATE OR REPLACE FUNCTION public.promote_assigned_host_participations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    UPDATE public.session_registrations AS participation
    SET role = 'host'
    WHERE participation.activity_session_id = NEW.activity_session_id
      AND participation.customer_id = NEW.customer_id
      AND participation.role <> 'host';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_assigned_host_participations ON public.activity_session_hosts;
CREATE TRIGGER trg_promote_assigned_host_participations
AFTER INSERT OR UPDATE OF status ON public.activity_session_hosts
FOR EACH ROW EXECUTE FUNCTION public.promote_assigned_host_participations();

COMMENT ON COLUMN public.session_registrations.role IS
  'Canonical Participation role for the concrete Session occurrence. activity_session_hosts remains an administrative assignment input, not Session host truth.';

-- Legacy host identity was callable by anon. Session identity now flows only
-- through authenticated social-context RPCs; keep this compatibility RPC for
-- authenticated internal consumers while removing anonymous execution.
REVOKE EXECUTE ON FUNCTION public.get_public_activity_session_hosts(UUID[]) FROM PUBLIC, anon, authenticated;

-- Resolve one concrete occurrence. A one-off activity_session has session_date.
-- Legacy recurring schedule templates require the explicit date overload;
-- a one-argument call returns NULL rather than guessing an occurrence.
CREATE OR REPLACE FUNCTION public.get_session_public_context(
  p_session_id UUID,
  p_session_date DATE
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH target AS (
    SELECT
      session.id,
      session.venue_id,
      COALESCE(p_session_date, session.session_date) AS occurrence_date
    FROM public.activity_sessions AS session
    JOIN public.venues AS venue ON venue.id = session.venue_id
    WHERE session.id = p_session_id
      AND session.is_active = true
      AND session.publish_status = 'published'
      AND session.closed_to_public = false
      AND venue.is_public = true
      AND COALESCE(p_session_date, session.session_date) IS NOT NULL
      AND (session.session_date IS NULL OR session.session_date = COALESCE(p_session_date, session.session_date))
      AND (
        session.session_date IS NOT NULL
        OR EXTRACT(DOW FROM COALESCE(p_session_date, session.session_date))::INTEGER = ANY(session.recurrence_days)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.activity_session_overrides AS occurrence_override
        WHERE occurrence_override.activity_session_id = session.id
          AND occurrence_override.session_date = COALESCE(p_session_date, session.session_date)
          AND occurrence_override.status IN ('hidden', 'cancelled')
      )
  ), counted AS (
    SELECT
      COUNT(participation.id)::INTEGER AS attendee_count,
      COALESCE(BOOL_OR(participation.role = 'host'), false) AS host_present
    FROM target
    LEFT JOIN public.session_registrations AS participation
      ON participation.activity_session_id = target.id
     AND participation.session_date = target.occurrence_date
     AND participation.status IN ('confirmed', 'checked_in', 'attended')
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM target)
    THEN jsonb_build_object(
      'attendee_count', counted.attendee_count,
      'host_present', counted.host_present
    )
    ELSE NULL
  END
  FROM counted;
$$;

CREATE OR REPLACE FUNCTION public.get_session_public_context(p_session_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.get_session_public_context(p_session_id, NULL::DATE);
$$;

-- Set-based authenticated projection for discovery cards. Each requested item
-- is {"session_id":"uuid","session_date":"YYYY-MM-DD"}. The limit is a
-- hard response/work bound, not a client-side privacy filter.
CREATE OR REPLACE FUNCTION public.get_session_social_context_batch(p_occurrences JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_user_id UUID := auth.uid();
  v_caller_person_id UUID;
  v_result JSONB;
BEGIN
  IF v_caller_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = v_caller_user_id
      AND COALESCE(auth_user.email_confirmed_at, auth_user.phone_confirmed_at) IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'verified_account_required';
  END IF;

  SELECT COALESCE(person.merged_into_id, person.id)
  INTO v_caller_person_id
  FROM public.customers AS person
  WHERE person.auth_user_id = v_caller_user_id
    AND person.status = 'active'
  ORDER BY (person.merged_into_id IS NULL) DESC, person.created_at ASC
  LIMIT 1;

  WITH requested AS MATERIALIZED (
    SELECT
      request.ordinality::INTEGER AS ordinal,
      NULLIF(request.value->>'session_id', '')::UUID AS session_id,
      NULLIF(request.value->>'session_date', '')::DATE AS requested_date
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_occurrences) = 'array' THEN p_occurrences ELSE '[]'::JSONB END
    ) WITH ORDINALITY AS request(value, ordinality)
    LIMIT 32
  ), target AS MATERIALIZED (
    SELECT
      requested.ordinal,
      session.id AS session_id,
      session.venue_id,
      session.start_time,
      COALESCE(requested.requested_date, session.session_date) AS session_date,
      (
        session.is_active = true
        AND session.publish_status = 'published'
        AND session.closed_to_public = false
        AND venue.is_public = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.activity_session_overrides AS occurrence_override
          WHERE occurrence_override.activity_session_id = session.id
            AND occurrence_override.session_date = COALESCE(requested.requested_date, session.session_date)
            AND occurrence_override.status IN ('hidden', 'cancelled')
        )
      ) AS is_public
    FROM requested
    JOIN public.activity_sessions AS session ON session.id = requested.session_id
    JOIN public.venues AS venue ON venue.id = session.venue_id
    WHERE COALESCE(requested.requested_date, session.session_date) IS NOT NULL
      AND (session.session_date IS NULL OR session.session_date = COALESCE(requested.requested_date, session.session_date))
      AND (
        session.session_date IS NOT NULL
        OR EXTRACT(DOW FROM COALESCE(requested.requested_date, session.session_date))::INTEGER = ANY(session.recurrence_days)
      )
  ), authorized_target AS MATERIALIZED (
    SELECT target.*
    FROM target
    WHERE target.is_public
      OR EXISTS (
        SELECT 1
        FROM public.session_registrations AS own_participation
        LEFT JOIN public.customers AS own_direct_person
          ON own_direct_person.id = own_participation.customer_id
        LEFT JOIN public.customers AS own_user_person
          ON own_participation.customer_id IS NULL
         AND own_user_person.auth_user_id = own_participation.user_id
         AND own_user_person.status = 'active'
        WHERE own_participation.activity_session_id = target.session_id
          AND own_participation.session_date = target.session_date
          AND own_participation.status IN ('confirmed', 'checked_in', 'attended')
          AND COALESCE(
            own_direct_person.merged_into_id,
            own_direct_person.id,
            own_user_person.merged_into_id,
            own_user_person.id
          ) = v_caller_person_id
      )
  ), occurrence_participations AS MATERIALIZED (
    SELECT
      target.ordinal,
      target.session_id,
      target.session_date,
      target.venue_id,
      target.start_time,
      participation.id AS participation_id,
      participation.role,
      participation.registered_at,
      participation.dependent_participant_id,
      COALESCE(direct_person.merged_into_id, direct_person.id, user_person.merged_into_id, user_person.id) AS person_id
    FROM authorized_target AS target
    JOIN public.session_registrations AS participation
      ON participation.activity_session_id = target.session_id
     AND participation.session_date = target.session_date
     AND participation.status IN ('confirmed', 'checked_in', 'attended')
    LEFT JOIN public.customers AS direct_person ON direct_person.id = participation.customer_id
    LEFT JOIN public.customers AS user_person
      ON participation.customer_id IS NULL
     AND user_person.auth_user_id = participation.user_id
     AND user_person.status = 'active'
  ), occurrence_people AS MATERIALIZED (
    SELECT
      participation.ordinal,
      participation.session_id,
      participation.session_date,
      participation.venue_id,
      participation.start_time,
      participation.person_id,
      BOOL_OR(participation.role = 'host') AS is_host,
      MIN(participation.registered_at) AS registered_at
    FROM occurrence_participations AS participation
    WHERE participation.dependent_participant_id IS NULL
      AND participation.person_id IS NOT NULL
    GROUP BY
      participation.ordinal,
      participation.session_id,
      participation.session_date,
      participation.venue_id,
      participation.start_time,
      participation.person_id
  ), history_people AS MATERIALIZED (
    SELECT DISTINCT
      target.ordinal,
      history.activity_session_id,
      history.session_date,
      COALESCE(
        history_direct_person.merged_into_id,
        history_direct_person.id,
        history_user_person.merged_into_id,
        history_user_person.id
      ) AS person_id
    FROM authorized_target AS target
    JOIN public.session_registrations AS history
      ON history.venue_id = target.venue_id
     AND history.status IN ('checked_in', 'attended')
     AND history.dependent_participant_id IS NULL
    LEFT JOIN public.customers AS history_direct_person
      ON history_direct_person.id = history.customer_id
    LEFT JOIN public.customers AS history_user_person
      ON history.customer_id IS NULL
     AND history_user_person.auth_user_id = history.user_id
     AND history_user_person.status = 'active'
    JOIN public.activity_sessions AS history_session
      ON history_session.id = history.activity_session_id
    WHERE history.session_date < target.session_date
       OR (
         history.session_date = target.session_date
         AND history_session.start_time < target.start_time
       )
  ), prior_people AS MATERIALIZED (
    SELECT DISTINCT current_person.ordinal, current_person.person_id
    FROM occurrence_people AS current_person
    JOIN history_people AS history
      ON history.ordinal = current_person.ordinal
     AND history.person_id = current_person.person_id
  ), caller_history AS MATERIALIZED (
    SELECT DISTINCT
      history.ordinal,
      history.activity_session_id,
      history.session_date
    FROM history_people AS history
    WHERE history.person_id = v_caller_person_id
  ), shared_people AS MATERIALIZED (
    SELECT DISTINCT caller_history.ordinal, COALESCE(direct_person.merged_into_id, direct_person.id, user_person.merged_into_id, user_person.id) AS person_id
    FROM caller_history
    JOIN public.session_registrations AS peer_history
      ON peer_history.activity_session_id = caller_history.activity_session_id
     AND peer_history.session_date = caller_history.session_date
     AND peer_history.status IN ('checked_in', 'attended')
     AND peer_history.dependent_participant_id IS NULL
    LEFT JOIN public.customers AS direct_person ON direct_person.id = peer_history.customer_id
    LEFT JOIN public.customers AS user_person
      ON peer_history.customer_id IS NULL
     AND user_person.auth_user_id = peer_history.user_id
     AND user_person.status = 'active'
  ), visible_people AS MATERIALIZED (
    SELECT
      current_person.*,
      person.social_visibility,
      NULLIF(BTRIM(COALESCE(person.first_name, profile.first_name, split_part(COALESCE(person.display_name, profile.display_name, ''), ' ', 1))), '') AS first_name,
      NULLIF(BTRIM(COALESCE(
        person.last_name,
        profile.last_name,
        CASE
          WHEN BTRIM(COALESCE(person.display_name, profile.display_name, '')) LIKE '% %'
          THEN regexp_replace(BTRIM(COALESCE(person.display_name, profile.display_name, '')), '^.*\s+', '')
          ELSE NULL
        END
      )), '') AS last_name,
      profile.avatar_url,
      EXISTS (
        SELECT 1 FROM prior_people
        WHERE prior_people.ordinal = current_person.ordinal
          AND prior_people.person_id = current_person.person_id
      ) AS has_prior_visit,
      (
        current_person.person_id <> v_caller_person_id
        AND EXISTS (
          SELECT 1 FROM shared_people
          WHERE shared_people.ordinal = current_person.ordinal
            AND shared_people.person_id = current_person.person_id
        )
      ) AS has_shared_history
    FROM occurrence_people AS current_person
    JOIN public.customers AS person
      ON person.id = current_person.person_id
     AND person.status = 'active'
     AND person.merged_into_id IS NULL
    LEFT JOIN LATERAL (
      SELECT candidate.first_name, candidate.last_name, candidate.display_name, candidate.avatar_url
      FROM public.player_profiles AS candidate
      WHERE candidate.customer_id = person.id
         OR (person.auth_user_id IS NOT NULL AND candidate.auth_user_id = person.auth_user_id)
      ORDER BY (candidate.customer_id = person.id) DESC, candidate.updated_at DESC NULLS LAST, candidate.id
      LIMIT 1
    ) AS profile ON true
  ), ranked_visible_people AS MATERIALIZED (
    SELECT
      visible_people.*,
      ROW_NUMBER() OVER (
        PARTITION BY visible_people.ordinal
        ORDER BY visible_people.is_host DESC, visible_people.registered_at, visible_people.person_id
      ) AS visible_rank
    FROM visible_people
  ), contexts AS (
    SELECT
      target.ordinal,
      target.session_id,
      target.session_date,
      jsonb_build_object(
        'session_id', target.session_id,
        'session_date', target.session_date,
        'attendee_count', COUNT(participation.participation_id)::INTEGER,
        'hidden_count', COUNT(participation.participation_id) FILTER (
          WHERE participation.dependent_participant_id IS NOT NULL
             OR participation.person_id IS NULL
             OR visible_person.social_visibility IS DISTINCT FROM 'visible'
        )::INTEGER,
        'first_visit_count', COUNT(DISTINCT visible_person.person_id) FILTER (
          WHERE visible_person.social_visibility = 'visible'
            AND visible_person.has_prior_visit = false
        )::INTEGER,
        'shared_history_count', COUNT(DISTINCT visible_person.person_id) FILTER (
          WHERE visible_person.social_visibility = 'visible'
            AND visible_person.has_shared_history
        )::INTEGER,
        'attendees', COALESCE(
          jsonb_agg(DISTINCT jsonb_build_object(
            'person_id', visible_person.person_id,
            'display_name', CASE
              WHEN visible_person.last_name IS NOT NULL
              THEN visible_person.first_name || ' ' || UPPER(LEFT(visible_person.last_name, 1)) || '.'
              ELSE visible_person.first_name
            END,
            'avatar_url', visible_person.avatar_url,
            'is_host', visible_person.is_host,
            'is_first_visit', NOT visible_person.has_prior_visit,
            'has_shared_session_history', visible_person.has_shared_history
          )) FILTER (
            WHERE visible_person.social_visibility = 'visible'
              AND visible_person.first_name IS NOT NULL
              AND visible_person.visible_rank <= 80
          ),
          '[]'::JSONB
        )
      ) AS context
    FROM authorized_target AS target
    LEFT JOIN occurrence_participations AS participation
      ON participation.ordinal = target.ordinal
    LEFT JOIN ranked_visible_people AS visible_person
      ON visible_person.ordinal = target.ordinal
     AND visible_person.person_id = participation.person_id
    GROUP BY target.ordinal, target.session_id, target.session_date
  )
  SELECT COALESCE(jsonb_agg(contexts.context ORDER BY contexts.ordinal), '[]'::JSONB)
  INTO v_result
  FROM contexts;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_session_social_context(
  p_session_id UUID,
  p_session_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contexts JSONB;
BEGIN
  v_contexts := public.get_session_social_context_batch(
    jsonb_build_array(jsonb_build_object(
      'session_id', p_session_id,
      'session_date', p_session_date
    ))
  );
  RETURN v_contexts->0;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_session_social_context(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_date DATE;
BEGIN
  SELECT session.session_date INTO v_session_date
  FROM public.activity_sessions AS session
  WHERE session.id = p_session_id;
  IF v_session_date IS NULL THEN RETURN NULL; END IF;
  RETURN public.get_session_social_context(p_session_id, v_session_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_played_with(
  p_session_id UUID,
  p_session_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_user_id UUID := auth.uid();
  v_caller_person_id UUID;
  v_result JSONB;
BEGIN
  IF v_caller_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = v_caller_user_id
      AND COALESCE(auth_user.email_confirmed_at, auth_user.phone_confirmed_at) IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'verified_account_required';
  END IF;

  SELECT COALESCE(person.merged_into_id, person.id)
  INTO v_caller_person_id
  FROM public.customers AS person
  WHERE person.auth_user_id = v_caller_user_id
    AND person.status = 'active'
  ORDER BY (person.merged_into_id IS NULL) DESC, person.created_at ASC
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1
    FROM public.session_registrations AS own_participation
    LEFT JOIN public.customers AS own_direct_person
      ON own_direct_person.id = own_participation.customer_id
    LEFT JOIN public.customers AS own_user_person
      ON own_participation.customer_id IS NULL
     AND own_user_person.auth_user_id = own_participation.user_id
     AND own_user_person.status = 'active'
    WHERE own_participation.activity_session_id = p_session_id
      AND own_participation.session_date = p_session_date
      AND own_participation.status IN ('checked_in', 'attended')
      AND COALESCE(
        own_direct_person.merged_into_id,
        own_direct_person.id,
        own_user_person.merged_into_id,
        own_user_person.id
      ) = v_caller_person_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'attended_participation_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.activity_sessions AS session
    WHERE session.id = p_session_id
      AND (session.session_date IS NULL OR session.session_date = p_session_date)
      AND (
        session.session_date IS NOT NULL
        OR EXTRACT(DOW FROM p_session_date)::INTEGER = ANY(session.recurrence_days)
      )
      AND (
        (
          CASE
            WHEN session.end_time = TIME '00:00' AND session.start_time > TIME '00:00'
            THEN p_session_date + 1 + session.end_time
            ELSE p_session_date + session.end_time
          END
        ) AT TIME ZONE 'Europe/Stockholm'
      ) <= now()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'completed_session_required';
  END IF;

  WITH peers AS MATERIALIZED (
    SELECT DISTINCT
      COALESCE(direct_person.merged_into_id, direct_person.id, user_person.merged_into_id, user_person.id) AS person_id,
      BOOL_OR(participation.role = 'host') AS is_host
    FROM public.session_registrations AS participation
    LEFT JOIN public.customers AS direct_person ON direct_person.id = participation.customer_id
    LEFT JOIN public.customers AS user_person
      ON participation.customer_id IS NULL
     AND user_person.auth_user_id = participation.user_id
     AND user_person.status = 'active'
    WHERE participation.activity_session_id = p_session_id
      AND participation.session_date = p_session_date
      AND participation.status IN ('checked_in', 'attended')
      AND participation.dependent_participant_id IS NULL
    GROUP BY COALESCE(direct_person.merged_into_id, direct_person.id, user_person.merged_into_id, user_person.id)
  ), projected AS (
    SELECT
      person.id AS person_id,
      NULLIF(BTRIM(COALESCE(person.first_name, profile.first_name, split_part(COALESCE(person.display_name, profile.display_name, ''), ' ', 1))), '') AS first_name,
      NULLIF(BTRIM(COALESCE(
        person.last_name,
        profile.last_name,
        CASE
          WHEN BTRIM(COALESCE(person.display_name, profile.display_name, '')) LIKE '% %'
          THEN regexp_replace(BTRIM(COALESCE(person.display_name, profile.display_name, '')), '^.*\s+', '')
          ELSE NULL
        END
      )), '') AS last_name,
      profile.avatar_url,
      peers.is_host
    FROM peers
    JOIN public.customers AS person
      ON person.id = peers.person_id
     AND person.status = 'active'
     AND person.merged_into_id IS NULL
     AND person.social_visibility = 'visible'
     AND person.id <> v_caller_person_id
    LEFT JOIN LATERAL (
      SELECT candidate.first_name, candidate.last_name, candidate.display_name, candidate.avatar_url
      FROM public.player_profiles AS candidate
      WHERE candidate.customer_id = person.id
         OR (person.auth_user_id IS NOT NULL AND candidate.auth_user_id = person.auth_user_id)
      ORDER BY (candidate.customer_id = person.id) DESC, candidate.updated_at DESC NULLS LAST, candidate.id
      LIMIT 1
    ) AS profile ON true
    ORDER BY peers.is_host DESC, first_name, person.id
    LIMIT 80
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'person_id', projected.person_id,
    'display_name', CASE
      WHEN projected.last_name IS NOT NULL
      THEN projected.first_name || ' ' || UPPER(LEFT(projected.last_name, 1)) || '.'
      ELSE projected.first_name
    END,
    'avatar_url', projected.avatar_url,
    'is_host', projected.is_host
  ) ORDER BY projected.first_name, projected.person_id) FILTER (WHERE projected.first_name IS NOT NULL), '[]'::JSONB)
  INTO v_result
  FROM projected;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_played_with(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_date DATE;
BEGIN
  SELECT session.session_date INTO v_session_date
  FROM public.activity_sessions AS session
  WHERE session.id = p_session_id;
  IF v_session_date IS NULL THEN RETURN NULL; END IF;
  RETURN public.get_played_with(p_session_id, v_session_date);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_session_public_context(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_session_public_context(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_session_social_context(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_session_social_context(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_session_social_context_batch(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_played_with(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_played_with(UUID, DATE) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_session_public_context(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_public_context(UUID, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_social_context(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_social_context(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_social_context_batch(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_played_with(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_played_with(UUID, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_session_public_context(UUID) IS
  'Counts-only public context for a concrete one-off Session. Recurring legacy schedule templates require the date overload.';
COMMENT ON FUNCTION public.get_session_social_context(UUID) IS
  'Verified-only, privacy-filtered Person context for a concrete one-off Session. Shared history is derived from Participation.';
COMMENT ON FUNCTION public.get_played_with(UUID) IS
  'Verified-only visible Persons from a completed Session the caller attended. No relationship is persisted.';
