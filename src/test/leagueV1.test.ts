import { describe, expect, it } from "vitest";
import {
  buildLeagueV1Schedule,
  isValidLeagueV1GameScore,
  isValidLeagueV1SetScore,
  validateLeagueV1Schedule,
} from "@/lib/leagueRules";

describe("Pickla League V1 schedule", () => {
  const teams = ["A", "B", "C", "D", "E", "F"];
  const schedule = buildLeagueV1Schedule(teams);

  it("creates the complete deterministic K6 double round robin", () => {
    expect(schedule).toHaveLength(30);
    expect(buildLeagueV1Schedule(teams)).toEqual(schedule);
    expect(validateLeagueV1Schedule(schedule)).toEqual({ valid: true, errors: [] });
  });

  it("gives every team one match per block and two per Thursday", () => {
    for (let round = 1; round <= 5; round += 1) {
      for (let block = 1; block <= 2; block += 1) {
        const appearances = schedule
          .filter((slot) => slot.round === round && slot.block === block)
          .flatMap((slot) => [slot.teamA, slot.teamB]);
        expect(appearances.sort()).toEqual([...teams].sort());
      }
    }
  });

  it("meets every opponent twice, never twice on one night, with maximally spread returns", () => {
    const pairRounds = new Map<string, number[]>();
    for (const slot of schedule) {
      const pair = [slot.teamA, slot.teamB].sort().join(":");
      pairRounds.set(pair, [...(pairRounds.get(pair) || []), slot.round]);
    }
    expect(pairRounds.size).toBe(15);
    for (const rounds of pairRounds.values()) {
      expect(rounds).toHaveLength(2);
      expect(rounds[0]).not.toBe(rounds[1]);
      expect(rounds[1] - rounds[0]).toBeGreaterThanOrEqual(2);
    }
  });

  it("rejects any shape except six unique teams", () => {
    expect(() => buildLeagueV1Schedule(teams.slice(0, 5))).toThrow(/six unique teams/i);
    expect(() => buildLeagueV1Schedule(["A", "B", "C", "D", "E", "E"])).toThrow(/six unique teams/i);
  });
});

describe("Pickla League V1 traditional side-out final game scores", () => {
  it.each([
    [11, 0, true],
    [10, 9, false],
    [10, 10, false],
    [11, 9, true],
    [11, 10, false],
    [11, 11, false],
    [12, 10, true],
    [12, 11, false],
    [12, 12, false],
    [13, 11, true],
    [13, 12, true],
    [13, 13, false],
    [14, 12, false],
    [14, 13, false],
  ])("validates boundary %i–%i as %s", (a, b, expected) => {
    expect(isValidLeagueV1GameScore(a, b)).toBe(expected);
    expect(isValidLeagueV1SetScore(a, b)).toBe(expected);
  });

  it("rejects negative and decimal scores symmetrically", () => {
    expect(isValidLeagueV1SetScore(-1, 11)).toBe(false);
    expect(isValidLeagueV1SetScore(11, -1)).toBe(false);
    expect(isValidLeagueV1SetScore(11.5, 9)).toBe(false);
    expect(isValidLeagueV1SetScore(9, 11.5)).toBe(false);
  });
});
