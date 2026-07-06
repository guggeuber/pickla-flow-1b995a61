-- Pickla Pulse access tokens.
-- Token values are only returned once by api-pulse/create-token; the database
-- stores SHA-256 hashes. Pulse reports expose aggregate metrics only.

CREATE TABLE IF NOT EXISTS public.pulse_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  label TEXT,
  access_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  token_expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pulse_tokens_status_check CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_pulse_tokens_hash
  ON public.pulse_tokens (access_token_hash);

CREATE INDEX IF NOT EXISTS idx_pulse_tokens_status_expires
  ON public.pulse_tokens (status, token_expires_at);

CREATE INDEX IF NOT EXISTS idx_pulse_tokens_venue
  ON public.pulse_tokens (venue_id, created_at DESC);

DROP TRIGGER IF EXISTS update_pulse_tokens_updated_at ON public.pulse_tokens;
CREATE TRIGGER update_pulse_tokens_updated_at
  BEFORE UPDATE ON public.pulse_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pulse_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pulse_tokens_service_only" ON public.pulse_tokens;
CREATE POLICY "pulse_tokens_service_only"
  ON public.pulse_tokens
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Reminder after manual SQL editor deploy:
-- NOTIFY pgrst, 'reload schema';
