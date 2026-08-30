import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolvePublicLeagueDisplayPrice } from './public_league_pricing.ts';

Deno.test('public League display pricing preserves base and Early Bird precedence', () => {
  const input = { regularPriceMinor: 240000, regularPriceReason: 'league_team_base_price' };
  assertEquals(resolvePublicLeagueDisplayPrice(input), {
    currentPriceMinor: 240000,
    pricingReason: 'league_team_base_price',
  });
  assertEquals(resolvePublicLeagueDisplayPrice({
    ...input,
    scarcityMode: 'early_bird',
    earlyBirdPriceMinor: 200000,
    earlyBirdRemaining: 1,
  }), { currentPriceMinor: 200000, pricingReason: 'early_bird' });
  assertEquals(resolvePublicLeagueDisplayPrice({
    ...input,
    scarcityMode: 'early_bird',
    earlyBirdPriceMinor: 200000,
    earlyBirdRemaining: 0,
  }), { currentPriceMinor: 240000, pricingReason: 'league_team_base_price' });
  assertEquals(resolvePublicLeagueDisplayPrice({
    ...input,
    scarcityMode: 'early_bird',
    earlyBirdPriceMinor: 240000,
    earlyBirdRemaining: 2,
  }), { currentPriceMinor: 240000, pricingReason: 'league_team_base_price' });
});
