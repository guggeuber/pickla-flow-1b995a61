export type PublicLeagueDisplayPrice = {
  currentPriceMinor: number;
  pricingReason: string;
};

/**
 * Chooses the already-computed public League display price. This is presentation
 * logic only: registration still reserves capacity and prices transactionally in
 * reserve_league_team_registration.
 */
export function resolvePublicLeagueDisplayPrice({
  regularPriceMinor,
  regularPriceReason,
  scarcityMode,
  earlyBirdPriceMinor,
  earlyBirdRemaining,
}: {
  regularPriceMinor: number;
  regularPriceReason: string;
  scarcityMode?: string | null;
  earlyBirdPriceMinor?: number | null;
  earlyBirdRemaining?: number | null;
}): PublicLeagueDisplayPrice {
  const regular = Math.max(0, Math.round(Number(regularPriceMinor || 0)));
  const earlyBird = Math.max(0, Math.round(Number(earlyBirdPriceMinor || 0)));
  const earlyBirdWins = scarcityMode === 'early_bird'
    && Number(earlyBirdRemaining || 0) > 0
    && earlyBird > 0
    && earlyBird < regular;
  return {
    currentPriceMinor: earlyBirdWins ? earlyBird : regular,
    pricingReason: earlyBirdWins ? 'early_bird' : regularPriceReason,
  };
}
