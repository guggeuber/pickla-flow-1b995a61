-- Pickla Score v2: multiplayer walk-ins and basic dart rules/settings.

ALTER TABLE public.score_sessions
  DROP CONSTRAINT IF EXISTS score_sessions_game_check;

ALTER TABLE public.score_sessions
  ADD CONSTRAINT score_sessions_game_check
  CHECK (game_type IN ('301', '501', '701'));

ALTER TABLE public.score_matches
  DROP CONSTRAINT IF EXISTS score_matches_game_check,
  DROP CONSTRAINT IF EXISTS score_matches_current_player_check,
  DROP CONSTRAINT IF EXISTS score_matches_starting_player_check,
  DROP CONSTRAINT IF EXISTS score_matches_leg_starting_player_check;

ALTER TABLE public.score_matches
  ADD COLUMN IF NOT EXISTS target_score INTEGER NOT NULL DEFAULT 501,
  ADD COLUMN IF NOT EXISTS checkout_rule TEXT NOT NULL DEFAULT 'double_out',
  ADD COLUMN IF NOT EXISTS in_rule TEXT NOT NULL DEFAULT 'straight_in',
  ADD COLUMN IF NOT EXISTS player_slots JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.score_matches
  ADD CONSTRAINT score_matches_game_check
  CHECK (game_type IN ('301', '501', '701')),
  ADD CONSTRAINT score_matches_current_player_check
  CHECK (current_player BETWEEN 1 AND 8),
  ADD CONSTRAINT score_matches_starting_player_check
  CHECK (starting_player BETWEEN 1 AND 8),
  ADD CONSTRAINT score_matches_leg_starting_player_check
  CHECK (leg_starting_player BETWEEN 1 AND 8),
  ADD CONSTRAINT score_matches_target_score_check
  CHECK (target_score IN (301, 501, 701)),
  ADD CONSTRAINT score_matches_checkout_rule_check
  CHECK (checkout_rule IN ('single_out', 'double_out')),
  ADD CONSTRAINT score_matches_in_rule_check
  CHECK (in_rule IN ('straight_in', 'double_in'));

ALTER TABLE public.score_turns
  DROP CONSTRAINT IF EXISTS score_turns_player_number_check;

ALTER TABLE public.score_turns
  ADD CONSTRAINT score_turns_player_number_check
  CHECK (player_number BETWEEN 1 AND 8);
