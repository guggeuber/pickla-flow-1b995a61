\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('c2300000-0000-4000-8000-000000000001', 'Series Member Pricing Test', 'series-member-pricing-test');

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES (
  'c2300000-0000-4000-8000-000000000002',
  'c2300000-0000-4000-8000-000000000001',
  'Series Member Pricing Venue', 'series-member-pricing-venue', true
);

INSERT INTO public.membership_tiers (id, venue_id, name, is_active)
VALUES (
  'c2300000-0000-4000-8000-000000000003',
  'c2300000-0000-4000-8000-000000000002',
  'Play', true
);

INSERT INTO public.membership_tier_pricing (
  id, tier_id, product_type, fixed_price, discount_percent, label
) VALUES (
  'c2300000-0000-4000-8000-000000000004',
  'c2300000-0000-4000-8000-000000000003',
  'series_member_fixture', 169, NULL, 'Play · Series'
);

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.membership_tier_pricing', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.membership_tier_pricing', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'browser roles retained direct membership pricing writes';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.membership_tier_pricing', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.membership_tier_pricing', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'canonical read/service-role privileges are incorrect';
  END IF;

  BEGIN
    INSERT INTO public.membership_tier_pricing (
      tier_id, product_type, fixed_price
    ) VALUES (
      'c2300000-0000-4000-8000-000000000003', 'series_member_fixture', 159
    );
    RAISE EXCEPTION 'duplicate direct tier/product rule was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.membership_tier_pricing (
      tier_id, product_type, fixed_price, discount_percent
    ) VALUES (
      'c2300000-0000-4000-8000-000000000003', 'series_member_both', 169, 15
    );
    RAISE EXCEPTION 'two pricing modes were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.membership_tier_pricing (
      tier_id, product_type, fixed_price, discount_percent
    ) VALUES (
      'c2300000-0000-4000-8000-000000000003', 'series_member_none', NULL, NULL
    );
    RAISE EXCEPTION 'missing pricing mode was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activity_series'
      AND column_name IN ('member_price', 'member_discount', 'membership_price')
  ) THEN
    RAISE EXCEPTION 'membership pricing truth leaked onto activity_series';
  END IF;
END
$$;

ROLLBACK;
