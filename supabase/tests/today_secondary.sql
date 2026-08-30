\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_slug TEXT;
  v_private_slug TEXT;
  v_public_venue RECORD;
  v_result JSONB;
  v_course JSONB;
  v_canonical RECORD;
BEGIN
  SELECT venue.slug INTO v_slug
  FROM public.venues venue
  WHERE venue.is_public = true
  ORDER BY EXISTS (
    SELECT 1 FROM public.activity_series series
    WHERE series.venue_id = venue.id AND series.series_type = 'course'
  ) DESC, venue.slug
  LIMIT 1;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'Today secondary SQL test requires one public local venue'; END IF;

  v_result := public.public_customer_today_secondary_facts(
    v_slug, CURRENT_DATE, CURRENT_DATE + 6, now()
  );
  IF (v_result->>'input_valid')::BOOLEAN IS DISTINCT FROM true
     OR (v_result->>'venue_found')::BOOLEAN IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'public venue resolution failed: %', v_result;
  END IF;
  IF jsonb_array_length(v_result->'course_candidates') > 4
     OR jsonb_array_length(v_result->'activity_occurrences') > 256 THEN
    RAISE EXCEPTION 'bounded candidate contract failed: %', v_result;
  END IF;

  -- Exercise every public local venue so an alternate venue cannot silently
  -- depend on the canonical Stockholm fixture or a hard-coded UUID.
  FOR v_public_venue IN
    SELECT venue.slug FROM public.venues venue WHERE venue.is_public = true ORDER BY venue.slug
  LOOP
    v_result := public.public_customer_today_secondary_facts(
      v_public_venue.slug, CURRENT_DATE, CURRENT_DATE + 6, now()
    );
    IF (v_result->>'input_valid')::BOOLEAN IS DISTINCT FROM true
       OR (v_result->>'venue_found')::BOOLEAN IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'public alternate venue resolution failed for %: %', v_public_venue.slug, v_result;
    END IF;
  END LOOP;

  FOR v_course IN SELECT value FROM jsonb_array_elements(v_result->'course_candidates') LOOP
    SELECT * INTO v_canonical FROM public.capacity_fill(
      (v_course#>>'{series,venue_id}')::UUID,
      'activity_series',
      v_course#>>'{series,id}',
      (v_course#>>'{series,start_date}')::DATE
    );
    IF (v_course#>>'{capacity_fill,capacity}')::INTEGER IS DISTINCT FROM v_canonical.capacity
       OR (v_course#>>'{capacity_fill,committed_count}')::INTEGER IS DISTINCT FROM v_canonical.committed_count
       OR (v_course#>>'{capacity_fill,active_holds_count}')::INTEGER IS DISTINCT FROM v_canonical.active_holds_count
       OR (v_course#>>'{capacity_fill,fill_count}')::INTEGER IS DISTINCT FROM v_canonical.fill_count
       OR (v_course#>>'{capacity_fill,available_count}')::INTEGER IS DISTINCT FROM v_canonical.available_count THEN
      RAISE EXCEPTION 'Course capacity diverged from canonical capacity_fill: %, %', v_course, row_to_json(v_canonical);
    END IF;
  END LOOP;

  v_result := public.public_customer_today_secondary_facts(v_slug, CURRENT_DATE, CURRENT_DATE + 14, now());
  IF (v_result->>'input_valid')::BOOLEAN IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'range longer than fourteen days was accepted';
  END IF;
  v_result := public.public_customer_today_secondary_facts('missing-today-secondary-venue', CURRENT_DATE, CURRENT_DATE + 6, now());
  IF (v_result->>'venue_found')::BOOLEAN IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'missing venue was exposed as found';
  END IF;
  SELECT slug INTO v_private_slug FROM public.venues WHERE is_public = false ORDER BY slug LIMIT 1;
  IF v_private_slug IS NOT NULL THEN
    v_result := public.public_customer_today_secondary_facts(v_private_slug, CURRENT_DATE, CURRENT_DATE + 6, now());
    IF (v_result->>'venue_found')::BOOLEAN IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'private venue leaked through Today secondary';
    END IF;
  END IF;

  IF has_function_privilege('public', 'public.public_customer_today_secondary_facts(text,date,date,timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.public_customer_today_secondary_facts(text,date,date,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.public_customer_today_secondary_facts(text,date,date,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.public_customer_today_secondary_facts(text,date,date,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Today secondary RPC grants are not Edge/service-role only';
  END IF;

  IF v_result::TEXT ~* '(email|phone|auth_user|payer|membership_id|customer_id)' THEN
    RAISE EXCEPTION 'private identity vocabulary escaped the fact RPC: %', v_result;
  END IF;
END;
$$;

-- The transaction is READ ONLY. Any hidden reconciliation, hold release,
-- order update or commerce event write inside the RPC would make this test fail.
SELECT public.public_customer_today_secondary_facts(
  (SELECT slug FROM public.venues WHERE is_public = true ORDER BY slug LIMIT 1),
  CURRENT_DATE,
  CURRENT_DATE + 6,
  now()
) IS NOT NULL AS read_only_execution_ok;

ROLLBACK;
