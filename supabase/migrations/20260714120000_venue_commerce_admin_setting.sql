-- Venue Commerce Admin setting.
-- Changes the venue-level online sales gate and records the mutation atomically.

CREATE OR REPLACE FUNCTION public.set_venue_commerce_enabled(
  p_venue_id UUID,
  p_enabled BOOLEAN,
  p_actor_user_id UUID,
  p_request_id TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE (
  venue_id UUID,
  previous_value BOOLEAN,
  commerce_enabled BOOLEAN,
  changed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous BOOLEAN;
  v_organization_id UUID;
  v_changed BOOLEAN;
BEGIN
  SELECT venue.organization_id, venue.commerce_enabled
  INTO v_organization_id, v_previous
  FROM public.venues venue
  WHERE venue.id = p_venue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venue not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles role_row
    WHERE role_row.user_id = p_actor_user_id
      AND role_row.role = 'super_admin'
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.venue_staff staff
    WHERE staff.user_id = p_actor_user_id
      AND staff.venue_id = p_venue_id
      AND staff.role = 'venue_admin'
      AND staff.is_active = true
  ) THEN
    RAISE EXCEPTION 'Forbidden: venue admin only' USING ERRCODE = '42501';
  END IF;

  v_changed := v_previous IS DISTINCT FROM p_enabled;

  IF v_changed THEN
    UPDATE public.venues
    SET commerce_enabled = p_enabled
    WHERE id = p_venue_id;

    INSERT INTO public.audit_log (
      organization_id,
      venue_id,
      actor_user_id,
      actor_type,
      action,
      entity_table,
      entity_id,
      request_id,
      before,
      after,
      metadata,
      ip,
      user_agent
    ) VALUES (
      v_organization_id,
      p_venue_id,
      p_actor_user_id,
      'user',
      'venue.commerce.availability_changed',
      'venues',
      p_venue_id::TEXT,
      COALESCE(p_request_id, gen_random_uuid()::TEXT),
      jsonb_build_object('commerce_enabled', v_previous),
      jsonb_build_object('commerce_enabled', p_enabled),
      jsonb_build_object('setting', 'online_sales'),
      p_ip,
      p_user_agent
    );
  END IF;

  RETURN QUERY
  SELECT p_venue_id, v_previous, p_enabled, v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.set_venue_commerce_enabled(UUID, BOOLEAN, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_venue_commerce_enabled(UUID, BOOLEAN, UUID, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_venue_commerce_enabled(UUID, BOOLEAN, UUID, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.set_venue_commerce_enabled(UUID, BOOLEAN, UUID, TEXT, TEXT, TEXT) IS
  'Atomically changes venue online sales availability and records before/after audit evidence.';

-- Manual SQL Editor reminder:
-- NOTIFY pgrst, 'reload schema';
