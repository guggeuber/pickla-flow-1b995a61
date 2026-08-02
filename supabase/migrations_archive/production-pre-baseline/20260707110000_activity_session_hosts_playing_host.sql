-- Clarify that activity hosts are playing community hosts, not staff/coaches.
-- This keeps host assignment separate from paid registrations while allowing
-- host registrations/check-ins to be tracked as operational attendance.

ALTER TABLE public.activity_session_hosts
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'playing_host';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activity_session_hosts_role_check'
      AND conrelid = 'public.activity_session_hosts'::regclass
  ) THEN
    ALTER TABLE public.activity_session_hosts
      ADD CONSTRAINT activity_session_hosts_role_check
      CHECK (role = 'playing_host');
  END IF;
END $$;

UPDATE public.activity_session_hosts
SET role = 'playing_host'
WHERE role IS DISTINCT FROM 'playing_host';

CREATE INDEX IF NOT EXISTS idx_activity_session_hosts_role_active
  ON public.activity_session_hosts (role, activity_session_id, sort_order)
  WHERE status = 'active';

-- Reminder after manual SQL editor execution:
-- NOTIFY pgrst, 'reload schema';
