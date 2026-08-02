
-- Crews table
CREATE TABLE public.crews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  badge_emoji text DEFAULT '⚡',
  badge_color text DEFAULT '#E86C24',
  crew_type text NOT NULL DEFAULT 'open' CHECK (crew_type IN ('open', 'invite_only', 'closed')),
  min_rating integer NOT NULL DEFAULT 0,
  max_members integer NOT NULL DEFAULT 50,
  created_by uuid NOT NULL,
  venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crews ENABLE ROW LEVEL SECURITY;

-- Crew members table
CREATE TABLE public.crew_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id uuid NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  player_profile_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'co_leader', 'elder', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (crew_id, player_profile_id)
);

ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;

-- Crew challenges table
CREATE TABLE public.crew_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_crew_id uuid NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  challenged_crew_id uuid NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'completed', 'declined')),
  message text,
  result jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.crew_challenges ENABLE ROW LEVEL SECURITY;

-- Security definer function: is user leader of a crew
CREATE OR REPLACE FUNCTION public.is_crew_leader(_user_id uuid, _crew_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crew_members cm
    JOIN public.player_profiles pp ON pp.id = cm.player_profile_id
    WHERE cm.crew_id = _crew_id
      AND pp.auth_user_id = _user_id
      AND cm.role IN ('leader', 'co_leader')
  )
$$;

-- Security definer function: get player_profile_id for auth user
CREATE OR REPLACE FUNCTION public.get_player_profile_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.player_profiles WHERE auth_user_id = _user_id LIMIT 1
$$;

-- RLS Policies for crews
CREATE POLICY "Public can read crews" ON public.crews FOR SELECT USING (true);
CREATE POLICY "Authenticated can create crews" ON public.crews FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "Leader can update crew" ON public.crews FOR UPDATE TO authenticated USING (public.is_crew_leader(auth.uid(), id));
CREATE POLICY "Leader can delete crew" ON public.crews FOR DELETE TO authenticated USING (public.is_crew_leader(auth.uid(), id));

-- RLS Policies for crew_members
CREATE POLICY "Public can read crew members" ON public.crew_members FOR SELECT USING (true);
CREATE POLICY "Authenticated can join crew" ON public.crew_members FOR INSERT TO authenticated
  WITH CHECK (player_profile_id = public.get_player_profile_id(auth.uid()));
CREATE POLICY "Members can leave crew" ON public.crew_members FOR DELETE TO authenticated
  USING (
    player_profile_id = public.get_player_profile_id(auth.uid())
    OR public.is_crew_leader(auth.uid(), crew_id)
  );
CREATE POLICY "Leader can update member roles" ON public.crew_members FOR UPDATE TO authenticated
  USING (public.is_crew_leader(auth.uid(), crew_id));

-- RLS Policies for crew_challenges
CREATE POLICY "Public can read crew challenges" ON public.crew_challenges FOR SELECT USING (true);
CREATE POLICY "Leader can create challenges" ON public.crew_challenges FOR INSERT TO authenticated
  WITH CHECK (public.is_crew_leader(auth.uid(), challenger_crew_id));
CREATE POLICY "Leader can update challenges" ON public.crew_challenges FOR UPDATE TO authenticated
  USING (
    public.is_crew_leader(auth.uid(), challenger_crew_id)
    OR public.is_crew_leader(auth.uid(), challenged_crew_id)
  );

-- Trigger for updated_at on crews
CREATE TRIGGER update_crews_updated_at
  BEFORE UPDATE ON public.crews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
