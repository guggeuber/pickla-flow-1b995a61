-- Pickla Hub: replace legacy chat_channels/chat_messages with new room-based schema
-- The old tables (chat_channels, chat_messages) have no production data and are safe to drop.

-- ─── Drop old tables ─────────────────────────────────────────────────────────

DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_channels CASCADE;
-- chat_rooms may exist from a failed previous run — drop for idempotency
DROP TABLE IF EXISTS chat_rooms CASCADE;
DROP TABLE IF EXISTS chat_participants CASCADE;

-- ─── New tables ──────────────────────────────────────────────────────────────

CREATE TABLE chat_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  room_type TEXT NOT NULL CHECK (room_type IN ('daily', 'booking', 'event', 'ritual')),
  title TEXT NOT NULL,
  subtitle TEXT,
  emoji TEXT DEFAULT '💬',
  resource_id TEXT,       -- booking_ref, event_id, open_play_session_id
  is_public BOOLEAN NOT NULL DEFAULT true,
  session_date DATE,      -- used for daily rooms (enforce one-per-day)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- One daily room per venue per day
CREATE UNIQUE INDEX idx_chat_rooms_daily
  ON chat_rooms(venue_id, session_date)
  WHERE room_type = 'daily' AND session_date IS NOT NULL;

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- text: normal user message
  -- bot: system / Pickla bot message
  -- action_card: interactive widget (stored for event/booking rooms)
  -- booking_card: booking details card
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'bot', 'action_card', 'booking_card')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_messages_room ON chat_messages(room_id, created_at DESC);

CREATE TABLE chat_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, user_id)
);

-- ─── Realtime ────────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- ─── Trigger: bump room.updated_at on every new message ──────────────────────

CREATE OR REPLACE FUNCTION fn_bump_room_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE chat_rooms SET updated_at = NOW() WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_bump_room ON chat_messages;
CREATE TRIGGER trg_chat_messages_bump_room
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION fn_bump_room_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;

-- chat_rooms: public rooms readable by all authenticated users
CREATE POLICY "Authenticated can read public rooms"
  ON chat_rooms FOR SELECT TO authenticated
  USING (
    is_public = true
    OR EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.room_id = chat_rooms.id
        AND chat_participants.user_id = auth.uid()
    )
  );

-- chat_rooms: authenticated users can insert (create) rooms
CREATE POLICY "Authenticated can create rooms"
  ON chat_rooms FOR INSERT TO authenticated
  WITH CHECK (true);

-- chat_messages: readable if room is accessible
CREATE POLICY "Read messages in accessible rooms"
  ON chat_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_rooms r
      WHERE r.id = chat_messages.room_id
        AND (
          r.is_public = true
          OR EXISTS (
            SELECT 1 FROM chat_participants cp
            WHERE cp.room_id = r.id AND cp.user_id = auth.uid()
          )
        )
    )
  );

-- chat_messages: authenticated users can send messages
CREATE POLICY "Authenticated can send messages"
  ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- chat_participants: users manage own participation
CREATE POLICY "Users manage own participation"
  ON chat_participants FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Read room participants"
  ON chat_participants FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_rooms r
      WHERE r.id = chat_participants.room_id AND r.is_public = true
    )
    OR user_id = auth.uid()
  );
