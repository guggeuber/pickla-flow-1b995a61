CREATE TABLE IF NOT EXISTS public.stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'skipped', 'failed')),
  error text
);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

-- Intentionally no public RLS policies. Service-role Edge Functions manage this table.

CREATE INDEX IF NOT EXISTS idx_stripe_events_received_at
  ON public.stripe_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_events_status
  ON public.stripe_events (status);

-- After applying manually, run:
-- NOTIFY pgrst, 'reload schema';
