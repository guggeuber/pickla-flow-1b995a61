-- Pickla Access OS
-- Separates sellable products, scheduled activity sessions, reusable/dated access
-- rights, session registrations, and giftable vouchers.

CREATE TABLE IF NOT EXISTS public.activity_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'open_play',
  sport_type TEXT NOT NULL DEFAULT 'pickleball',
  recurrence_days INTEGER[],
  session_date DATE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  price_sek INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER,
  court_ids UUID[] NOT NULL DEFAULT '{}',
  access_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT activity_sessions_recurrence_or_date CHECK (
    recurrence_days IS NOT NULL OR session_date IS NOT NULL
  ),
  CONSTRAINT activity_sessions_time_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_activity_sessions_venue_active
  ON public.activity_sessions (venue_id, is_active);
CREATE INDEX IF NOT EXISTS idx_activity_sessions_type
  ON public.activity_sessions (venue_id, session_type, sport_type);

CREATE TABLE IF NOT EXISTS public.session_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  activity_session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'confirmed',
  price_paid_sek INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT,
  source_type TEXT,
  source_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_registrations_status_check CHECK (
    status IN ('pending', 'confirmed', 'cancelled', 'checked_in', 'no_show')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_registrations_user_once
  ON public.session_registrations (activity_session_id, session_date, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_registrations_stripe_session
  ON public.session_registrations (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_session_registrations_venue_date
  ON public.session_registrations (venue_id, session_date);

CREATE TABLE IF NOT EXISTS public.access_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entitlement_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_type TEXT,
  source_id UUID,
  activity_session_id UUID REFERENCES public.activity_sessions(id) ON DELETE SET NULL,
  session_date DATE,
  valid_date DATE,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  includes_session_types TEXT[] NOT NULL DEFAULT '{}',
  uses_limit INTEGER,
  uses_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT access_entitlements_type_check CHECK (
    entitlement_type IN ('day_access', 'session_ticket', 'membership_access', 'booking_access')
  ),
  CONSTRAINT access_entitlements_status_check CHECK (
    status IN ('active', 'consumed', 'expired', 'revoked', 'suspended')
  )
);

CREATE INDEX IF NOT EXISTS idx_access_entitlements_user_active
  ON public.access_entitlements (venue_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_access_entitlements_valid_date
  ON public.access_entitlements (venue_id, valid_date, entitlement_type)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_entitlements_source_once
  ON public.access_entitlements (source_type, source_id, user_id, entitlement_type);

CREATE TABLE IF NOT EXISTS public.access_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  purchaser_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  code TEXT NOT NULL UNIQUE,
  voucher_type TEXT NOT NULL DEFAULT 'day_access',
  status TEXT NOT NULL DEFAULT 'unused',
  value_count INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  source_type TEXT,
  source_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT access_vouchers_status_check CHECK (
    status IN ('unused', 'claimed', 'redeemed', 'expired', 'revoked')
  )
);

CREATE INDEX IF NOT EXISTS idx_access_vouchers_purchaser
  ON public.access_vouchers (purchaser_user_id, status);
CREATE INDEX IF NOT EXISTS idx_access_vouchers_claimed_by
  ON public.access_vouchers (claimed_by_user_id, status);

ALTER TABLE public.activity_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active activity sessions"
  ON public.activity_sessions FOR SELECT
  USING (is_active = true OR public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Venue staff can manage activity sessions"
  ON public.activity_sessions FOR ALL
  TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Users read own session registrations"
  ON public.session_registrations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Venue staff can manage session registrations"
  ON public.session_registrations FOR ALL
  TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Users read own access entitlements"
  ON public.access_entitlements FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Venue staff can manage access entitlements"
  ON public.access_entitlements FOR ALL
  TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Users read own vouchers"
  ON public.access_vouchers FOR SELECT
  TO authenticated
  USING (
    purchaser_user_id = auth.uid()
    OR claimed_by_user_id = auth.uid()
    OR public.is_venue_member(auth.uid(), venue_id)
    OR public.is_super_admin()
  );

CREATE POLICY "Venue staff can manage vouchers"
  ON public.access_vouchers FOR ALL
  TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DO $$
DECLARE
  v_venue_id UUID;
  v_court_ids UUID[];
BEGIN
  SELECT id INTO v_venue_id
  FROM public.venues
  WHERE slug = 'pickla-arena-sthlm';

  IF v_venue_id IS NULL THEN
    RAISE NOTICE 'Venue pickla-arena-sthlm not found; skipping Access OS session seed';
    RETURN;
  END IF;

  SELECT ARRAY_AGG(id ORDER BY court_number)
    INTO v_court_ids
  FROM public.venue_courts
  WHERE venue_id = v_venue_id
    AND court_number IN (5, 6, 7, 8);

  DELETE FROM public.activity_sessions
  WHERE venue_id = v_venue_id
    AND metadata->>'seed_key' = 'pickla_open_play_v1';

  INSERT INTO public.activity_sessions
    (venue_id, name, session_type, recurrence_days, start_time, end_time, price_sek, capacity, court_ids, access_policy, metadata)
  VALUES
    (
      v_venue_id,
      'Open Play FM',
      'open_play',
      ARRAY[1,2,3,4,5,6,0],
      '10:00',
      '12:00',
      165,
      20,
      COALESCE(v_court_ids, '{}'),
      '{"allows_day_access": true, "member_benefit_key": "open_play_unlimited"}'::jsonb,
      '{"seed_key": "pickla_open_play_v1"}'::jsonb
    ),
    (
      v_venue_id,
      'Open Play Eftermiddag',
      'open_play',
      ARRAY[1,2,3,4,5,6,0],
      '14:00',
      '16:00',
      165,
      20,
      COALESCE(v_court_ids, '{}'),
      '{"allows_day_access": true, "member_benefit_key": "open_play_unlimited"}'::jsonb,
      '{"seed_key": "pickla_open_play_v1"}'::jsonb
    ),
    (
      v_venue_id,
      'Open Play Kväll',
      'open_play',
      ARRAY[1,2,3,4,5,6,0],
      '17:00',
      '20:00',
      165,
      20,
      COALESCE(v_court_ids, '{}'),
      '{"allows_day_access": true, "member_benefit_key": "open_play_unlimited"}'::jsonb,
      '{"seed_key": "pickla_open_play_v1"}'::jsonb
    ),
    (
      v_venue_id,
      'Onsdag Gruppträning',
      'group_training',
      ARRAY[3],
      '18:00',
      '19:00',
      195,
      16,
      COALESCE(v_court_ids, '{}'),
      '{"includes_day_access": true, "allows_day_access": false}'::jsonb,
      '{"seed_key": "pickla_open_play_v1"}'::jsonb
    );
END;
$$;
