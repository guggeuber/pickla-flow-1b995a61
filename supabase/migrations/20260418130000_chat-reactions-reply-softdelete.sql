-- ── chat_reactions ───────────────────────────────────────────────────────────
-- room_id is denormalized for efficient realtime filtering by room
CREATE TABLE chat_reactions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  room_id    UUID NOT NULL REFERENCES chat_rooms(id)    ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  emoji      TEXT NOT NULL CHECK (length(emoji) <= 8),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_chat_reactions_room ON chat_reactions(room_id);

ALTER TABLE chat_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_select" ON chat_reactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "reactions_insert" ON chat_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "reactions_delete" ON chat_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE chat_reactions;

-- ── Threading: reply_to_id ────────────────────────────────────────────────────
ALTER TABLE chat_messages ADD COLUMN reply_to_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL;

-- ── Soft delete: allow null content ──────────────────────────────────────────
ALTER TABLE chat_messages ALTER COLUMN content DROP NOT NULL;

-- UPDATE policy: users can only edit their own messages (for soft delete)
CREATE POLICY "chat_messages_update_own"
  ON chat_messages FOR UPDATE TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
