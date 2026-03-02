
-- ============================================================
-- PICKLA PLATFORM — COMPLETE DATABASE SCHEMA
-- Multi-venue pickleball platform with games, bookings & CRM
-- ============================================================

-- ==================== ENUMS ====================

CREATE TYPE public.app_role AS ENUM ('customer', 'desk_staff', 'venue_admin', 'super_admin');
CREATE TYPE public.event_type AS ENUM ('tournament', 'team_competition', 'corporate_event', 'mini_cup');
CREATE TYPE public.event_format AS ENUM ('round_robin', 'knockout', 'mini_cup_2h', 'team_vs_team', 'amerikano', 'ladder');
CREATE TYPE public.match_status AS ENUM ('scheduled', 'in_progress', 'completed');
CREATE TYPE public.match_stage AS ENUM ('group', 'semifinal', 'final', 'third_place');
CREATE TYPE public.booking_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed', 'no_show');
CREATE TYPE public.day_pass_status AS ENUM ('active', 'expired', 'cancelled');
CREATE TYPE public.venue_status AS ENUM ('active', 'inactive', 'coming_soon');

-- ==================== 1. VENUES (Multi-tenant root) ====================

CREATE TABLE public.venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'SE',
  phone TEXT,
  email TEXT,
  website_url TEXT,
  logo_url TEXT,
  cover_image_url TEXT,
  primary_color TEXT DEFAULT '#E86C24',
  secondary_color TEXT,
  status venue_status DEFAULT 'active',
  is_public BOOLEAN DEFAULT true,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  timezone TEXT DEFAULT 'Europe/Stockholm',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 2. USER ROLES ====================

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role)
);

-- ==================== 3. VENUE STAFF ====================

CREATE TABLE public.venue_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  role app_role NOT NULL CHECK (role IN ('desk_staff', 'venue_admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, venue_id, role)
);

-- ==================== 4. VENUE COURTS ====================

CREATE TABLE public.venue_courts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  court_number INTEGER NOT NULL,
  court_type TEXT DEFAULT 'indoor',
  is_available BOOLEAN DEFAULT true,
  hourly_rate DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(venue_id, court_number)
);

-- ==================== 5. OPENING HOURS ====================

CREATE TABLE public.opening_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  is_closed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(venue_id, day_of_week)
);

-- ==================== 6. PRICING RULES ====================

CREATE TABLE public.pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('hourly', 'day_pass', 'membership', 'event_fee')),
  price DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'SEK',
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 7. PLAYER PROFILES (Global, cross-venue) ====================

CREATE TABLE public.player_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  display_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  pickla_rating INTEGER DEFAULT 1000,
  total_matches INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  bio TEXT,
  preferred_venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 8. BOOKINGS ====================

CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  venue_court_id UUID NOT NULL REFERENCES public.venue_courts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status booking_status DEFAULT 'pending',
  total_price DECIMAL(10,2),
  currency TEXT DEFAULT 'SEK',
  notes TEXT,
  booked_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 9. DAY PASSES ====================

CREATE TABLE public.day_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_date DATE NOT NULL,
  status day_pass_status DEFAULT 'active',
  price DECIMAL(10,2),
  currency TEXT DEFAULT 'SEK',
  sold_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 10. EVENTS (with venue_id) ====================

CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  event_type event_type NOT NULL,
  format event_format NOT NULL,
  status TEXT DEFAULT 'upcoming',
  is_public BOOLEAN DEFAULT true,
  number_of_courts INTEGER DEFAULT 1,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  logo_url TEXT,
  background_url TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  aspect_ratio TEXT,
  scoring_type TEXT,
  scoring_format TEXT,
  points_to_win INTEGER,
  best_of INTEGER,
  win_by_two BOOLEAN DEFAULT false,
  match_duration_default INTEGER,
  competition_type TEXT,
  battle_config JSONB,
  group_stage_completed BOOLEAN DEFAULT false,
  semifinals_generated BOOLEAN DEFAULT false,
  final_generated BOOLEAN DEFAULT false,
  third_place_enabled BOOLEAN DEFAULT false,
  tournament_complete BOOLEAN DEFAULT false,
  winner_team_id UUID,
  player_info_general TEXT,
  offer_title TEXT,
  offer_description TEXT,
  offer_valid_until TIMESTAMPTZ,
  offer_show_on_ticker BOOLEAN DEFAULT false,
  offer_show_on_player_info BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 11. TEAMS ====================

CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#000000',
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add FK for events.winner_team_id after teams exists
ALTER TABLE public.events ADD CONSTRAINT events_winner_team_id_fkey
  FOREIGN KEY (winner_team_id) REFERENCES public.teams(id) ON DELETE SET NULL;

-- ==================== 12. PLAYERS (per event) ====================

CREATE TABLE public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  is_captain BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 13. COURTS (per event, legacy) ====================

CREATE TABLE public.courts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  court_number INTEGER NOT NULL,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 14. MATCHES ====================

CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  match_number INTEGER NOT NULL,
  team1_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  team2_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  court_id UUID REFERENCES public.courts(id) ON DELETE SET NULL,
  team1_score INTEGER DEFAULT 0,
  team2_score INTEGER DEFAULT 0,
  status match_status DEFAULT 'scheduled',
  stage match_stage,
  scheduled_time TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  match_duration_minutes INTEGER,
  match_scoring_type TEXT,
  best_of_games INTEGER,
  points_per_game INTEGER,
  game_scores JSONB,
  battle_id TEXT,
  battle_round INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 15. STANDINGS ====================

CREATE TABLE public.standings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  points_for INTEGER DEFAULT 0,
  points_against INTEGER DEFAULT 0,
  rank INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, team_id)
);

-- ==================== 16. LADDER ENTRIES ====================

CREATE TABLE public.ladder_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  player_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  position INTEGER NOT NULL,
  absences INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 17. LADDER MATCHES ====================

CREATE TABLE public.ladder_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  challenger_entry_id UUID NOT NULL REFERENCES public.ladder_entries(id) ON DELETE CASCADE,
  challenged_entry_id UUID NOT NULL REFERENCES public.ladder_entries(id) ON DELETE CASCADE,
  challenger_position_before INTEGER NOT NULL,
  challenged_position_before INTEGER NOT NULL,
  challenger_score INTEGER,
  challenged_score INTEGER,
  winner_entry_id UUID REFERENCES public.ladder_entries(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'scheduled',
  played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 18. LADDER CHALLENGES ====================

CREATE TABLE public.ladder_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  challenger_entry_id UUID NOT NULL REFERENCES public.ladder_entries(id) ON DELETE CASCADE,
  challenged_entry_id UUID NOT NULL REFERENCES public.ladder_entries(id) ON DELETE CASCADE,
  challenger_player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  message TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 19. SEASONS ====================

CREATE TABLE public.seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT DEFAULT 'upcoming',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 20. SEASON STANDINGS ====================

CREATE TABLE public.season_standings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  final_position INTEGER,
  total_wins INTEGER DEFAULT 0,
  total_matches INTEGER DEFAULT 0,
  rating_change INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== 21. EVENT CHECKINS ====================

CREATE TABLE public.event_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  checked_in BOOLEAN DEFAULT false,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, player_id, session_date)
);

-- ==================== 22. EVENT LIKES ====================

CREATE TABLE public.event_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, auth_user_id)
);

-- ==================== 23. EVENT OFFERS ====================

CREATE TABLE public.event_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  cta_label TEXT,
  priority INTEGER DEFAULT 0,
  display_on_ticker BOOLEAN DEFAULT false,
  display_on_player_info BOOLEAN DEFAULT false,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== ENABLE RLS ON ALL TABLES ====================

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.day_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ladder_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ladder_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ladder_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_offers ENABLE ROW LEVEL SECURITY;

-- ==================== SECURITY DEFINER HELPER FUNCTIONS ====================

-- Check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Check if user is super admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'super_admin')
$$;

-- Check if user is staff/admin at a specific venue
CREATE OR REPLACE FUNCTION public.is_venue_member(_user_id UUID, _venue_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_staff
    WHERE user_id = _user_id AND venue_id = _venue_id AND is_active = true
  )
