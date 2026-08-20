-- Identity-led Series are managed through the validated api-courses lifecycle.
-- Routine schedule groups remain managed through api-admin. Browser clients
-- may read canonical schedule truth but all writes must cross one of those
-- server-side boundaries; broad staff RLS writes previously bypassed both.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

DROP POLICY IF EXISTS "Venue staff can manage activity series"
  ON public.activity_series;
DROP POLICY IF EXISTS "Venue staff can manage activity sessions"
  ON public.activity_sessions;
DROP POLICY IF EXISTS "Venue staff can manage access products"
  ON public.access_products;

REVOKE ALL ON TABLE public.activity_series FROM anon, authenticated;
REVOKE ALL ON TABLE public.activity_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.access_products FROM anon, authenticated;

GRANT SELECT ON TABLE public.activity_series TO anon, authenticated;
GRANT SELECT ON TABLE public.activity_sessions TO anon, authenticated;
GRANT SELECT ON TABLE public.access_products TO anon, authenticated;

COMMENT ON COLUMN public.activity_series.format_id IS
  'Lifecycle ownership marker: a non-null Format means this identity-led Series is mutated only through the managed Series API. Presentation type remains separate.';
COMMENT ON COLUMN public.activity_series.access_product_id IS
  'Canonical managed-Series product linkage. Generic Schedule APIs must not rewrite or detach this product.';
