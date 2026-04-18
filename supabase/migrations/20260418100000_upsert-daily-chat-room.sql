-- RPC: upsert_daily_chat_room
-- PostgREST cannot use partial unique indexes in ON CONFLICT, so we use a
-- server-side function that does the INSERT … ON CONFLICT DO UPDATE directly.

CREATE OR REPLACE FUNCTION upsert_daily_chat_room(
  p_venue_id   UUID,
  p_session_date DATE,
  p_name       TEXT DEFAULT 'Pickla Idag'
)
RETURNS SETOF chat_rooms
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_row chat_rooms;
BEGIN
  INSERT INTO chat_rooms (venue_id, room_type, title, subtitle, emoji, is_public, session_date)
  VALUES (
    p_venue_id,
    'daily',
    p_name,
    'Öppen kanal · alla välkomna',
    '📅',
    true,
    p_session_date
  )
  ON CONFLICT (venue_id, session_date)
    WHERE room_type = 'daily' AND session_date IS NOT NULL
  DO UPDATE SET updated_at = now()
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$;

-- Allow authenticated users to call this function
GRANT EXECUTE ON FUNCTION upsert_daily_chat_room(UUID, DATE, TEXT) TO authenticated;
