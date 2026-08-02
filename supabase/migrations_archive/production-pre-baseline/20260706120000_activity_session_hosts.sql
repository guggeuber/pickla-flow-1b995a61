-- Host assignments for activity sessions.
-- This formalizes the current manual host-comp workflow without creating a host membership.
-- Privacy basis: host first name/avatar may be displayed publicly because host assignment is an explicit public-facing role.

CREATE TABLE IF NOT EXISTS public.activity_session_hosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  activity_session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, activity_session_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_session_hosts_session_active
  ON public.activity_session_hosts (activity_session_id, sort_order)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_activity_session_hosts_customer_active
  ON public.activity_session_hosts (customer_id, activity_session_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_activity_session_hosts_venue
  ON public.activity_session_hosts (venue_id);

DROP TRIGGER IF EXISTS update_activity_session_hosts_updated_at ON public.activity_session_hosts;
CREATE TRIGGER update_activity_session_hosts_updated_at
  BEFORE UPDATE ON public.activity_session_hosts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.activity_session_hosts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read activity session hosts" ON public.activity_session_hosts;
CREATE POLICY "Staff can read activity session hosts"
  ON public.activity_session_hosts
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.user_id = auth.uid()
        AND vs.venue_id = activity_session_hosts.venue_id
        AND vs.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = activity_session_hosts.customer_id
        AND c.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Venue admins can manage activity session hosts" ON public.activity_session_hosts;
CREATE POLICY "Venue admins can manage activity session hosts"
  ON public.activity_session_hosts
  FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.user_id = auth.uid()
        AND vs.venue_id = activity_session_hosts.venue_id
        AND vs.is_active = true
        AND vs.role = 'venue_admin'
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.user_id = auth.uid()
        AND vs.venue_id = activity_session_hosts.venue_id
        AND vs.is_active = true
        AND vs.role = 'venue_admin'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_receipts_host_comp_source
  ON public.booking_receipts ((metadata->>'source_type'), (metadata->>'source_id'))
  WHERE (metadata->>'source_type') = 'host_comp';

CREATE OR REPLACE FUNCTION public.get_public_activity_session_hosts(session_ids UUID[])
RETURNS TABLE (
  activity_session_id UUID,
  customer_id UUID,
  first_name TEXT,
  display_name TEXT,
  avatar_url TEXT,
  sort_order INTEGER
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    h.activity_session_id,
    h.customer_id,
    NULLIF(split_part(COALESCE(c.first_name, c.display_name, p.first_name, p.display_name, ''), ' ', 1), '') AS first_name,
    COALESCE(c.display_name, p.display_name, c.first_name) AS display_name,
    p.avatar_url,
    h.sort_order
  FROM public.activity_session_hosts h
  JOIN public.activity_sessions s ON s.id = h.activity_session_id
  JOIN public.venues v ON v.id = h.venue_id
  JOIN public.customers c ON c.id = h.customer_id
  LEFT JOIN LATERAL (
    SELECT pp.first_name, pp.display_name, pp.avatar_url
    FROM public.player_profiles pp
    WHERE pp.customer_id = c.id
    ORDER BY pp.created_at DESC NULLS LAST, pp.id
    LIMIT 1
  ) p ON true
  WHERE h.status = 'active'
    AND h.activity_session_id = ANY(session_ids)
    AND s.is_active = true
    AND s.publish_status = 'published'
    AND v.is_public = true
  ORDER BY h.activity_session_id, h.sort_order ASC, h.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_activity_session_hosts(UUID[]) TO anon, authenticated;

-- Reminder after manual SQL editor execution:
-- NOTIFY pgrst, 'reload schema';
