-- Restore the active public event-logo capability without reviving the broad
-- authenticated-write policies from the archived migration history.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'event-logos',
  'event-logos',
  true,
  5242880,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.can_manage_event_logo_object(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parts text[];
  v_part_count integer;
  v_venue_id uuid;
  v_resource_id uuid;
  v_is_canonical boolean := false;
BEGIN
  IF auth.uid() IS NULL
     OR p_name IS NULL
     OR p_name = ''
     OR p_name LIKE '/%'
     OR p_name LIKE '%//%'
     OR p_name LIKE '%..%' THEN
    RETURN false;
  END IF;

  v_parts := string_to_array(p_name, '/');
  v_part_count := cardinality(v_parts);

  -- Existing AdminVenue behavior: categories/<venue>/<category>.<ext>.
  IF v_part_count = 3
     AND v_parts[1] = 'categories'
     AND lower(v_parts[3]) ~ '^[a-z0-9_-]+\.(png|jpe?g|webp|svg)$' THEN
    v_venue_id := v_parts[2]::uuid;
    v_is_canonical := true;

  -- Existing venue hero-image behavior.
  ELSIF v_part_count = 3
        AND v_parts[1] IN ('venue-home', 'group-booking')
        AND lower(v_parts[3]) ~ '^hero\.(png|jpe?g|webp|svg)$' THEN
    v_venue_id := v_parts[2]::uuid;
    v_is_canonical := true;

  -- Existing AdminEvents behavior: <event>/logo.<ext>.
  ELSIF v_part_count = 2
        AND lower(v_parts[2]) ~ '^logo\.(png|jpe?g|webp|svg)$' THEN
    v_resource_id := v_parts[1]::uuid;
    SELECT e.venue_id
      INTO v_venue_id
      FROM public.events e
     WHERE e.id = v_resource_id;
    v_is_canonical := v_venue_id IS NOT NULL;

  -- Event templates are global/HQ-owned in the current schema and are
  -- therefore writable only by a super-admin.
  ELSIF v_part_count = 3
        AND v_parts[1] = 'templates'
        AND lower(v_parts[3]) ~ '^logo\.(png|jpe?g|webp|svg)$' THEN
    v_resource_id := v_parts[2]::uuid;
    v_is_canonical := EXISTS (
      SELECT 1 FROM public.event_templates t WHERE t.id = v_resource_id
    );
    RETURN v_is_canonical AND public.is_super_admin();
  END IF;

  IF NOT v_is_canonical OR v_venue_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.is_super_admin()
      OR public.is_venue_admin(auth.uid(), v_venue_id);
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_event_logo_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_event_logo_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_logo_object(text) TO service_role;

DROP POLICY IF EXISTS "Public can read event logos" ON storage.objects;
CREATE POLICY "Public can read event logos"
ON storage.objects
FOR SELECT
USING (bucket_id = 'event-logos');

DROP POLICY IF EXISTS "Venue admins can upload event logos" ON storage.objects;
CREATE POLICY "Venue admins can upload event logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-logos'
  AND public.can_manage_event_logo_object(name)
);

DROP POLICY IF EXISTS "Venue admins can update event logos" ON storage.objects;
CREATE POLICY "Venue admins can update event logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-logos'
  AND public.can_manage_event_logo_object(name)
)
WITH CHECK (
  bucket_id = 'event-logos'
  AND public.can_manage_event_logo_object(name)
);

DROP POLICY IF EXISTS "Venue admins can delete event logos" ON storage.objects;
CREATE POLICY "Venue admins can delete event logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-logos'
  AND public.can_manage_event_logo_object(name)
);

-- Reconciliation tooling records one immutable audit event per verified
-- production reference. The request id is deterministic, making retries safe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_event_logo_reconciliation_request
ON public.audit_log (request_id)
WHERE action = 'platform.event_logo.reconciled'
  AND request_id IS NOT NULL;

COMMENT ON FUNCTION public.can_manage_event_logo_object(text) IS
  'Authorizes only canonical event-logo paths owned by the caller venue, or global template paths for super-admins.';