$$;

-- Check if user is venue admin at a specific venue
CREATE OR REPLACE FUNCTION public.is_venue_admin(_user_id UUID, _venue_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_staff
    WHERE user_id = _user_id AND venue_id = _venue_id AND role = 'venue_admin' AND is_active = true
  )
$$;

-- Get venue_id from event_id
CREATE OR REPLACE FUNCTION public.get_venue_id_for_event(_event_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT venue_id FROM public.events WHERE id = _event_id
$$;

-- ==================== RLS POLICIES ====================

-- VENUES: public read, admin/super write
CREATE POLICY "Public can read active venues" ON public.venues
  FOR SELECT USING (is_public = true OR public.is_super_admin() OR public.is_venue_member(auth.uid(), id));

CREATE POLICY "Super admin can manage venues" ON public.venues
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY "Venue admin can update own venue" ON public.venues
  FOR UPDATE TO authenticated USING (public.is_venue_admin(auth.uid(), id));

-- USER ROLES: only super admin + own read
CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_super_admin());

CREATE POLICY "Super admin manages roles" ON public.user_roles
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- VENUE STAFF: venue admin + super admin
CREATE POLICY "Staff can read own venue staff" ON public.venue_staff
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id) OR user_id = auth.uid());

CREATE POLICY "Admin can manage venue staff" ON public.venue_staff
  FOR ALL TO authenticated USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id));

-- VENUE COURTS: public read, admin write
CREATE POLICY "Public can read venue courts" ON public.venue_courts
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage venue courts" ON public.venue_courts
  FOR ALL TO authenticated USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id));

-- OPENING HOURS: public read, admin write
CREATE POLICY "Public can read opening hours" ON public.opening_hours
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage opening hours" ON public.opening_hours
  FOR ALL TO authenticated USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id));

-- PRICING RULES: public read, admin write
CREATE POLICY "Public can read pricing" ON public.pricing_rules
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage pricing" ON public.pricing_rules
  FOR ALL TO authenticated USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id));

-- PLAYER PROFILES: public read, own write
CREATE POLICY "Anyone can read player profiles" ON public.player_profiles
  FOR SELECT USING (true);

CREATE POLICY "Users manage own profile" ON public.player_profiles
  FOR ALL TO authenticated USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Super admin manages profiles" ON public.player_profiles
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- BOOKINGS: own read + venue staff read + admin
CREATE POLICY "Users read own bookings" ON public.bookings
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_super_admin() OR public.is_venue_member(auth.uid(), venue_id));

CREATE POLICY "Users create own bookings" ON public.bookings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.is_super_admin() OR public.is_venue_member(auth.uid(), venue_id));

CREATE POLICY "Admin manages bookings" ON public.bookings
  FOR ALL TO authenticated USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id));

-- DAY PASSES: own read + venue staff
CREATE POLICY "Users read own day passes" ON public.day_passes
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_super_admin() OR public.is_venue_member(auth.uid(), venue_id));

CREATE POLICY "Staff can create day passes" ON public.day_passes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.is_super_admin() OR public.is_venue_member(auth.uid(), venue_id));

CREATE POLICY "Admin manages day passes" ON public.day_passes
  FOR ALL TO authenticated USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id));

-- EVENTS: public read, venue admin write
CREATE POLICY "Public can read events" ON public.events
  FOR SELECT USING (is_public = true OR public.is_super_admin() OR public.is_venue_member(auth.uid(), venue_id));

CREATE POLICY "Admin can manage events" ON public.events
  FOR ALL TO authenticated USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (public.is_super_admin() OR public.is_venue_admin(auth.uid(), venue_id));

-- TEAMS: public read via event
CREATE POLICY "Public can read teams" ON public.teams
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage teams" ON public.teams
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_admin(auth.uid(), public.get_venue_id_for_event(event_id)));

-- PLAYERS: public read
CREATE POLICY "Public can read players" ON public.players
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage players" ON public.players
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_admin(auth.uid(), public.get_venue_id_for_event(event_id)));

