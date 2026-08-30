-- Customer Performance V2 Phase B2: one bounded, read-only fact projection
-- for Today promotions. Pricing precedence deliberately remains in the shared
-- Edge pricing resolvers; this function only batches their canonical inputs.

CREATE OR REPLACE FUNCTION public.public_customer_today_secondary_facts(
  p_venue_slug TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_as_of TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH input_scope AS MATERIALIZED (
    SELECT
      NULLIF(BTRIM(p_venue_slug), '') AS venue_slug,
      p_start_date AS start_date,
      p_end_date AS end_date,
      COALESCE(p_as_of, now()) AS as_of
    WHERE p_start_date IS NOT NULL
      AND p_end_date IS NOT NULL
      AND p_end_date >= p_start_date
      AND p_end_date <= p_start_date + 13
  ),
  venue_scope AS MATERIALIZED (
    SELECT venue.id, venue.slug
    FROM public.venues venue
    JOIN input_scope input ON input.venue_slug = venue.slug
    WHERE venue.is_public = true
    LIMIT 1
  ),

  -- Course Home currently considers at most four open Series rows, ordered by
  -- registration close. presentation_type is intentionally not filtered:
  -- social_event Series such as Parker Brunch use this same discovery domain.
  course_candidates AS MATERIALIZED (
    SELECT
      series.id,
      series.venue_id,
      series.name,
      series.image_urls,
      series.start_date,
      series.registration_opens_at,
      series.registration_closes_at,
      series.capacity,
      format.name AS format_name,
      format.description AS format_description,
      format.image_urls AS format_image_urls,
      format.presentation_type,
      product.id AS product_id,
      product.product_key,
      product.product_kind,
      product.base_price_sek,
      product.scarcity_mode,
      product.early_bird_price_minor,
      product.early_bird_slots,
      product.resolver_rules
    FROM venue_scope venue
    JOIN input_scope input ON true
    JOIN public.activity_series series ON series.venue_id = venue.id
    LEFT JOIN public.activity_formats format ON format.id = series.format_id
    LEFT JOIN public.access_products product
      ON product.id = series.access_product_id
     AND product.venue_id = series.venue_id
    WHERE series.series_type = 'course'
      AND series.status = 'active'
      AND series.registration_opens_at <= input.as_of
      AND series.registration_closes_at > input.as_of
    ORDER BY series.registration_closes_at ASC, series.id ASC
    LIMIT 4
  ),
  course_commitment_counts AS (
    SELECT
      commitment.activity_series_id,
      COUNT(*)::INTEGER AS committed_count,
      COUNT(*) FILTER (
        WHERE line.resolver_snapshot->>'pricing_reason' = 'early_bird'
      )::INTEGER AS early_bird_committed
    FROM public.series_commitments commitment
    JOIN course_candidates course ON course.id = commitment.activity_series_id
    LEFT JOIN public.commerce_order_lines line ON line.id = commitment.commerce_order_line_id
    WHERE commitment.venue_id = course.venue_id
      AND commitment.commitment_type = 'participant'
      AND commitment.status = 'active'
    GROUP BY commitment.activity_series_id
  ),
  course_hold_counts AS (
    SELECT
      hold.scope_id,
      COUNT(*)::INTEGER AS active_holds_count,
      COUNT(*) FILTER (
        WHERE hold.metadata->>'applied_price_type' = 'early_bird'
      )::INTEGER AS early_bird_holds
    FROM public.capacity_holds hold
    JOIN course_candidates course
      ON hold.scope_id = course.id::TEXT
     AND hold.venue_id = course.venue_id
     AND hold.session_date = course.start_date
    JOIN input_scope input ON true
    WHERE hold.scope_type = 'activity_series'
      AND hold.status = 'active'
      AND hold.expires_at > input.as_of
    GROUP BY hold.scope_id
  ),
  course_facts AS (
    SELECT
      course.*,
      COALESCE(commitment.committed_count, 0) AS committed_count,
      COALESCE(hold.active_holds_count, 0) AS active_holds_count,
      COALESCE(commitment.early_bird_committed, 0)
        + COALESCE(hold.early_bird_holds, 0) AS early_bird_fill_count
    FROM course_candidates course
    LEFT JOIN course_commitment_counts commitment ON commitment.activity_series_id = course.id
    LEFT JOIN course_hold_counts hold ON hold.scope_id = course.id::TEXT
  ),

  -- League Home chooses one active Series whose registration has not closed.
  -- Fixtures, standings, courts, teams and full sessions are not Today facts.
  league_candidate AS MATERIALIZED (
    SELECT
      series.id AS series_id,
      series.venue_id,
      series.name,
      series.image_urls,
      series.start_date,
      series.registration_opens_at,
      series.registration_closes_at,
      season.id AS season_id,
      season.team_capacity,
      season.players_per_team,
      season.league_night_count,
      season.matches_per_team_per_night,
      product.id AS product_id,
      product.product_key,
      product.product_kind,
      product.base_price_sek,
      product.scarcity_mode,
      product.early_bird_price_minor,
      product.early_bird_slots
    FROM venue_scope venue
    JOIN input_scope input ON true
    JOIN public.activity_series series ON series.venue_id = venue.id
    JOIN public.league_seasons season ON season.activity_series_id = series.id
    JOIN public.access_products product
      ON product.id = series.access_product_id
     AND product.venue_id = series.venue_id
    WHERE series.series_type = 'league'
      AND series.status = 'active'
      AND series.registration_closes_at > input.as_of
    ORDER BY series.start_date ASC, series.id ASC
    LIMIT 1
  ),
  league_team_counts AS (
    SELECT entry.league_season_id,
      COUNT(*) FILTER (WHERE entry.status = 'active')::INTEGER AS active_teams,
      COUNT(*) FILTER (
        WHERE entry.status = 'active' AND entry.pricing_reason = 'early_bird'
      )::INTEGER AS early_bird_teams
    FROM public.league_team_entries entry
    JOIN league_candidate league ON league.season_id = entry.league_season_id
    GROUP BY entry.league_season_id
  ),
  league_hold_counts AS (
    SELECT
      league.season_id,
      COUNT(hold.id)::INTEGER AS active_holds,
      COUNT(hold.id) FILTER (
        WHERE hold.metadata->>'applied_price_type' = 'early_bird'
      )::INTEGER AS early_bird_holds
    FROM league_candidate league
    JOIN input_scope input ON true
    LEFT JOIN public.capacity_holds hold
      ON hold.scope_type = 'league_season'
     AND hold.scope_id = league.season_id::TEXT
     AND hold.status = 'active'
     AND (hold.expires_at > input.as_of OR hold.stripe_session_id IS NOT NULL)
    GROUP BY league.season_id
  ),
  league_facts AS (
    SELECT
      league.*,
      COALESCE(team.active_teams, 0) AS active_teams,
      COALESCE(hold.active_holds, 0) AS active_holds,
      COALESCE(team.early_bird_teams, 0)
        + COALESCE(hold.early_bird_holds, 0) AS early_bird_allocated
    FROM league_candidate league
    LEFT JOIN league_team_counts team ON team.league_season_id = league.season_id
    LEFT JOIN league_hold_counts hold ON hold.season_id = league.season_id
  ),

  -- Bound the set of session templates before recurrence expansion. Today asks
  -- for seven days; the function rejects ranges longer than fourteen days.
  activity_session_candidates AS MATERIALIZED (
    SELECT
      session.id,
      session.venue_id,
      session.name,
      session.session_type,
      session.session_date,
      session.recurrence_days,
      session.start_time,
      session.end_time,
      session.capacity,
      session.price_sek,
      session.product_key,
      session.access_policy,
      session.metadata,
      session.early_bird_price_minor,
      session.early_bird_slots,
      session.scarcity_mode,
      session.first_visit_offer_enabled,
      session.first_visit_price_minor,
      session.first_visit_only,
      CASE
        WHEN session.product_key IS NOT NULL AND session.product_key <> 'day_access'
          THEN session.product_key
        WHEN session.session_type = 'open_play' THEN 'open_play_slot'
        WHEN session.session_type = 'group_training' THEN 'group_training'
        ELSE 'session_ticket'
      END AS resolved_product_key
    FROM venue_scope venue
    JOIN input_scope input ON true
    JOIN public.activity_sessions session ON session.venue_id = venue.id
    WHERE session.is_active = true
      AND session.publish_status = 'published'
      AND session.closed_to_public = false
      AND (
        session.session_date BETWEEN input.start_date AND input.end_date
        OR (
          session.session_date IS NULL
          AND EXISTS (
            SELECT 1
            FROM generate_series(input.start_date, input.end_date, INTERVAL '1 day') candidate_day
            WHERE EXTRACT(DOW FROM candidate_day)::INTEGER = ANY(
              COALESCE(session.recurrence_days, ARRAY[]::INTEGER[])
            )
          )
        )
      )
    ORDER BY session.first_visit_offer_enabled DESC, session.start_time ASC, session.id ASC
    LIMIT 64
  ),
  activity_occurrences AS MATERIALIZED (
    SELECT
      session.*,
      day::DATE AS occurrence_date
    FROM activity_session_candidates session
    JOIN input_scope input ON true
    CROSS JOIN LATERAL generate_series(input.start_date, input.end_date, INTERVAL '1 day') day
    WHERE (
      session.session_date = day::DATE
      OR (
        session.session_date IS NULL
        AND EXTRACT(DOW FROM day)::INTEGER = ANY(COALESCE(session.recurrence_days, ARRAY[]::INTEGER[]))
      )
    )
      AND NOT EXISTS (
        SELECT 1
        FROM public.activity_session_overrides override
        WHERE override.venue_id = session.venue_id
          AND override.activity_session_id = session.id
          AND override.session_date = day::DATE
          AND override.status IN ('hidden', 'cancelled')
      )
    ORDER BY day::DATE, session.start_time, session.id
    LIMIT 256
  ),
  activity_registration_counts AS (
    SELECT
      occurrence.id AS activity_session_id,
      occurrence.occurrence_date,
      COUNT(registration.id) FILTER (
        WHERE registration.status IN ('confirmed', 'checked_in', 'no_show')
      )::INTEGER AS committed_count,
      COUNT(registration.id) FILTER (
        WHERE registration.status IN ('confirmed', 'checked_in', 'no_show')
          AND registration.metadata->>'pricing_reason' = 'early_bird'
      )::INTEGER AS early_bird_committed
    FROM activity_occurrences occurrence
    LEFT JOIN public.session_registrations registration
      ON registration.venue_id = occurrence.venue_id
     AND registration.activity_session_id = occurrence.id
     AND registration.session_date = occurrence.occurrence_date
    GROUP BY occurrence.id, occurrence.occurrence_date
  ),
  activity_hold_counts AS (
    SELECT
      occurrence.id AS activity_session_id,
      occurrence.occurrence_date,
      COUNT(hold.id)::INTEGER AS active_holds,
      COUNT(hold.id) FILTER (
        WHERE hold.metadata->>'applied_price_type' = 'early_bird'
      )::INTEGER AS early_bird_holds
    FROM activity_occurrences occurrence
    JOIN input_scope input ON true
    LEFT JOIN public.capacity_holds hold
      ON hold.venue_id = occurrence.venue_id
     AND hold.scope_type = 'activity_session'
     AND hold.scope_id = occurrence.id::TEXT
     AND hold.session_date = occurrence.occurrence_date
     AND hold.status = 'active'
     AND hold.expires_at > input.as_of
    GROUP BY occurrence.id, occurrence.occurrence_date
  ),
  activity_facts AS (
    SELECT
      occurrence.*,
      product.id AS product_id,
      product.product_kind,
      product.base_price_sek AS product_base_price_sek,
      product.early_bird_price_minor AS product_early_bird_price_minor,
      product.early_bird_slots AS product_early_bird_slots,
      product.scarcity_mode AS product_scarcity_mode,
      COALESCE(registration.committed_count, 0)
        + COALESCE(hold.active_holds, 0) AS fill_count,
      COALESCE(registration.early_bird_committed, 0)
        + COALESCE(hold.early_bird_holds, 0) AS early_bird_fill_count
    FROM activity_occurrences occurrence
    LEFT JOIN public.access_products product
      ON product.venue_id = occurrence.venue_id
     AND product.product_key = occurrence.resolved_product_key
     AND product.is_active = true
    LEFT JOIN activity_registration_counts registration
      ON registration.activity_session_id = occurrence.id
     AND registration.occurrence_date = occurrence.occurrence_date
    LEFT JOIN activity_hold_counts hold
      ON hold.activity_session_id = occurrence.id
     AND hold.occurrence_date = occurrence.occurrence_date
  )
  SELECT jsonb_build_object(
    'input_valid', EXISTS (SELECT 1 FROM input_scope),
    'venue_found', EXISTS (SELECT 1 FROM venue_scope),
    'venue_id', (SELECT venue.id FROM venue_scope venue),
    'course_candidates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'series', jsonb_build_object(
          'id', course.id,
          'venue_id', course.venue_id,
          'access_product_id', course.product_id,
          'name', course.name,
          'start_date', course.start_date,
          'registration_opens_at', course.registration_opens_at,
          'registration_closes_at', course.registration_closes_at,
          'capacity', course.capacity
        ),
        'format', jsonb_build_object(
          'name', course.format_name,
          'description', course.format_description,
          'presentation_type', course.presentation_type
        ),
        'artwork_url', COALESCE(course.image_urls[1], course.format_image_urls[1]),
        'product', CASE WHEN course.product_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', course.product_id,
          'venue_id', course.venue_id,
          'product_key', course.product_key,
          'product_kind', course.product_kind,
          'base_price_sek', course.base_price_sek,
          'scarcity_mode', course.scarcity_mode,
          'early_bird_price_minor', course.early_bird_price_minor,
          'early_bird_slots', course.early_bird_slots,
          'resolver_rules', course.resolver_rules
        ) END,
        'capacity_fill', jsonb_build_object(
          'capacity', course.capacity,
          'committed_count', course.committed_count,
          'active_holds_count', course.active_holds_count,
          'fill_count', course.committed_count + course.active_holds_count,
          'available_count', GREATEST(
            COALESCE(course.capacity, 0) - course.committed_count - course.active_holds_count,
            0
          )
        ),
        'early_bird_fill', jsonb_build_object('fill_count', course.early_bird_fill_count),
        'includes_open_play', COALESCE(
          course.resolver_rules #>> '{included_benefits,open_play_series_period,enabled}',
          'false'
        ) = 'true'
      ) ORDER BY course.registration_closes_at ASC, course.id ASC)
      FROM course_facts course
    ), '[]'::JSONB),
    'league_candidate', (
      SELECT jsonb_build_object(
        'series_id', league.series_id,
        'venue_id', league.venue_id,
        'name', league.name,
        'artwork_url', league.image_urls[1],
        'start_date', league.start_date,
        'registration_opens_at', league.registration_opens_at,
        'registration_closes_at', league.registration_closes_at,
        'season_id', league.season_id,
        'team_capacity', league.team_capacity,
        'players_per_team', league.players_per_team,
        'league_night_count', league.league_night_count,
        'matches_per_team_per_night', league.matches_per_team_per_night,
        'product', jsonb_build_object(
          'id', league.product_id,
          'product_key', league.product_key,
          'product_kind', league.product_kind,
          'base_price_sek', league.base_price_sek,
          'scarcity_mode', league.scarcity_mode,
          'early_bird_price_minor', league.early_bird_price_minor,
          'early_bird_slots', league.early_bird_slots
        ),
        'capacity_fill', jsonb_build_object(
          'team_capacity', league.team_capacity,
          'active_teams', league.active_teams,
          'active_holds', league.active_holds,
          'fill_count', league.active_teams + league.active_holds,
          'available_count', GREATEST(
            league.team_capacity - league.active_teams - league.active_holds,
            0
          ),
          'early_bird_allocated', league.early_bird_allocated,
          'early_bird_remaining', CASE
            WHEN league.scarcity_mode = 'early_bird' THEN GREATEST(
              COALESCE(league.early_bird_slots, 0) - league.early_bird_allocated,
              0
            )
            ELSE NULL
          END
        )
      )
      FROM league_facts league
    ),
    'has_configured_first_visit_offer', EXISTS (
      SELECT 1
      FROM venue_scope venue
      JOIN public.activity_sessions session ON session.venue_id = venue.id
      WHERE session.is_active = true
        AND session.publish_status = 'published'
        AND session.closed_to_public = false
        AND session.first_visit_offer_enabled = true
    ),
    'activity_occurrences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'session', jsonb_build_object(
          'id', activity.id,
          'venue_id', activity.venue_id,
          'name', activity.name,
          'session_type', activity.session_type,
          'session_date', activity.session_date,
          'start_time', activity.start_time,
          'end_time', activity.end_time,
          'capacity', activity.capacity,
          'price_sek', activity.price_sek,
          'product_key', activity.product_key,
          'access_policy', activity.access_policy,
          'metadata', activity.metadata,
          'early_bird_price_minor', activity.early_bird_price_minor,
          'early_bird_slots', activity.early_bird_slots,
          'scarcity_mode', activity.scarcity_mode,
          'first_visit_offer_enabled', activity.first_visit_offer_enabled,
          'first_visit_price_minor', activity.first_visit_price_minor,
          'first_visit_only', activity.first_visit_only
        ),
        'session_date', activity.occurrence_date,
        'resolved_product_key', activity.resolved_product_key,
        'product', CASE WHEN activity.product_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', activity.product_id,
          'venue_id', activity.venue_id,
          'product_key', activity.resolved_product_key,
          'product_kind', activity.product_kind,
          'base_price_sek', activity.product_base_price_sek,
          'early_bird_price_minor', activity.product_early_bird_price_minor,
          'early_bird_slots', activity.product_early_bird_slots,
          'scarcity_mode', activity.product_scarcity_mode
        ) END,
        'capacity_fill', jsonb_build_object('fill_count', activity.fill_count),
        'early_bird_fill', jsonb_build_object('fill_count', activity.early_bird_fill_count)
      ) ORDER BY activity.occurrence_date, activity.start_time, activity.id)
      FROM activity_facts activity
    ), '[]'::JSONB)
  );
$$;

COMMENT ON FUNCTION public.public_customer_today_secondary_facts(TEXT, DATE, DATE, TIMESTAMPTZ) IS
  'Bounded read-only facts for Today Course, League and First Visit discovery. Shared Edge resolvers retain display-pricing precedence; checkout revalidates transaction truth.';

REVOKE ALL ON FUNCTION public.public_customer_today_secondary_facts(TEXT, DATE, DATE, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_customer_today_secondary_facts(TEXT, DATE, DATE, TIMESTAMPTZ)
  TO service_role;
