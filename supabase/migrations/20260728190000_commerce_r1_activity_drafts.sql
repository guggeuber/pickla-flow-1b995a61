-- Commerce R1: one server-owned draft per authenticated activity occurrence.
-- Standalone carts keep their existing token and lifecycle semantics.

ALTER TABLE public.commerce_orders
  ADD COLUMN IF NOT EXISTS draft_scope TEXT;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY venue_id, user_id, draft_scope
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS position
  FROM public.commerce_orders
  WHERE status = 'draft'
    AND user_id IS NOT NULL
    AND draft_scope LIKE 'activity:%'
)
UPDATE public.commerce_orders orders
SET status = 'expired',
    expires_at = COALESCE(orders.expires_at, now()),
    metadata = COALESCE(orders.metadata, '{}'::jsonb)
      || jsonb_build_object('expiry_reason', 'commerce_r1_duplicate_activity_draft')
FROM ranked
WHERE orders.id = ranked.id
  AND ranked.position > 1;

UPDATE public.commerce_orders
SET status = 'expired',
    expires_at = COALESCE(expires_at, now()),
    metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object('expiry_reason', 'commerce_r1_stale_activity_draft')
WHERE status = 'draft'
  AND user_id IS NOT NULL
  AND draft_scope LIKE 'activity:%'
  AND updated_at < now() - interval '30 days';

UPDATE public.commerce_orders
SET expires_at = now() + interval '30 days'
WHERE status = 'draft'
  AND user_id IS NOT NULL
  AND draft_scope LIKE 'activity:%';

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_orders_active_activity_draft
  ON public.commerce_orders (venue_id, user_id, draft_scope)
  WHERE status = 'draft'
    AND user_id IS NOT NULL
    AND draft_scope LIKE 'activity:%';

COMMENT ON COLUMN public.commerce_orders.draft_scope IS
  'Authenticated Commerce draft scope. R1 uses activity:<session_id>:<session_date>.';
