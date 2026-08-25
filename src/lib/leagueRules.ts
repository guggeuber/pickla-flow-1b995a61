export const LEAGUE_V1_FACTORS = [
  [[0, 5], [1, 4], [2, 3]],
  [[0, 4], [5, 3], [1, 2]],
  [[0, 3], [4, 2], [5, 1]],
  [[0, 2], [3, 1], [4, 5]],
  [[0, 1], [2, 5], [3, 4]],
] as const;

// Every factor appears twice. The repeat distances are 3, 2, 3, 2 and 2
// weeks, which is maximal for the two-factor-per-night five-night shape.
export const LEAGUE_V1_WEEK_FACTORS = [[0, 4], [1, 2], [3, 4], [0, 1], [2, 3]] as const;

export type LeagueScheduleSlot = {
  round: number;
  block: number;
  courtIndex: number;
  teamA: string;
  teamB: string;
  leg: 1 | 2;
};

export function buildLeagueV1Schedule(teamIds: readonly string[]): LeagueScheduleSlot[] {
  if (teamIds.length !== 6 || new Set(teamIds).size !== 6) {
    throw new Error("League V1 requires exactly six unique teams");
  }
  const pairLeg = new Map<string, number>();
  return LEAGUE_V1_WEEK_FACTORS.flatMap((factors, roundIndex) => factors.flatMap((factorIndex, blockIndex) => (
    LEAGUE_V1_FACTORS[factorIndex].map(([left, right], pairIndex) => {
      const teamA = teamIds[left];
      const teamB = teamIds[right];
      const pairKey = [teamA, teamB].sort().join(":");
      const leg = (pairLeg.get(pairKey) || 0) + 1;
      pairLeg.set(pairKey, leg);
      return {
        round: roundIndex + 1,
        block: blockIndex + 1,
        courtIndex: (pairIndex + roundIndex + blockIndex) % 3,
        teamA,
        teamB,
        leg: leg as 1 | 2,
      };
    })
  )));
}

export function validateLeagueV1Schedule(slots: readonly LeagueScheduleSlot[]) {
  const errors: string[] = [];
  if (slots.length !== 30) errors.push("fixture_count");
  const teamCount = new Map<string, number>();
  const pairCount = new Map<string, number>();
  const pairNight = new Set<string>();
  const teamBlock = new Set<string>();
  const courtBlock = new Set<string>();
  for (const slot of slots) {
    for (const team of [slot.teamA, slot.teamB]) {
      teamCount.set(team, (teamCount.get(team) || 0) + 1);
      const key = `${slot.round}:${slot.block}:${team}`;
      if (teamBlock.has(key)) errors.push("team_double_booked");
      teamBlock.add(key);
    }
    const pair = [slot.teamA, slot.teamB].sort().join(":");
    pairCount.set(pair, (pairCount.get(pair) || 0) + 1);
    const pairNightKey = `${slot.round}:${pair}`;
    if (pairNight.has(pairNightKey)) errors.push("same_night_rematch");
    pairNight.add(pairNightKey);
    const courtKey = `${slot.round}:${slot.block}:${slot.courtIndex}`;
    if (courtBlock.has(courtKey)) errors.push("court_double_booked");
    courtBlock.add(courtKey);
  }
  if ([...teamCount.values()].some((count) => count !== 10) || teamCount.size !== 6) errors.push("team_fixture_count");
  if ([...pairCount.values()].some((count) => count !== 2) || pairCount.size !== 15) errors.push("pair_fixture_count");
  return { valid: errors.length === 0, errors };
}

export function isValidLeagueV1SetScore(teamA: number, teamB: number) {
  if (!Number.isInteger(teamA) || !Number.isInteger(teamB) || teamA < 0 || teamB < 0 || teamA === teamB) return false;
  const winner = Math.max(teamA, teamB);
  const loser = Math.min(teamA, teamB);
  return (winner === 11 && loser <= 9)
    || (winner === 12 && loser === 10)
    || (winner === 13 && (loser === 11 || loser === 12));
}
