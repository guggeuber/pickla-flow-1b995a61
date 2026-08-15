import { assertEquals } from 'jsr:@std/assert@1';
import { firstVisitOfferDecision } from './activity_pricing.ts';

Deno.test('first-visit price applies only to a new paying participant', () => {
  assertEquals(firstVisitOfferDecision({ enabled: true, priceMinor: 9900, priorPaidParticipation: false, currentAmountSek: 165 }), {
    applies: true,
    priceSek: 99,
    regularPriceSek: 165,
    reason: 'eligible',
  });
});

Deno.test('returning customer never receives or sees the first-visit offer', () => {
  assertEquals(firstVisitOfferDecision({ enabled: true, priceMinor: 9900, priorPaidParticipation: true, currentAmountSek: 165 }).applies, false);
  assertEquals(firstVisitOfferDecision({ enabled: true, priceMinor: 9900, priorPaidParticipation: true, currentAmountSek: 165 }).reason, 'prior_paid_participation');
});

Deno.test('canonical lower entitlement/member price keeps precedence', () => {
  const decision = firstVisitOfferDecision({ enabled: true, priceMinor: 9900, priorPaidParticipation: false, currentAmountSek: 0 });
  assertEquals(decision.applies, false);
  assertEquals(decision.reason, 'existing_price_not_higher');
});
