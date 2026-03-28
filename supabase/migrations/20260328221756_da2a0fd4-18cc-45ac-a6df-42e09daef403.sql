
-- Add 'used' to day_pass_status enum
ALTER TYPE public.day_pass_status ADD VALUE IF NOT EXISTS 'used';

-- Add shared_from column to day_passes
ALTER TABLE public.day_passes ADD COLUMN IF NOT EXISTS shared_from uuid;

-- Create day_pass_grants table
CREATE TABLE public.day_pass_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  month_year date NOT NULL,
  passes_allowed integer NOT NULL DEFAULT 0,
  passes_used integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(membership_id, month_year)
);

ALTER TABLE public.day_pass_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own grants" ON public.day_pass_grants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = day_pass_grants.membership_id AND m.user_id = auth.uid()
    )
    OR is_super_admin()
    OR is_venue_member(auth.uid(), venue_id)
  );

CREATE POLICY "Admin manages grants" ON public.day_pass_grants
  FOR ALL TO authenticated
  USING (is_super_admin() OR is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (is_super_admin() OR is_venue_admin(auth.uid(), venue_id));

-- Create day_pass_shares table
CREATE TABLE public.day_pass_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_pass_id uuid NOT NULL REFERENCES public.day_passes(id) ON DELETE CASCADE,
  shared_by uuid NOT NULL,
  recipient_email text,
  recipient_phone text,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  claimed_by uuid,
  claimed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.day_pass_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own shares" ON public.day_pass_shares
  FOR SELECT TO authenticated
  USING (shared_by = auth.uid() OR claimed_by = auth.uid() OR is_super_admin());

CREATE POLICY "Users create shares" ON public.day_pass_shares
  FOR INSERT TO authenticated
  WITH CHECK (shared_by = auth.uid());

CREATE POLICY "Public read by token" ON public.day_pass_shares
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "Service updates shares" ON public.day_pass_shares
  FOR UPDATE TO authenticated
  USING (shared_by = auth.uid() OR claimed_by = auth.uid() OR is_super_admin());

-- Add FK from day_passes.shared_from to day_pass_shares
ALTER TABLE public.day_passes
  ADD CONSTRAINT day_passes_shared_from_fkey
  FOREIGN KEY (shared_from) REFERENCES public.day_pass_shares(id);
