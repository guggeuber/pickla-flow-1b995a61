import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEAGUE_V1_TRADITIONAL_SCORING_CODE,
  usesTraditionalLeagueV1Scoring,
} from "@/lib/leagueRules";

const migration = readFileSync(
  "supabase/migrations/20260827126000_league_traditional_sideout_scoring.sql",
  "utf8",
);
const originalDomain = readFileSync("supabase/migrations/20260827120000_league_v1_domain.sql", "utf8");
const playSql = readFileSync("supabase/migrations/20260827122000_league_v1_play.sql", "utf8");
const leaguePage = readFileSync("src/pages/LeaguePage.tsx", "utf8");
const adminLeague = readFileSync("src/components/admin/AdminLeague.tsx", "utf8");
const operations = readFileSync("src/components/admin/LeagueOperationsPanel.tsx", "utf8");

describe("League V1 traditional side-out scoring migration", () => {
  it("keeps applied history immutable and introduces one additive migration", () => {
    expect(originalDomain).toContain("DEFAULT 'rally_three_sets_11_cap_13'");
    expect(originalDomain).toContain("scoring_version INTEGER NOT NULL DEFAULT 1");
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
    expect(migration).toContain("LOCK TABLE public.league_fixture_results IN SHARE ROW EXCLUSIVE MODE");
  });

  it("accepts exactly the legacy rally-v1 and traditional-v2 scoring pairs", () => {
    expect(migration).toContain("(scoring_code = 'rally_three_sets_11_cap_13' AND scoring_version = 1)");
    expect(migration).toContain("scoring_code = 'traditional_sideout_three_games_11_cap_13'");
    expect(migration).toContain("AND scoring_version = 2");
    expect(migration).not.toContain("scoring_code IN");
    expect(LEAGUE_V1_TRADITIONAL_SCORING_CODE).toBe("traditional_sideout_three_games_11_cap_13");
  });

  it("targets only the reviewed production season in the guarded data update", () => {
    const update = migration.slice(
      migration.indexOf("UPDATE public.league_seasons"),
      migration.indexOf("GET DIAGNOSTICS v_updated"),
    );
    expect(update).toContain("WHERE id = v_target_season_id");
    expect(update).toContain("AND scoring_code = 'rally_three_sets_11_cap_13'");
    expect(update).toContain("AND scoring_version = 1");
    expect(update).toContain("WHERE fixture.league_season_id = v_target_season_id");
    expect(update).not.toMatch(/name|title|activity_series_id/);
    expect(migration).toContain("'ffc55d2d-84c8-4504-8b51-694281537770'");
    expect(migration.match(/UPDATE public\.league_seasons/g)).toHaveLength(1);
  });

  it("fails closed for a missing, changed or historically scored production target", () => {
    expect(migration).toContain("league_traditional_scoring_target_missing");
    expect(migration).toContain("league_traditional_scoring_target_state_changed");
    expect(migration).toContain("league_traditional_scoring_result_history_exists");
    expect(migration).toContain("league_traditional_scoring_target_update_failed");
    expect(migration).toContain("league_scoring_history_exists");
    expect(migration).toContain("BEFORE UPDATE OF scoring_code, scoring_version");
  });

  it("makes the database default authoritative for every future canonical creation", () => {
    expect(migration).toContain("ALTER COLUMN scoring_code SET DEFAULT 'traditional_sideout_three_games_11_cap_13'");
    expect(migration).toContain("ALTER COLUMN scoring_version SET DEFAULT 2");
    const createInsert = playSql.slice(
      playSql.indexOf("INSERT INTO public.league_seasons"),
      playSql.indexOf("RETURNING * INTO v_season"),
    );
    expect(createInsert).not.toContain("scoring_code");
    expect(createInsert).not.toContain("scoring_version");
  });

  it("leaves final-score, exactly-three-game, standings and fingerprint behavior unchanged", () => {
    expect(playSql).toContain("GREATEST(p_a, p_b) = 13 AND LEAST(p_a, p_b) IN (11, 12)");
    expect(playSql).toContain("p_state = 'final' AND jsonb_array_length(p_sets) <> 3");
    expect(playSql).toContain("ELSE metrics.a_sets END::BIGINT league_points");
    expect(playSql).toContain("md5(string_agg(id::TEXT, ',' ORDER BY created_at, id))");
    expect(playSql).not.toMatch(/scoring_code.*generated_team_fingerprint|generated_team_fingerprint.*scoring_code/s);
  });
});

describe("League V1 traditional side-out presentation", () => {
  it("uses actual scoring metadata for truthful customer and Catalog copy", () => {
    expect(usesTraditionalLeagueV1Scoring("rally_three_sets_11_cap_13")).toBe(false);
    expect(usesTraditionalLeagueV1Scoring(LEAGUE_V1_TRADITIONAL_SCORING_CODE)).toBe(true);
    expect(leaguePage).toContain("Traditionell side-out-scoring: endast servande lag kan ta poäng");
    expect(leaguePage).toContain("Varje vunnet game ger en tabellpoäng");
    expect(leaguePage).toContain("Game +/-");
    expect(adminLeague).toContain("3 game · traditionell side-out");
    expect(adminLeague).not.toContain("scoring-mode");
  });

  it("changes result-entry terminology while preserving the legacy storage contract", () => {
    expect(operations).toContain("GAME {index + 1}");
    expect(operations).toContain("`Game ${index + 1} ${teamA?.team_name}`");
    expect(operations).toContain("Tre fulla game krävs för final");
    expect(operations).toContain("sets: walkoverWinner ? []");
    expect(operations).not.toContain("serve_sequence");
    expect(migration).not.toContain("serve_sequence");
  });
});
