-- Lean membership data: structured operational name fields.
-- `display_name` remains the public/social name. These nullable fields are
-- required by membership/staff flows, but existing accounts keep working.

ALTER TABLE public.player_profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

CREATE INDEX IF NOT EXISTS idx_player_profiles_name_search
  ON public.player_profiles (lower(first_name), lower(last_name));

NOTIFY pgrst, 'reload schema';
