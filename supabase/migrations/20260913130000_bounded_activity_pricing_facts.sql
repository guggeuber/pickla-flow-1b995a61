-- One bounded DB roundtrip for occurrence-specific facts used by the existing
-- canonical activity pricing resolver. This function does not own pricing or
-- entitlement rules: it delegates entitlement truth to resolve_access_entitlement
-- and capacity truth to the existing capacity functions.

CREATE OR REPLACE FUNCTION public.resolve_activity_pricing_facts_batch(
  p_venue_id UUID,
  p_customer_id UUID,
  p_user_id UUID,
  p_occurrences JSONB,
  p_access_context JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  activity_session_id UUID,
  session_date DATE,
  product_key TEXT,
  canonical_access JSONB,
  capacity_fill INTEGER,
  early_bird_fill INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(COALESCE(p_occurrences, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'pricing_occurrences_must_be_an_array';
  END IF;
  IF jsonb_array_length(COALESCE(p_occurrences, '[]'::jsonb)) > 24 THEN
    RAISE EXCEPTION 'pricing_occurrences_limit_exceeded';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT DISTINCT
      row.activity_session_id,
      row.session_date,
      row.product_key,
      row.resolve_at,
      COALESCE(row.needs_capacity_fill, false) AS needs_capacity_fill,
      COALESCE(row.needs_early_bird_fill, false) AS needs_early_bird_fill
    FROM jsonb_to_recordset(COALESCE(p_occurrences, '[]'::jsonb)) AS row(
      activity_session_id UUID,
      session_date DATE,
      product_key TEXT,
      resolve_at TIMESTAMPTZ,
      needs_capacity_fill BOOLEAN,
      needs_early_bird_fill BOOLEAN
    )
    WHERE row.activity_session_id IS NOT NULL
      AND row.session_date IS NOT NULL
      AND NULLIF(BTRIM(row.product_key), '') IS NOT NULL
      AND row.resolve_at IS NOT NULL
  )
  SELECT
    requested.activity_session_id,
    requested.session_date,
    requested.product_key,
    CASE
      WHEN p_customer_id IS NULL THEN jsonb_build_object(
        'status', 'manual_review_required',
        'covered', false,
        'reason', 'customer_not_resolved'
      )
      ELSE public.resolve_access_entitlement(
        p_venue_id,
        p_customer_id,
        p_user_id,
        requested.activity_session_id,
        requested.session_date,
        requested.resolve_at,
        requested.product_key,
        COALESCE(p_access_context, '{}'::jsonb)
      )
    END AS canonical_access,
    CASE WHEN requested.needs_capacity_fill THEN COALESCE((
        SELECT fill.fill_count
        FROM public.capacity_fill(
          p_venue_id,
          'activity_session',
          requested.activity_session_id::TEXT,
          requested.session_date
        ) fill
      ), 0)::INTEGER ELSE 0 END AS capacity_fill,
    CASE WHEN requested.needs_early_bird_fill THEN COALESCE((
        SELECT early.fill_count
        FROM public.activity_early_bird_fill(
          p_venue_id,
          requested.activity_session_id,
          requested.session_date
        ) early
      ), 0)::INTEGER ELSE 0 END AS early_bird_fill
  FROM requested
  JOIN public.activity_sessions session
    ON session.id = requested.activity_session_id
    AND session.venue_id = p_venue_id
  ORDER BY requested.session_date, session.start_time, requested.activity_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_activity_pricing_facts_batch(
  UUID, UUID, UUID, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_activity_pricing_facts_batch(
  UUID, UUID, UUID, JSONB, JSONB
) TO service_role;

COMMENT ON FUNCTION public.resolve_activity_pricing_facts_batch(UUID, UUID, UUID, JSONB, JSONB) IS
  'Bounded read-only occurrence facts for personalized activity pricing. Delegates to canonical entitlement and capacity resolvers; maximum 24 occurrences.';
