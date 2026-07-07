-- Foundation P0: explicit operational health for integrations.
-- Separates imported data windows from synchronization health.

ALTER TABLE public.zettle_connections
  ADD COLUMN IF NOT EXISTS last_successful_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_failed_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_status TEXT NOT NULL DEFAULT 'NEVER_SYNCED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'zettle_connections_last_sync_status_check'
      AND conrelid = 'public.zettle_connections'::regclass
  ) THEN
    ALTER TABLE public.zettle_connections
      ADD CONSTRAINT zettle_connections_last_sync_status_check
      CHECK (last_sync_status IN ('OK', 'FAILED', 'NEVER_SYNCED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_zettle_connections_sync_status
  ON public.zettle_connections (venue_id, last_sync_status, last_successful_sync_at DESC);

CREATE TABLE IF NOT EXISTS public.operations_integration_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  integration_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEVER_SYNCED',
  last_successful_sync_at TIMESTAMPTZ,
  last_failed_sync_at TIMESTAMPTZ,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operations_integration_health_status_check
    CHECK (status IN ('OK', 'FAILED', 'NEVER_SYNCED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_integration_health_unique
  ON public.operations_integration_health (venue_id, integration_key)
  WHERE venue_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_integration_health_global_unique
  ON public.operations_integration_health (integration_key)
  WHERE venue_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_operations_integration_health_status
  ON public.operations_integration_health (venue_id, status, updated_at DESC);

ALTER TABLE public.operations_integration_health ENABLE ROW LEVEL SECURITY;

-- No public policies. Read/write goes through service-role Edge Functions.

UPDATE public.zettle_connections
SET
  last_sync_status = CASE
    WHEN last_import_error IS NOT NULL THEN 'FAILED'
    WHEN last_import_finished_at IS NOT NULL THEN 'OK'
    ELSE last_sync_status
  END,
  last_successful_sync_at = CASE
    WHEN last_import_error IS NULL AND last_import_finished_at IS NOT NULL THEN COALESCE(last_successful_sync_at, last_import_finished_at)
    ELSE last_successful_sync_at
  END,
  last_failed_sync_at = CASE
    WHEN last_import_error IS NOT NULL THEN COALESCE(last_failed_sync_at, last_import_finished_at, updated_at)
    ELSE last_failed_sync_at
  END
WHERE
  (last_import_error IS NOT NULL AND last_sync_status IS DISTINCT FROM 'FAILED')
  OR (last_import_error IS NULL AND last_import_finished_at IS NOT NULL AND last_sync_status IS DISTINCT FROM 'OK')
  OR (last_import_error IS NULL AND last_import_finished_at IS NOT NULL AND last_successful_sync_at IS NULL)
  OR (last_import_error IS NOT NULL AND last_failed_sync_at IS NULL);

INSERT INTO public.operations_integration_health (
  venue_id,
  integration_key,
  status,
  last_successful_sync_at,
  last_failed_sync_at,
  message,
  metadata
)
SELECT
  venue_id,
  'zettle',
  last_sync_status,
  last_successful_sync_at,
  last_failed_sync_at,
  last_import_error,
  jsonb_build_object(
    'source', 'zettle_connections_backfill',
    'last_import_from', last_import_from,
    'last_import_to', last_import_to
  )
FROM public.zettle_connections
ON CONFLICT DO NOTHING;

-- Run after manual SQL editor application:
-- NOTIFY pgrst, 'reload schema';
