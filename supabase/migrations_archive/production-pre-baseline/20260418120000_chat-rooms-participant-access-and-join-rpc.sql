-- 1. Extend chat_rooms SELECT to include rooms where the user is already a participant.
--    chat_participants RLS no longer references chat_rooms, so no circular dependency.
DROP POLICY IF EXISTS "chat_rooms_select" ON chat_rooms;

CREATE POLICY "chat_rooms_select"
  ON chat_rooms FOR SELECT TO authenticated
  USING (
    is_public = true
    OR (
      room_type = 'booking'
      AND resource_id IS NOT NULL
      AND resource_id IN (
        SELECT booking_ref FROM bookings WHERE user_id = auth.uid()
      )
    )
    OR id IN (
      SELECT room_id FROM chat_participants WHERE user_id = auth.uid()
    )
  );

-- 2. RPC: join a room by ID and return it.
--    SECURITY DEFINER so it can insert into chat_participants and read the room
--    regardless of the caller's current RLS access (needed on first join via invite link).
CREATE OR REPLACE FUNCTION join_chat_room(p_room_id UUID)
RETURNS SETOF chat_rooms
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO chat_participants (room_id, user_id)
  VALUES (p_room_id, auth.uid())
  ON CONFLICT (room_id, user_id) DO NOTHING;

  RETURN QUERY SELECT * FROM chat_rooms WHERE id = p_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION join_chat_room(UUID) TO authenticated;
