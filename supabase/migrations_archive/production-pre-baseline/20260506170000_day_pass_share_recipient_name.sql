ALTER TABLE public.day_pass_shares
  ADD COLUMN IF NOT EXISTS recipient_name text;
