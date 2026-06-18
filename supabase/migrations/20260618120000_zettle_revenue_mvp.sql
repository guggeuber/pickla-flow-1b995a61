CREATE TABLE IF NOT EXISTS public.zettle_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  organization_uuid TEXT,
  zettle_user_uuid TEXT,
  oauth_state TEXT,
  oauth_state_expires_at TIMESTAMPTZ,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['READ:PURCHASE']::TEXT[],
  last_import_started_at TIMESTAMPTZ,
  last_import_finished_at TIMESTAMPTZ,
  last_import_from TIMESTAMPTZ,
  last_import_to TIMESTAMPTZ,
  last_import_count INTEGER NOT NULL DEFAULT 0,
  last_import_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id)
);

CREATE INDEX IF NOT EXISTS idx_zettle_connections_state
  ON public.zettle_connections (oauth_state)
  WHERE oauth_state IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.zettle_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES public.zettle_connections(id) ON DELETE SET NULL,
  purchase_uuid TEXT NOT NULL,
  purchase_number TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  amount_inc_vat_minor INTEGER NOT NULL DEFAULT 0,
  vat_amount_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT,
  payment_method TEXT,
  payment_status TEXT NOT NULL DEFAULT 'paid',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, purchase_uuid)
);

CREATE INDEX IF NOT EXISTS idx_zettle_purchases_venue_occurred
  ON public.zettle_purchases (venue_id, occurred_at DESC);

ALTER TABLE public.zettle_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zettle_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view zettle_purchases"
  ON public.zettle_purchases
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.venue_staff
      WHERE venue_staff.user_id = auth.uid()
        AND venue_staff.venue_id = zettle_purchases.venue_id
        AND venue_staff.is_active = true
        AND venue_staff.role IN ('super_admin', 'admin', 'venue_admin', 'desk')
    )
    OR public.is_super_admin()
  );
