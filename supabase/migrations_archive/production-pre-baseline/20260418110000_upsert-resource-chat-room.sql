-- RPC: upsert_resource_chat_room
-- PostgREST cannot resolve ON CONFLICT against a partial unique index via REST,
-- so booking and event rooms use this server-side function instead.

CREATE OR REPLACE FUNCTION upsert_resource_chat_room(
  p_venue_id   UUID,
  p_resource_id TEXT,
  p_room_type  TEXT,
  p_title      TEXT,
  p_subtitle   TEXT   DEFAULT NULL,
  p_emoji      TEXT   DEFAULT '💬',
  p_is_public  BOOLEAN DEFAULT true
)
RETURNS SETOF chat_rooms
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_row chat_rooms;
BEGIN
  INSERT INTO chat_rooms (venue_id, resource_id, room_type, title, subtitle, emoji, is_public)
  VALUES (p_venue_id, p_resource_id, p_room_type, p_title, p_subtitle, p_emoji, p_is_public)
  ON CONFLICT (resource_id)
    WHERE resource_id IS NOT NULL
  DO UPDATE SET updated_at = now()
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_resource_chat_room(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
