
-- Membership tiers per venue (admin creates these)
CREATE TABLE public.membership_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  color text DEFAULT '#E86C24',
  sort_order integer DEFAULT 0,
  discount_percent numeric DEFAULT 0,
  monthly_price numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(venue_id, name)
);

-- Tier-specific pricing overrides (optional fixed prices per tier per product type)
CREATE TABLE public.membership_tier_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id uuid NOT NULL REFERENCES public.membership_tiers(id) ON DELETE CASCADE,
  product_type text NOT NULL, -- 'court_booking', 'day_pass', 'event'
  pricing_rule_id uuid REFERENCES public.pricing_rules(id) ON DELETE SET NULL,
  fixed_price numeric, -- if set, overrides the % discount
  created_at timestamptz DEFAULT now(),
  UNIQUE(tier_id, product_type, pricing_rule_id)
);

-- User memberships (desk staff assigns these)
CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  tier_id uuid NOT NULL REFERENCES public.membership_tiers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active', -- active, expired, cancelled
  starts_at date NOT NULL DEFAULT CURRENT_DATE,
  expires_at date,
  notes text,
  assigned_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, venue_id, tier_id, starts_at)
);

-- Enable RLS
ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_tier_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- Tiers: public read, admin manage
CREATE POLICY "Public can read active tiers" ON public.membership_tiers
  FOR SELECT USING (is_active = true OR is_super_admin() OR is_venue_admin(auth.uid(), venue_id));

CREATE POLICY "Admin manages tiers" ON public.membership_tiers
  FOR ALL USING (is_super_admin() OR is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (is_super_admin() OR is_venue_admin(auth.uid(), venue_id));

-- Tier pricing: public read, admin manage
CREATE POLICY "Public can read tier pricing" ON public.membership_tier_pricing
  FOR SELECT USING (true);

CREATE POLICY "Admin manages tier pricing" ON public.membership_tier_pricing
  FOR ALL USING (
    is_super_admin() OR EXISTS (
      SELECT 1 FROM public.membership_tiers t WHERE t.id = tier_id AND is_venue_admin(auth.uid(), t.venue_id)
    )
  )
  WITH CHECK (
    is_super_admin() OR EXISTS (
      SELECT 1 FROM public.membership_tiers t WHERE t.id = tier_id AND is_venue_admin(auth.uid(), t.venue_id)
    )
  );

-- Memberships: user reads own, staff manages
CREATE POLICY "Users read own membership" ON public.memberships
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin() OR is_venue_member(auth.uid(), venue_id));

CREATE POLICY "Staff manages memberships" ON public.memberships
  FOR ALL USING (is_super_admin() OR is_venue_member(auth.uid(), venue_id))
  WITH CHECK (is_super_admin() OR is_venue_member(auth.uid(), venue_id));

-- Triggers for updated_at
CREATE TRIGGER update_membership_tiers_updated_at
  BEFORE UPDATE ON public.membership_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_memberships_updated_at
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
