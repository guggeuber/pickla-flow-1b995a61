\set ON_ERROR_STOP on

-- Schema-only contract for the canonical production baseline. This test does
-- not insert production-like content and is safe to run immediately after a
-- local reset stopped at 20260727120000.
DO $$
DECLARE
  required_tables text[] := ARRAY[
    'public.organizations',
    'public.venues',
    'public.venue_staff',
    'public.bookings',
    'public.booking_receipts',
    'public.activity_sessions',
    'public.activity_session_hosts',
    'public.activity_session_interests',
    'public.memberships',
    'public.membership_entitlements',
    'public.capacity_holds',
    'public.access_products',
    'public.commerce_orders',
    'public.commerce_order_lines',
    'public.commerce_receipt_lines',
    'public.ledger_entries',
    'public.stripe_events',
    'public.venue_checkins',
    'public.chat_rooms',
    'public.chat_messages',
    'public.chat_participants',
    'public.venue_operation_overrides',
    'public.display_devices',
    'public.investor_settings',
    'public.investor_assets',
    'public.investor_leads'
  ];
  required_table text;
  required_function text[] := ARRAY[
    'public.handle_new_user()',
    'public.replace_commerce_cart_lines(uuid,integer,jsonb,text,text,text)',
    'public.freeze_commerce_order(uuid,integer,jsonb)',
    'public.acquire_capacity_hold(uuid,text,text,date,integer,uuid,uuid,text,uuid,text,jsonb,integer)'
  ];
  function_signature text;
BEGIN
  FOREACH required_table IN ARRAY required_tables LOOP
    IF to_regclass(required_table) IS NULL THEN
      RAISE EXCEPTION 'baseline contract missing table %', required_table;
    END IF;
  END LOOP;

  FOREACH function_signature IN ARRAY required_function LOOP
    IF to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION 'baseline contract missing function %', function_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto' AND n.nspname = 'extensions'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'uuid-ossp' AND n.nspname = 'extensions'
  ) THEN
    RAISE EXCEPTION 'required extensions are missing or installed in the wrong schema';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND tgname = 'on_auth_user_created'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'auth bootstrap trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'stripe_events'
      AND indexname = 'stripe_events_pkey'
  ) THEN
    RAISE EXCEPTION 'Stripe event idempotency key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'investor-assets'
      AND public
      AND file_size_limit = 20971520
  ) THEN
    RAISE EXCEPTION 'canonical investor-assets Storage configuration is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        'Public can read investor assets',
        'Super admin can delete investor assets',
        'Super admin can update investor assets',
        'Super admin can upload investor assets'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'canonical investor-assets Storage policies are incomplete';
  END IF;

  IF to_regclass('public.event_products') IS NOT NULL
     OR to_regclass('public.customer_transactions') IS NOT NULL THEN
    RAISE EXCEPTION 'an absent legacy capability was silently added to the baseline';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'event-logos' AND public AND file_size_limit = 5242880
  ) OR NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'event-offers' AND NOT public AND file_size_limit = 10485760
  ) THEN
    RAISE EXCEPTION 'approved event Storage capabilities are missing from the canonical baseline';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id IN ('community-stories', 'forum-images')
  ) THEN
    RAISE EXCEPTION 'an absent legacy Storage bucket was silently added to the baseline';
  END IF;
END $$;

SELECT 'production baseline contract passed' AS result;
