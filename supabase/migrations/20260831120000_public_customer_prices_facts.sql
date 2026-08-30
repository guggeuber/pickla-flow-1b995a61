-- Customer Performance V2 Phase D: one bounded, read-only fact projection
-- for the public Prices page. Display prices retain their canonical owners;
-- checkout, entitlements and frozen financial truth are intentionally absent.

CREATE OR REPLACE FUNCTION public.public_customer_prices_facts(
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
    SELECT NULLIF(BTRIM(p_venue_slug), '') AS venue_slug,
      p_start_date AS start_date,
      p_end_date AS end_date,
      COALESCE(p_as_of, now()) AS as_of
    WHERE p_start_date IS NOT NULL
      AND p_end_date IS NOT NULL
      AND p_end_date >= p_start_date
      AND p_end_date <= p_start_date + 13
  ),
  venue_scope AS MATERIALIZED (
    SELECT venue.id, venue.slug, venue.commerce_enabled
    FROM public.venues venue
    JOIN input_scope input ON input.venue_slug = venue.slug
    WHERE venue.is_public = true
    LIMIT 1
  ),
  membership_rows AS MATERIALIZED (
    SELECT tier.id, tier.name, tier.description, tier.monthly_price, tier.sort_order
    FROM venue_scope venue
    JOIN public.membership_tiers tier ON tier.venue_id = venue.id
    WHERE tier.is_active = true
    ORDER BY tier.sort_order ASC NULLS LAST, tier.id ASC
    LIMIT 20
  ),
  court_price_rows AS MATERIALIZED (
    SELECT rule.id, rule.name, rule.type, rule.price, rule.days_of_week, rule.time_from, rule.time_to
    FROM venue_scope venue
    JOIN public.pricing_rules rule ON rule.venue_id = venue.id
    WHERE rule.type = 'hourly' AND rule.is_active = true
    ORDER BY rule.time_from ASC, rule.id ASC
    LIMIT 64
  ),
  commerce_candidates AS MATERIALIZED (
    SELECT product.id, product.product_key, product.product_kind, product.name,
      product.description, product.commerce_kind, product.fulfillment_type,
      product.fulfillment_presentation, product.base_price_sek, product.vat_rate,
      product.status, product.is_active, product.standalone_enabled,
      product.activity_addon_enabled, product.category, product.sort_order,
      EXISTS (
        SELECT 1 FROM public.product_relationships relationship
        WHERE relationship.venue_id = venue.id
          AND relationship.target_product_id = product.id
          AND relationship.is_active = true
      ) AS has_active_relationship
    FROM venue_scope venue
    JOIN public.access_products product ON product.venue_id = venue.id
    WHERE product.status = 'active'
      AND product.is_active = true
      AND (
        product.product_key = 'day_access'
        OR product.product_kind IN ('day_access', 'punch_card')
        OR product.category = 'punch_card'
      )
    ORDER BY product.sort_order ASC, product.id ASC
    LIMIT 64
  ),
  course_rows AS MATERIALIZED (
    SELECT series.id, series.name, series.start_date,
      format.description AS format_description, product.base_price_sek
    FROM venue_scope venue
    JOIN input_scope input ON true
    JOIN public.activity_series series ON series.venue_id = venue.id
    JOIN public.activity_formats format ON format.id = series.format_id
    JOIN public.access_products product
      ON product.id = series.access_product_id AND product.venue_id = series.venue_id
    WHERE series.series_type = 'course'
      AND format.presentation_type = 'course'
      AND series.status = 'active'
      AND series.end_date >= input.start_date
    ORDER BY series.start_date ASC NULLS LAST, series.id ASC
    LIMIT 24
  ),

  -- Only templates that can contribute a First Visit presentation are expanded.
  -- This replaces the old resolver loop over every public occurrence.
  first_visit_session_candidates AS MATERIALIZED (
    SELECT session.id, session.venue_id, session.name, session.session_type,
      session.session_date, session.recurrence_days, session.start_time,
      session.end_time, session.capacity, session.price_sek, session.product_key,
      session.access_policy, session.metadata, session.early_bird_price_minor,
      session.early_bird_slots, session.scarcity_mode,
      session.first_visit_offer_enabled, session.first_visit_price_minor,
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
      AND session.first_visit_offer_enabled = true
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
    ORDER BY session.start_time ASC, session.id ASC
    LIMIT 64
  ),
  first_visit_occurrences AS MATERIALIZED (
    SELECT session.*, day::DATE AS occurrence_date
    FROM first_visit_session_candidates session
    JOIN input_scope input ON true
    CROSS JOIN LATERAL generate_series(input.start_date, input.end_date, INTERVAL '1 day') day
    WHERE session.session_date = day::DATE
      OR (
        session.session_date IS NULL
        AND EXTRACT(DOW FROM day)::INTEGER = ANY(COALESCE(session.recurrence_days, ARRAY[]::INTEGER[]))
      )
    ORDER BY day::DATE, session.start_time, session.id
    LIMIT 256
  ),
  first_visit_registration_counts AS (
    SELECT occurrence.id AS activity_session_id, occurrence.occurrence_date,
      COUNT(registration.id) FILTER (
        WHERE registration.status IN ('confirmed', 'checked_in', 'no_show')
      )::INTEGER AS committed_count,
      COUNT(registration.id) FILTER (
        WHERE registration.status IN ('confirmed', 'checked_in', 'no_show')
          AND registration.metadata->>'pricing_reason' = 'early_bird'
      )::INTEGER AS early_bird_committed
    FROM first_visit_occurrences occurrence
    LEFT JOIN public.session_registrations registration
      ON registration.venue_id = occurrence.venue_id
     AND registration.activity_session_id = occurrence.id
     AND registration.session_date = occurrence.occurrence_date
    GROUP BY occurrence.id, occurrence.occurrence_date
  ),
  first_visit_hold_counts AS (
    SELECT occurrence.id AS activity_session_id, occurrence.occurrence_date,
      COUNT(hold.id)::INTEGER AS active_holds,
      COUNT(hold.id) FILTER (
        WHERE hold.metadata->>'applied_price_type' = 'early_bird'
      )::INTEGER AS early_bird_holds
    FROM first_visit_occurrences occurrence
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
  first_visit_facts AS (
    SELECT occurrence.*, product.id AS product_id, product.product_kind,
      product.base_price_sek AS product_base_price_sek,
      product.early_bird_price_minor AS product_early_bird_price_minor,
      product.early_bird_slots AS product_early_bird_slots,
      product.scarcity_mode AS product_scarcity_mode,
      COALESCE(registration.committed_count, 0) + COALESCE(hold.active_holds, 0) AS fill_count,
      COALESCE(registration.early_bird_committed, 0)
        + COALESCE(hold.early_bird_holds, 0) AS early_bird_fill_count
    FROM first_visit_occurrences occurrence
    LEFT JOIN public.access_products product
      ON product.venue_id = occurrence.venue_id
     AND product.product_key = occurrence.resolved_product_key
     AND product.is_active = true
    LEFT JOIN first_visit_registration_counts registration
      ON registration.activity_session_id = occurrence.id
     AND registration.occurrence_date = occurrence.occurrence_date
    LEFT JOIN first_visit_hold_counts hold
      ON hold.activity_session_id = occurrence.id
     AND hold.occurrence_date = occurrence.occurrence_date
  )
  SELECT jsonb_build_object(
    'input_valid', EXISTS (SELECT 1 FROM input_scope),
    'venue_found', EXISTS (SELECT 1 FROM venue_scope),
    'venue_id', (SELECT venue.id FROM venue_scope venue),
    'commerce_enabled', COALESCE((SELECT venue.commerce_enabled FROM venue_scope venue), false),
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', membership.id, 'name', membership.name,
        'description', membership.description, 'monthly_price', membership.monthly_price
      ) ORDER BY membership.sort_order ASC NULLS LAST, membership.id ASC)
      FROM membership_rows membership
    ), '[]'::JSONB),
    'court_pricing', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', court.id, 'name', court.name, 'type', court.type,
        'price', court.price, 'days_of_week', court.days_of_week,
        'time_from', court.time_from, 'time_to', court.time_to
      ) ORDER BY court.time_from ASC, court.id ASC)
      FROM court_price_rows court
    ), '[]'::JSONB),
    'commerce_candidates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', product.id, 'product_key', product.product_key,
        'product_kind', product.product_kind, 'name', product.name,
        'description', product.description, 'commerce_kind', product.commerce_kind,
        'fulfillment_type', product.fulfillment_type,
        'fulfillment_presentation', product.fulfillment_presentation,
        'base_price_sek', product.base_price_sek, 'vat_rate', product.vat_rate,
        'status', product.status, 'is_active', product.is_active,
        'standalone_enabled', product.standalone_enabled,
        'activity_addon_enabled', product.activity_addon_enabled,
        'category', product.category,
        'has_active_relationship', product.has_active_relationship
      ) ORDER BY product.sort_order ASC, product.id ASC)
      FROM commerce_candidates product
    ), '[]'::JSONB),
    'courses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', course.id, 'name', course.name,
        'description', course.format_description,
        'base_price_sek', course.base_price_sek
      ) ORDER BY course.start_date ASC NULLS LAST, course.id ASC)
      FROM course_rows course
    ), '[]'::JSONB),
    'has_configured_first_visit_offer', EXISTS (
      SELECT 1 FROM venue_scope venue
      JOIN public.activity_sessions session ON session.venue_id = venue.id
      WHERE session.is_active = true
        AND session.publish_status = 'published'
        AND session.closed_to_public = false
        AND session.first_visit_offer_enabled = true
    ),
    'first_visit_fallback_price_sek', (
      SELECT product.base_price_sek FROM venue_scope venue
      JOIN public.access_products product ON product.venue_id = venue.id
      WHERE product.product_key = 'open_play_slot' AND product.is_active = true
      ORDER BY product.id ASC LIMIT 1
    ),
    'first_visit_occurrences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'session', jsonb_build_object(
          'id', activity.id, 'venue_id', activity.venue_id,
          'name', activity.name, 'session_type', activity.session_type,
          'session_date', activity.session_date, 'start_time', activity.start_time,
          'end_time', activity.end_time, 'capacity', activity.capacity,
          'price_sek', activity.price_sek, 'product_key', activity.product_key,
          'access_policy', activity.access_policy, 'metadata', activity.metadata,
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
          'id', activity.product_id, 'venue_id', activity.venue_id,
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
      FROM first_visit_facts activity
    ), '[]'::JSONB)
  );
$$;

COMMENT ON FUNCTION public.public_customer_prices_facts(TEXT, DATE, DATE, TIMESTAMPTZ) IS
  'Bounded auth-free Prices presentation facts. Checkout, personalized pricing, entitlements and frozen Order truth remain canonical and are not projected.';

REVOKE ALL ON FUNCTION public.public_customer_prices_facts(TEXT, DATE, DATE, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_customer_prices_facts(TEXT, DATE, DATE, TIMESTAMPTZ)
  TO service_role;
