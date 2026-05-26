-- Pickla stage seed.
-- Run after all migrations have been applied to the stage Supabase project.
-- Synthetic data only. Do not paste production customer data into stage.
--
-- Optional auth users for role/profile assignment:
--   stage-admin@playpickla.com
--   stage-founder@playpickla.com
--   stage-customer@playpickla.com
-- Create them in Supabase Auth first, then rerun this seed to attach roles,
-- profiles, and Founder membership.

DO $$
DECLARE
  v_venue_id UUID;
  v_founder_tier_id UUID;
  v_play_tier_id UUID;
  v_admin_user_id UUID;
  v_founder_user_id UUID;
  v_customer_user_id UUID;
  v_open_series UUID;
  v_friday_series UUID;
  v_training_series UUID;
  v_court_ids UUID[];
  v_dart_court_id UUID;
BEGIN
  INSERT INTO public.venues (
    name,
    slug,
    description,
    address,
    city,
    postal_code,
    country,
    phone,
    email,
    website_url,
    primary_color,
    secondary_color,
    status,
    is_public,
    timezone
  )
  VALUES (
    'Pickla Arena Stockholm Stage',
    'pickla-arena-sthlm',
    'Stage venue for Pickla production smoke tests.',
    'Svetsarvägen 22',
    'Solna',
    '171 41',
    'SE',
    '+46700000000',
    'stage@playpickla.com',
    'https://stage.playpickla.com',
    '#111827',
    '#F8FAFC',
    'active',
    true,
    'Europe/Stockholm'
  )
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        postal_code = EXCLUDED.postal_code,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        website_url = EXCLUDED.website_url,
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color,
        status = EXCLUDED.status,
        is_public = EXCLUDED.is_public,
        timezone = EXCLUDED.timezone
  RETURNING id INTO v_venue_id;

  INSERT INTO public.opening_hours (venue_id, day_of_week, open_time, close_time, is_closed)
  SELECT v_venue_id, day_num, '10:00'::time, '22:00'::time, false
  FROM generate_series(0, 6) AS day_num
  ON CONFLICT (venue_id, day_of_week) DO UPDATE
    SET open_time = EXCLUDED.open_time,
        close_time = EXCLUDED.close_time,
        is_closed = EXCLUDED.is_closed;

  FOR i IN 1..8 LOOP
    INSERT INTO public.venue_courts (
      venue_id,
      name,
      court_number,
      court_type,
      sport_type,
      is_available,
      hourly_rate
    )
    VALUES (
      v_venue_id,
      CASE WHEN i = 1 THEN 'Bana 1 Center Court' ELSE 'Bana ' || i END,
      i,
      'indoor',
      'pickleball',
      true,
      240
    )
    ON CONFLICT (venue_id, sport_type, court_number) DO UPDATE
      SET name = EXCLUDED.name,
          court_type = EXCLUDED.court_type,
          is_available = EXCLUDED.is_available,
          hourly_rate = EXCLUDED.hourly_rate;
  END LOOP;

  FOR i IN 1..6 LOOP
    INSERT INTO public.venue_courts (
      venue_id,
      name,
      court_number,
      court_type,
      sport_type,
      is_available,
      hourly_rate
    )
    VALUES (
      v_venue_id,
      'Dart ' || i,
      i,
      'dart_board',
      'dart',
      true,
      0
    )
    ON CONFLICT (venue_id, sport_type, court_number) DO UPDATE
      SET name = EXCLUDED.name,
          court_type = EXCLUDED.court_type,
          is_available = EXCLUDED.is_available,
          hourly_rate = EXCLUDED.hourly_rate;
  END LOOP;

  DELETE FROM public.pricing_rules
  WHERE venue_id = v_venue_id
    AND name IN ('Stage Pickleball Court Hour', 'Stage Day Pass');

  INSERT INTO public.pricing_rules (venue_id, name, type, price, currency, description, is_active, sport_type, vat_rate)
  VALUES
    (v_venue_id, 'Stage Pickleball Court Hour', 'hourly', 240, 'SEK', 'Stage baseline court booking price.', true, 'pickleball', 6),
    (v_venue_id, 'Stage Day Pass', 'day_pass', 195, 'SEK', 'Stage baseline day access price.', true, 'pickleball', 6);

  INSERT INTO public.access_products
    (venue_id, product_key, name, description, product_kind, session_type, base_price_sek, vat_rate, grants, sort_order, is_active)
  VALUES
    (v_venue_id, 'day_access', 'Day Pass', 'Dagsmedlemskap med access till Open Play samma datum.', 'day_access', NULL, 195, 6, '{"entitlement_type": "day_access", "includes_session_types": ["open_play"]}'::jsonb, 10, true),
    (v_venue_id, 'open_play_slot', 'Open Play Slot', 'Anmälan till valt Open Play-pass.', 'session_ticket', 'open_play', 165, 6, '{"entitlement_type": "session_ticket", "includes_session_types": ["open_play"]}'::jsonb, 20, true),
    (v_venue_id, 'group_training', 'Gruppträning', 'Träningspass utan automatiskt dagsmedlemskap.', 'session_ticket', 'group_training', 195, 6, '{"entitlement_type": "session_ticket", "includes_session_types": ["group_training"]}'::jsonb, 30, true),
    (v_venue_id, 'group_training_day_access', 'Gruppträning + Day Pass', 'Gruppträning som även inkluderar Open Play samma dag.', 'session_with_day_access', 'group_training', 195, 6, '{"entitlement_type": "day_access", "includes_session_types": ["open_play"], "includes_session_ticket": true}'::jsonb, 40, true),
    (v_venue_id, 'day_access_voucher', 'Day Pass Voucher', 'Odaterad gåva/credit som kan lösas in till ett dagsmedlemskap.', 'voucher', NULL, 195, 6, '{"voucher_type": "day_access"}'::jsonb, 50, true)
  ON CONFLICT (venue_id, product_key) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        product_kind = EXCLUDED.product_kind,
        session_type = EXCLUDED.session_type,
        base_price_sek = EXCLUDED.base_price_sek,
        vat_rate = EXCLUDED.vat_rate,
        grants = EXCLUDED.grants,
        sort_order = EXCLUDED.sort_order,
        is_active = true;

  INSERT INTO public.membership_tiers (
    venue_id,
    name,
    description,
    color,
    sort_order,
    discount_percent,
    monthly_price,
    is_active,
    is_assignable
  )
  VALUES
    (v_venue_id, 'Founder', 'Stage Founder: 4 court-hours/week, Open Play included, 4 guest passes/month.', '#111827', 10, 0, 990, false, true),
    (v_venue_id, 'Play', 'Stage public membership with one guest pass/month.', '#ED3F8F', 20, 0, 199, true, true)
  ON CONFLICT (venue_id, name) DO UPDATE
    SET description = EXCLUDED.description,
        color = EXCLUDED.color,
        sort_order = EXCLUDED.sort_order,
        discount_percent = EXCLUDED.discount_percent,
        monthly_price = EXCLUDED.monthly_price,
        is_active = EXCLUDED.is_active,
        is_assignable = EXCLUDED.is_assignable;

  SELECT id INTO v_founder_tier_id
  FROM public.membership_tiers
  WHERE venue_id = v_venue_id AND name = 'Founder';

  SELECT id INTO v_play_tier_id
  FROM public.membership_tiers
  WHERE venue_id = v_venue_id AND name = 'Play';

  DELETE FROM public.membership_tier_pricing
  WHERE tier_id = v_founder_tier_id
    AND product_type IN ('court_hourly', 'day_access', 'open_play_slot', 'day_access_voucher');

  INSERT INTO public.membership_tier_pricing
    (tier_id, product_type, fixed_price, discount_percent, vat_rate, label)
  VALUES
    (v_founder_tier_id, 'court_hourly', 180, NULL, 6, 'Founder overage court hour'),
    (v_founder_tier_id, 'day_access', 0, NULL, 6, 'Founder Day Pass'),
    (v_founder_tier_id, 'open_play_slot', 0, NULL, 6, 'Founder Open Play'),
    (v_founder_tier_id, 'day_access_voucher', 0, NULL, 6, 'Founder guest voucher');

  INSERT INTO public.membership_entitlements (tier_id, entitlement_type, value, period, sport_type)
  VALUES
    (v_founder_tier_id, 'court_hours_per_week', 4, 'week', 'pickleball'),
    (v_founder_tier_id, 'open_play_unlimited', 1, NULL, 'pickleball'),
    (v_founder_tier_id, 'guest_day_vouchers_monthly', 4, 'month', 'pickleball'),
    (v_play_tier_id, 'guest_day_vouchers_monthly', 1, 'month', 'pickleball')
  ON CONFLICT (tier_id, entitlement_type, sport_type) DO UPDATE
    SET value = EXCLUDED.value,
        period = EXCLUDED.period;

  SELECT ARRAY_AGG(id ORDER BY court_number)
    INTO v_court_ids
  FROM public.venue_courts
  WHERE venue_id = v_venue_id
    AND sport_type = 'pickleball'
    AND court_number IN (5, 6, 7, 8);

  INSERT INTO public.activity_series (venue_id, name, description, series_type, sport_type, status, product_key, metadata)
  VALUES
    (v_venue_id, 'Open Play', 'Stage recurring Open Play program.', 'program', 'pickleball', 'active', 'day_access', '{"seed_key": "stage_open_play"}'::jsonb),
    (v_venue_id, 'Fredagsklubben', 'Stage Friday social play.', 'club_night', 'pickleball', 'active', 'day_access', '{"seed_key": "stage_fredagsklubben"}'::jsonb),
    (v_venue_id, 'Onsdag Gruppträning', 'Stage weekly group training.', 'training', 'pickleball', 'active', 'group_training_day_access', '{"seed_key": "stage_group_training"}'::jsonb)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_open_series FROM public.activity_series WHERE venue_id = v_venue_id AND metadata->>'seed_key' = 'stage_open_play' LIMIT 1;
  SELECT id INTO v_friday_series FROM public.activity_series WHERE venue_id = v_venue_id AND metadata->>'seed_key' = 'stage_fredagsklubben' LIMIT 1;
  SELECT id INTO v_training_series FROM public.activity_series WHERE venue_id = v_venue_id AND metadata->>'seed_key' = 'stage_group_training' LIMIT 1;

  DELETE FROM public.activity_sessions
  WHERE venue_id = v_venue_id
    AND metadata->>'stage_seed' = 'true';

  INSERT INTO public.activity_sessions
    (venue_id, series_id, product_key, name, session_type, sport_type, recurrence_days, start_time, end_time, price_sek, capacity, court_ids, access_policy, metadata, sort_order)
  VALUES
    (v_venue_id, v_open_series, 'day_access', 'Open Play FM', 'open_play', 'pickleball', ARRAY[1,2,3,4,5,6,0], '10:00', '12:00', 165, 20, COALESCE(v_court_ids, '{}'), '{"allows_day_access": true, "member_benefit_key": "open_play_unlimited"}'::jsonb, '{"stage_seed": "true", "seed_key": "stage_open_play_fm"}'::jsonb, 10),
    (v_venue_id, v_open_series, 'day_access', 'Open Play Kväll', 'open_play', 'pickleball', ARRAY[1,2,3,4,5,6,0], '17:00', '20:00', 165, 24, COALESCE(v_court_ids, '{}'), '{"allows_day_access": true, "member_benefit_key": "open_play_unlimited"}'::jsonb, '{"stage_seed": "true", "seed_key": "stage_open_play_evening"}'::jsonb, 20),
    (v_venue_id, v_friday_series, 'day_access', 'Fredagsklubben', 'open_play', 'pickleball', ARRAY[5], '17:00', '20:00', 99, 32, COALESCE(v_court_ids, '{}'), '{"allows_day_access": true, "member_benefit_key": "open_play_unlimited"}'::jsonb, '{"stage_seed": "true", "seed_key": "stage_friday_club"}'::jsonb, 30),
    (v_venue_id, v_training_series, 'group_training_day_access', 'Onsdag Gruppträning', 'group_training', 'pickleball', ARRAY[3], '18:00', '19:00', 195, 16, COALESCE(v_court_ids, '{}'), '{"includes_day_access": true, "allows_day_access": false}'::jsonb, '{"stage_seed": "true", "seed_key": "stage_wednesday_training"}'::jsonb, 40);

  SELECT id INTO v_dart_court_id
  FROM public.venue_courts
  WHERE venue_id = v_venue_id AND sport_type = 'dart' AND court_number = 1;

  INSERT INTO public.display_devices (venue_id, venue_court_id, name, device_token, mode, is_active, instructions)
  VALUES
    (v_venue_id, NULL, 'Stage Venue Home', 'stage-venue-home-token', 'venue_home', true, 'Stage venue home padda.'),
    (v_venue_id, v_dart_court_id, 'Stage Dart 1', 'stage-dart-1-token', 'resource_home', true, 'Stage dart padda.')
  ON CONFLICT (device_token) DO UPDATE
    SET venue_id = EXCLUDED.venue_id,
        venue_court_id = EXCLUDED.venue_court_id,
        name = EXCLUDED.name,
        mode = EXCLUDED.mode,
        is_active = EXCLUDED.is_active,
        instructions = EXCLUDED.instructions;

  SELECT id INTO v_admin_user_id FROM auth.users WHERE email = 'stage-admin@playpickla.com' LIMIT 1;
  SELECT id INTO v_founder_user_id FROM auth.users WHERE email = 'stage-founder@playpickla.com' LIMIT 1;
  SELECT id INTO v_customer_user_id FROM auth.users WHERE email = 'stage-customer@playpickla.com' LIMIT 1;

  IF v_admin_user_id IS NOT NULL THEN
    INSERT INTO public.player_profiles (auth_user_id, display_name, first_name, last_name, phone)
    VALUES (v_admin_user_id, 'Stage Admin', 'Stage', 'Admin', '+46700000001')
    ON CONFLICT (auth_user_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          phone = EXCLUDED.phone;

    INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
    VALUES (v_admin_user_id, v_venue_id, 'venue_admin', true)
    ON CONFLICT (user_id, venue_id, role) DO UPDATE
      SET is_active = true;
  ELSE
    RAISE NOTICE 'Auth user stage-admin@playpickla.com not found; skipping staff assignment.';
  END IF;

  IF v_founder_user_id IS NOT NULL THEN
    INSERT INTO public.player_profiles (auth_user_id, display_name, first_name, last_name, phone)
    VALUES (v_founder_user_id, 'Stage Founder', 'Stage', 'Founder', '+46700000002')
    ON CONFLICT (auth_user_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          phone = EXCLUDED.phone;

    INSERT INTO public.memberships (user_id, venue_id, tier_id, status, starts_at, notes)
    VALUES (v_founder_user_id, v_venue_id, v_founder_tier_id, 'active', CURRENT_DATE, 'stage_seed:founder')
    ON CONFLICT (user_id, venue_id, tier_id, starts_at) DO UPDATE
      SET status = 'active',
          notes = EXCLUDED.notes;
  ELSE
    RAISE NOTICE 'Auth user stage-founder@playpickla.com not found; skipping Founder membership assignment.';
  END IF;

  IF v_customer_user_id IS NOT NULL THEN
    INSERT INTO public.player_profiles (auth_user_id, display_name, first_name, last_name, phone)
    VALUES (v_customer_user_id, 'Stage Customer', 'Stage', 'Customer', '+46700000003')
    ON CONFLICT (auth_user_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          phone = EXCLUDED.phone;
  ELSE
    RAISE NOTICE 'Auth user stage-customer@playpickla.com not found; skipping customer profile.';
  END IF;

  PERFORM pg_notify('pgrst', 'reload schema');
END;
$$;
