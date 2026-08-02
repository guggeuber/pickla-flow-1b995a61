-- Product layer for Access OS.
-- Products describe what is sold; entitlements/registrations describe what the
-- buyer receives after purchase.

CREATE TABLE IF NOT EXISTS public.access_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  product_kind TEXT NOT NULL DEFAULT 'day_access',
  session_type TEXT,
  base_price_sek INTEGER NOT NULL DEFAULT 0,
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 6,
  grants JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT access_products_kind_check CHECK (
    product_kind IN ('day_access', 'session_ticket', 'session_with_day_access', 'voucher', 'membership')
  ),
  CONSTRAINT access_products_key_format CHECK (product_key ~ '^[a-z0-9_]+$'),
  UNIQUE (venue_id, product_key)
);

CREATE INDEX IF NOT EXISTS idx_access_products_venue_active
  ON public.access_products (venue_id, is_active, sort_order);

ALTER TABLE public.access_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active access products"
  ON public.access_products FOR SELECT
  USING (is_active = true OR public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Venue staff can manage access products"
  ON public.access_products FOR ALL
  TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DO $$
DECLARE
  v_venue_id UUID;
BEGIN
  SELECT id INTO v_venue_id
  FROM public.venues
  WHERE slug = 'pickla-arena-sthlm';

  IF v_venue_id IS NULL THEN
    RAISE NOTICE 'Venue pickla-arena-sthlm not found; skipping Access OS product seed';
    RETURN;
  END IF;

  INSERT INTO public.access_products
    (venue_id, product_key, name, description, product_kind, session_type, base_price_sek, vat_rate, grants, sort_order)
  VALUES
    (
      v_venue_id,
      'day_access',
      'Day Pass',
      'Dagsmedlemskap med access till Open Play samma datum.',
      'day_access',
      NULL,
      195,
      6,
      '{"entitlement_type": "day_access", "includes_session_types": ["open_play"]}'::jsonb,
      10
    ),
    (
      v_venue_id,
      'open_play_slot',
      'Open Play Slot',
      'Anmälan till valt Open Play-pass. Kan säljas som slot eller ihop med day access.',
      'session_ticket',
      'open_play',
      165,
      6,
      '{"entitlement_type": "session_ticket", "includes_session_types": ["open_play"]}'::jsonb,
      20
    ),
    (
      v_venue_id,
      'group_training',
      'Gruppträning',
      'Träningspass utan automatiskt dagsmedlemskap.',
      'session_ticket',
      'group_training',
      195,
      6,
      '{"entitlement_type": "session_ticket", "includes_session_types": ["group_training"]}'::jsonb,
      30
    ),
    (
      v_venue_id,
      'group_training_day_access',
      'Gruppträning + Day Pass',
      'Gruppträning som även inkluderar Open Play samma dag.',
      'session_with_day_access',
      'group_training',
      195,
      6,
      '{"entitlement_type": "day_access", "includes_session_types": ["open_play"], "includes_session_ticket": true}'::jsonb,
      40
    ),
    (
      v_venue_id,
      'day_access_voucher',
      'Day Pass Voucher',
      'Odaterad gåva/credit som kan lösas in till ett dagsmedlemskap.',
      'voucher',
      NULL,
      195,
      6,
      '{"voucher_type": "day_access"}'::jsonb,
      50
    )
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
END;
$$;
