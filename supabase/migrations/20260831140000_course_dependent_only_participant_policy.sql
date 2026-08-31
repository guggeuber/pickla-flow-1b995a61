-- Canonical child-only Course policy. activity_formats.age_group owns the
-- audience taxonomy; access_products.resolver_rules owns checkout enforcement.
-- Existing in-flight checkouts are a migration gate because paid fulfillment
-- revalidates the current policy before committing a participant.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.activity_series series
    JOIN public.activity_formats format ON format.id = series.format_id
    JOIN public.commerce_order_lines line ON line.activity_series_id = series.id
    JOIN public.commerce_orders commerce_order ON commerce_order.id = line.commerce_order_id
    WHERE series.series_type = 'course'
      AND series.status IN ('draft', 'active', 'paused')
      AND series.start_date >= (now() AT TIME ZONE 'Europe/Stockholm')::date
      AND format.age_group = 'youth'
      AND commerce_order.status = 'checkout_pending'
  ) THEN
    RAISE EXCEPTION 'course_dependent_only_pending_checkout_gate';
  END IF;

  UPDATE public.access_products product
  SET resolver_rules = jsonb_set(
        COALESCE(product.resolver_rules, '{}'::jsonb),
        '{participant_policy}',
        '"dependent_only"'::jsonb,
        true
      ),
      updated_at = now()
  FROM public.activity_series series
  JOIN public.activity_formats format ON format.id = series.format_id
  WHERE series.access_product_id = product.id
    AND series.series_type = 'course'
    AND series.status IN ('draft', 'active', 'paused')
    AND series.start_date >= (now() AT TIME ZONE 'Europe/Stockholm')::date
    AND format.age_group = 'youth'
    AND product.product_kind = 'series_access'
    AND COALESCE(product.resolver_rules->>'participant_policy', '') <> 'dependent_only';
END;
$$;
