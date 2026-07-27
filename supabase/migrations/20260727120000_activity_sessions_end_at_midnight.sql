-- An activity session belongs to one operational venue date. 00:00 as the
-- end time means midnight at the end of that date, not minute zero at its start.
BEGIN;

ALTER TABLE public.activity_sessions
  DROP CONSTRAINT IF EXISTS activity_sessions_time_order;

ALTER TABLE public.activity_sessions
  ADD CONSTRAINT activity_sessions_time_order CHECK (
    end_time > start_time
    OR (
      end_time = TIME '00:00:00'
      AND start_time > TIME '00:00:00'
    )
  ) NOT VALID;

ALTER TABLE public.activity_sessions
  VALIDATE CONSTRAINT activity_sessions_time_order;

COMMENT ON CONSTRAINT activity_sessions_time_order ON public.activity_sessions IS
  'Same-day sessions require end_time > start_time; 00:00 is allowed only as midnight ending the operational date.';

COMMIT;
