-- League V1 scoring doctrine: traditional side-out scoring, always three games.
--
-- Result rows continue to store final game scores in the legacy `sets` JSONB
-- field. Final-score validation, standings, fixtures, scheduling and Commerce
-- are intentionally unchanged.

BEGIN;

-- Prevent a result from being inserted while the production season predicate
-- is checked and changed. The exact season row lock is held to COMMIT as well.
LOCK TABLE public.league_fixture_results IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_target_season_id CONSTANT UUID := 'ffc55d2d-84c8-4504-8b51-694281537770';
  v_target public.league_seasons%ROWTYPE;
BEGIN
  SELECT * INTO v_target
  FROM public.league_seasons
  WHERE id = v_target_season_id
  FOR UPDATE;

  -- A fresh database has no production data to migrate. In every populated
  -- League environment, the exact reviewed production target must exist.
  IF v_target.id IS NULL AND NOT EXISTS (SELECT 1 FROM public.league_seasons) THEN
    RETURN;
  END IF;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'league_traditional_scoring_target_missing';
  END IF;
  IF v_target.scoring_code IS DISTINCT FROM 'rally_three_sets_11_cap_13'
     OR v_target.scoring_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'league_traditional_scoring_target_state_changed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.league_fixtures fixture
    JOIN public.league_fixture_results result ON result.fixture_id = fixture.id
    WHERE fixture.league_season_id = v_target_season_id
  ) THEN
    RAISE EXCEPTION 'league_traditional_scoring_result_history_exists';
  END IF;
END;
$$;

ALTER TABLE public.league_seasons
  DROP CONSTRAINT league_seasons_locked_v1_shape,
  ADD CONSTRAINT league_seasons_locked_v1_shape CHECK (
    team_capacity = 6
    AND players_per_team = 2
    AND league_night_count = 5
    AND matches_per_team_per_night = 2
    AND blocks_per_night = 2
    AND match_duration_minutes = 50
    AND block_start_offsets_minutes = ARRAY[0, 60]
    AND (
      (scoring_code = 'rally_three_sets_11_cap_13' AND scoring_version = 1)
      OR (
        scoring_code = 'traditional_sideout_three_games_11_cap_13'
        AND scoring_version = 2
      )
    )
    AND schedule_version = 1
  );

ALTER TABLE public.league_seasons
  ALTER COLUMN scoring_code SET DEFAULT 'traditional_sideout_three_games_11_cap_13',
  ALTER COLUMN scoring_version SET DEFAULT 2;

CREATE OR REPLACE FUNCTION public.guard_league_scoring_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.scoring_code, NEW.scoring_version)
       IS DISTINCT FROM (OLD.scoring_code, OLD.scoring_version)
     AND EXISTS (
       SELECT 1
       FROM public.league_fixtures fixture
       JOIN public.league_fixture_results result ON result.fixture_id = fixture.id
       WHERE fixture.league_season_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'league_scoring_history_exists';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_league_scoring_history()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_league_scoring_history ON public.league_seasons;
CREATE TRIGGER trg_guard_league_scoring_history
BEFORE UPDATE OF scoring_code, scoring_version ON public.league_seasons
FOR EACH ROW EXECUTE FUNCTION public.guard_league_scoring_history();

DO $$
DECLARE
  v_target_season_id CONSTANT UUID := 'ffc55d2d-84c8-4504-8b51-694281537770';
  v_updated INTEGER;
BEGIN
  -- Fresh/bootstrap databases intentionally have no production row to update.
  IF NOT EXISTS (SELECT 1 FROM public.league_seasons) THEN
    RETURN;
  END IF;

  UPDATE public.league_seasons
  SET scoring_code = 'traditional_sideout_three_games_11_cap_13',
      scoring_version = 2
  WHERE id = v_target_season_id
    AND scoring_code = 'rally_three_sets_11_cap_13'
    AND scoring_version = 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.league_fixtures fixture
      JOIN public.league_fixture_results result ON result.fixture_id = fixture.id
      WHERE fixture.league_season_id = v_target_season_id
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'league_traditional_scoring_target_update_failed';
  END IF;
END;
$$;

COMMENT ON COLUMN public.league_seasons.scoring_code IS
  'Versioned League scoring doctrine. League V1 uses traditional side-out v2; rally v1 remains valid only for legacy compatibility.';

COMMIT;