-- COURTS (legacy, per event): public read
CREATE POLICY "Public can read courts" ON public.courts
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage courts" ON public.courts
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_admin(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_admin(auth.uid(), public.get_venue_id_for_event(event_id)));

-- MATCHES: public read
CREATE POLICY "Public can read matches" ON public.matches
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage matches" ON public.matches
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)));

-- STANDINGS: public read
CREATE POLICY "Public can read standings" ON public.standings
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage standings" ON public.standings
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)));

-- LADDER ENTRIES: public read
CREATE POLICY "Public can read ladder entries" ON public.ladder_entries
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage ladder entries" ON public.ladder_entries
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)));

-- LADDER MATCHES: public read
CREATE POLICY "Public can read ladder matches" ON public.ladder_matches
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage ladder matches" ON public.ladder_matches
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)));

-- LADDER CHALLENGES: public read
CREATE POLICY "Public can read ladder challenges" ON public.ladder_challenges
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage ladder challenges" ON public.ladder_challenges
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)));

-- SEASONS: public read
CREATE POLICY "Public can read seasons" ON public.seasons
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage seasons" ON public.seasons
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)));

-- SEASON STANDINGS: public read
CREATE POLICY "Public can read season standings" ON public.season_standings
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage season standings" ON public.season_standings
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- EVENT CHECKINS: public read, authenticated insert
CREATE POLICY "Public can read checkins" ON public.event_checkins
  FOR SELECT USING (true);

CREATE POLICY "Authenticated can manage checkins" ON public.event_checkins
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)));

-- EVENT LIKES: public read, own insert/delete
CREATE POLICY "Public can read likes" ON public.event_likes
  FOR SELECT USING (true);

CREATE POLICY "Users manage own likes" ON public.event_likes
  FOR INSERT TO authenticated WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Users delete own likes" ON public.event_likes
  FOR DELETE TO authenticated USING (auth_user_id = auth.uid());

-- EVENT OFFERS: public read, admin write
CREATE POLICY "Public can read offers" ON public.event_offers
  FOR SELECT USING (true);

CREATE POLICY "Admin can manage offers" ON public.event_offers
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)))
  WITH CHECK (public.is_super_admin() OR public.is_venue_member(auth.uid(), public.get_venue_id_for_event(event_id)));

-- ==================== TRIGGERS ====================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_venues_updated_at BEFORE UPDATE ON public.venues FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_venue_staff_updated_at BEFORE UPDATE ON public.venue_staff FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_venue_courts_updated_at BEFORE UPDATE ON public.venue_courts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pricing_rules_updated_at BEFORE UPDATE ON public.pricing_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_player_profiles_updated_at BEFORE UPDATE ON public.player_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_courts_updated_at BEFORE UPDATE ON public.courts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_matches_updated_at BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_standings_updated_at BEFORE UPDATE ON public.standings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ladder_entries_updated_at BEFORE UPDATE ON public.ladder_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ladder_matches_updated_at BEFORE UPDATE ON public.ladder_matches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ladder_challenges_updated_at BEFORE UPDATE ON public.ladder_challenges FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_seasons_updated_at BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_event_offers_updated_at BEFORE UPDATE ON public.event_offers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==================== AUTO-CREATE PROFILE ON SIGNUP ====================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.player_profiles (auth_user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.email));
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==================== REALTIME ====================

ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.standings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_checkins;

-- ==================== INDEXES ====================

CREATE INDEX idx_venue_staff_user ON public.venue_staff(user_id);
CREATE INDEX idx_venue_staff_venue ON public.venue_staff(venue_id);
CREATE INDEX idx_bookings_user ON public.bookings(user_id);
CREATE INDEX idx_bookings_venue ON public.bookings(venue_id);
CREATE INDEX idx_bookings_time ON public.bookings(start_time, end_time);
CREATE INDEX idx_events_venue ON public.events(venue_id);
CREATE INDEX idx_matches_event ON public.matches(event_id);
CREATE INDEX idx_players_event ON public.players(event_id);
CREATE INDEX idx_teams_event ON public.teams(event_id);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_day_passes_venue ON public.day_passes(venue_id);
CREATE INDEX idx_day_passes_user ON public.day_passes(user_id);
