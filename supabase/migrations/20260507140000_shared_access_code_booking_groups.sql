-- Multi-court bookings are one customer booking and should share one check-in code.
-- Keep one row per court for occupancy, but allow the same access_code on those rows.
DROP INDEX IF EXISTS public.idx_bookings_venue_access_code_day;
DROP INDEX IF EXISTS idx_bookings_venue_access_code_day;

WITH first_codes AS (
  SELECT stripe_session_id, MIN(access_code) AS access_code
  FROM public.bookings
  WHERE stripe_session_id IS NOT NULL
    AND access_code IS NOT NULL
  GROUP BY stripe_session_id
)
UPDATE public.bookings b
SET access_code = fc.access_code
FROM first_codes fc
WHERE b.stripe_session_id = fc.stripe_session_id
  AND b.access_code IS DISTINCT FROM fc.access_code;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_venue_access_code_day_court
  ON public.bookings (venue_id, access_code, DATE(start_time AT TIME ZONE 'UTC'), venue_court_id)
  WHERE access_code IS NOT NULL;

-- Let existing booking chat rooms refresh title/subtitle when opened again.
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
  DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    emoji = EXCLUDED.emoji,
    is_public = EXCLUDED.is_public,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_resource_chat_room(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
