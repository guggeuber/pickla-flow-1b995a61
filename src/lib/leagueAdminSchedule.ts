import { DateTime } from "luxon";

export const EMPTY_LEAGUE_NIGHT_DATES = ["", "", "", "", ""] as const;

export type LeagueNightDateState = {
  dates: string[];
  overriddenIndexes: number[];
};

export function proposeLeagueNightDates(firstNight: string) {
  if (!firstNight) return [...EMPTY_LEAGUE_NIGHT_DATES];
  const first = DateTime.fromISO(firstNight, { zone: "Europe/Stockholm" });
  if (!first.isValid) return [firstNight, "", "", "", ""];
  return Array.from({ length: 5 }, (_, offset) => first.plus({ weeks: offset }).toISODate()!);
}

export function changeLeagueNightDate(state: LeagueNightDateState, index: number, value: string): LeagueNightDateState {
  if (index < 0 || index > 4) return state;
  const overrides = new Set(state.overriddenIndexes);

  if (index === 0) {
    const proposal = proposeLeagueNightDates(value);
    return {
      dates: proposal.map((date, dateIndex) => dateIndex > 0 && overrides.has(dateIndex) ? state.dates[dateIndex] : date),
      overriddenIndexes: [...overrides].sort(),
    };
  }

  const proposal = proposeLeagueNightDates(state.dates[0] || "");
  if (value === proposal[index]) overrides.delete(index);
  else overrides.add(index);
  return {
    dates: state.dates.map((date, dateIndex) => dateIndex === index ? value : date),
    overriddenIndexes: [...overrides].sort(),
  };
}

export function resetLeagueNightDates(state: LeagueNightDateState): LeagueNightDateState {
  return { dates: proposeLeagueNightDates(state.dates[0] || ""), overriddenIndexes: [] };
}
