-- Dart Score v2: flexible x01 targets, longer match formats, and double-in state.

ALTER TABLE public.score_sessions
  DROP CONSTRAINT IF EXISTS score_sessions_game_check,
  DROP CONSTRAINT IF EXISTS score_sessions_best_of_check;

ALTER TABLE public.score_sessions
  ADD CONSTRAINT score_sessions_game_check
  CHECK (game_type IN ('301', '501', '701', 'x01')),
  ADD CONSTRAINT score_sessions_best_of_check
  CHECK (best_of_legs BETWEEN 1 AND 15 AND best_of_legs % 2 = 1);

ALTER TABLE public.score_matches
  DROP CONSTRAINT IF EXISTS score_matches_game_check,
  DROP CONSTRAINT IF EXISTS score_matches_target_score_check,
  DROP CONSTRAINT IF EXISTS score_matches_best_of_check;

ALTER TABLE public.score_matches
  ADD CONSTRAINT score_matches_game_check
  CHECK (game_type IN ('301', '501', '701', 'x01')),
  ADD CONSTRAINT score_matches_target_score_check
  CHECK (target_score BETWEEN 101 AND 1001),
  ADD CONSTRAINT score_matches_best_of_check
  CHECK (best_of_legs BETWEEN 1 AND 15 AND best_of_legs % 2 = 1);

ALTER TABLE public.score_turns
  ADD COLUMN IF NOT EXISTS entered_score INTEGER,
  ADD COLUMN IF NOT EXISTS in_opened BOOLEAN NOT NULL DEFAULT false;

UPDATE public.score_turns
SET entered_score = score
WHERE entered_score IS NULL;

ALTER TABLE public.score_turns
  ALTER COLUMN entered_score SET DEFAULT 0,
  ADD CONSTRAINT score_turns_entered_score_check
  CHECK (entered_score BETWEEN 0 AND 180);
