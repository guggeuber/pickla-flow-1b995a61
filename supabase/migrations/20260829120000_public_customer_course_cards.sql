-- Customer Performance V2 Phase A: one bounded public Course discovery read.
-- Transactional capacity and pricing truth remain owned by their canonical
-- tables/functions; this function is a read-only presentation projection.

CREATE OR REPLACE FUNCTION public.public_customer_course_cards(
  p_venue_slug TEXT,
  p_as_of TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH venue_scope AS MATERIALIZED (
    SELECT venue.id
    FROM public.venues venue
    WHERE venue.slug = NULLIF(BTRIM(p_venue_slug), '')
      AND venue.is_public = true
    LIMIT 1
  ),
  eligible_courses AS MATERIALIZED (
    SELECT
      series.id,
      series.venue_id,
      series.name,
      series.description,
      series.image_urls AS series_image_urls,
      series.start_date,
      series.capacity,
      series.registration_opens_at,
      series.registration_closes_at,
      format.description AS format_description,
      format.image_urls AS format_image_urls,
      format.presentation_type
    FROM venue_scope venue
    JOIN public.activity_series series ON series.venue_id = venue.id
    JOIN public.activity_formats format ON format.id = series.format_id
    WHERE series.series_type = 'course'
      AND series.status = 'active'
      AND format.presentation_type = 'course'
      AND series.end_date >= (COALESCE(p_as_of, now()) AT TIME ZONE 'Europe/Stockholm')::DATE
    ORDER BY series.start_date ASC NULLS LAST, series.id ASC
    LIMIT 24
  ),
  commitment_counts AS (
    SELECT commitment.activity_series_id, COUNT(*)::INTEGER AS committed_count
    FROM public.series_commitments commitment
    JOIN eligible_courses course ON course.id = commitment.activity_series_id
    WHERE commitment.venue_id = course.venue_id
      AND commitment.commitment_type = 'participant'
      AND commitment.status = 'active'
    GROUP BY commitment.activity_series_id
  ),
  hold_counts AS (
    SELECT hold.scope_id, COUNT(*)::INTEGER AS active_holds_count
    FROM public.capacity_holds hold
    JOIN eligible_courses course
      ON hold.scope_id = course.id::TEXT
     AND hold.venue_id = course.venue_id
     AND hold.session_date = course.start_date
    WHERE hold.scope_type = 'activity_series'
      AND hold.status = 'active'
      AND hold.expires_at > COALESCE(p_as_of, now())
    GROUP BY hold.scope_id
  ),
  projected_courses AS (
    SELECT
      course.*,
      GREATEST(
        COALESCE(course.capacity, 0)
          - COALESCE(commitment.committed_count, 0)
          - COALESCE(hold.active_holds_count, 0),
        0
      )::INTEGER AS available_count,
      COALESCE(course.series_image_urls[1], course.format_image_urls[1]) AS image_url,
      CASE
        WHEN course.registration_opens_at IS NOT NULL
          AND COALESCE(p_as_of, now()) < course.registration_opens_at THEN 'upcoming'
        WHEN course.registration_closes_at IS NOT NULL
          AND COALESCE(p_as_of, now()) >= course.registration_closes_at THEN 'closed'
        ELSE 'open'
      END AS registration_state
    FROM eligible_courses course
    LEFT JOIN commitment_counts commitment ON commitment.activity_series_id = course.id
    LEFT JOIN hold_counts hold ON hold.scope_id = course.id::TEXT
  )
  SELECT jsonb_build_object(
    'venue_found', EXISTS (SELECT 1 FROM venue_scope),
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', course.id,
          'name', course.name,
          'description', course.description,
          'image_urls', CASE
            WHEN course.image_url IS NULL THEN '[]'::JSONB
            ELSE jsonb_build_array(course.image_url)
          END,
          'start_date', course.start_date,
          'registration_state', course.registration_state,
          'capacity', jsonb_build_object('available_count', course.available_count),
          'format', jsonb_build_object(
            'description', course.format_description,
            'presentation_type', course.presentation_type
          )
        )
        ORDER BY course.start_date ASC NULLS LAST, course.id ASC
      )
      FROM projected_courses course
    ), '[]'::JSONB)
  );
$$;

COMMENT ON FUNCTION public.public_customer_course_cards(TEXT, TIMESTAMPTZ) IS
  'Bounded auth-free Course discovery projection. Capacity is display-only and checkout must revalidate canonical truth.';

REVOKE ALL ON FUNCTION public.public_customer_course_cards(TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_customer_course_cards(TEXT, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_customer_course_cards(TEXT, TIMESTAMPTZ) TO service_role;
