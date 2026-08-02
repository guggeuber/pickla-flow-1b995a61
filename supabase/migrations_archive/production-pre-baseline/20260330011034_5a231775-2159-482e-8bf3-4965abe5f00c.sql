
-- 1. Add sport_type to venue_courts
ALTER TABLE public.venue_courts ADD COLUMN IF NOT EXISTS sport_type text NOT NULL DEFAULT 'pickleball';

-- 2. Add sport_type to events  
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS sport_type text NOT NULL DEFAULT 'pickleball';

-- 3. Add sport_type to event_templates
ALTER TABLE public.event_templates ADD COLUMN IF NOT EXISTS sport_type text NOT NULL DEFAULT 'pickleball';

-- 4. Chat channels table
CREATE TABLE public.chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid REFERENCES public.venues(id) ON DELETE CASCADE,
  crew_id uuid REFERENCES public.crews(id) ON DELETE CASCADE,
  channel_type text NOT NULL DEFAULT 'venue',
  name text NOT NULL,
  description text,
  sport_type text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active channels" ON public.chat_channels
  FOR SELECT TO public USING (is_active = true);

CREATE POLICY "Admin manages channels" ON public.chat_channels
  FOR ALL TO authenticated
  USING (is_super_admin() OR (venue_id IS NOT NULL AND is_venue_admin(auth.uid(), venue_id)) OR (crew_id IS NOT NULL AND is_crew_leader(auth.uid(), crew_id)))
  WITH CHECK (is_super_admin() OR (venue_id IS NOT NULL AND is_venue_admin(auth.uid(), venue_id)) OR (crew_id IS NOT NULL AND is_crew_leader(auth.uid(), crew_id)));

-- 5. Chat messages table
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  sender_profile_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  message_type text NOT NULL DEFAULT 'text',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read messages" ON public.chat_messages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users send own messages" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_profile_id = get_player_profile_id(auth.uid()));

CREATE POLICY "Users delete own messages" ON public.chat_messages
  FOR DELETE TO authenticated
  USING (sender_profile_id = get_player_profile_id(auth.uid()));

-- 6. Enable realtime for chat
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- 7. Index for fast message retrieval
CREATE INDEX idx_chat_messages_channel_created ON public.chat_messages(channel_id, created_at DESC);
CREATE INDEX idx_chat_channels_venue ON public.chat_channels(venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX idx_chat_channels_crew ON public.chat_channels(crew_id) WHERE crew_id IS NOT NULL;
CREATE INDEX idx_venue_courts_sport ON public.venue_courts(sport_type);
