-- Open booking slots v1
-- Stores owner-controlled publication state on booking rows.
-- Booking rows still own resource/time; booking_participants remain the Play Right layer.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS open_for_more_status text NOT NULL DEFAULT 'closed'
    CHECK (open_for_more_status IN ('closed', 'open')),
  ADD COLUMN IF NOT EXISTS open_for_more_total_players integer
    CHECK (open_for_more_total_players IN (2, 4)),
  ADD COLUMN IF NOT EXISTS open_for_more_pace text
    CHECK (open_for_more_pace IN ('all_levels', 'newer_players', 'experienced_players', 'high_tempo')),
  ADD COLUMN IF NOT EXISTS open_for_more_note text,
  ADD COLUMN IF NOT EXISTS open_for_more_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS open_for_more_closed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bookings_open_for_more
  ON public.bookings (venue_id, start_time)
  WHERE open_for_more_status = 'open';

-- Reminder after manual SQL editor execution:
-- NOTIFY pgrst, 'reload schema';
