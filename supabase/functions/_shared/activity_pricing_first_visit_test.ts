import { assertEquals } from 'jsr:@std/assert@1';
import { activityCustomerPricePresentation, firstVisitOfferDecision } from './activity_pricing.ts';

Deno.test('first-visit price applies only to a new paying participant', () => {
  assertEquals(firstVisitOfferDecision({ enabled: true, priceMinor: 9900, priorCommittedParticipation: false, completedRedemption: false, activeReservation: false, currentAmountSek: 165 }), {
    applies: true,
    priceSek: 99,
    regularPriceSek: 165,
    reason: 'eligible',
  });
});

Deno.test('returning customer never receives or sees the first-visit offer', () => {
  assertEquals(firstVisitOfferDecision({ enabled: true, priceMinor: 9900, priorCommittedParticipation: true, completedRedemption: false, activeReservation: false, currentAmountSek: 165 }).applies, false);
  assertEquals(firstVisitOfferDecision({ enabled: true, priceMinor: 9900, priorCommittedParticipation: true, completedRedemption: false, activeReservation: false, currentAmountSek: 165 }).reason, 'prior_committed_activity_participation');
});

Deno.test('canonical lower entitlement/member price keeps precedence', () => {
  const decision = firstVisitOfferDecision({ enabled: true, priceMinor: 9900, priorCommittedParticipation: false, completedRedemption: false, activeReservation: false, currentAmountSek: 0 });
  assertEquals(decision.applies, false);
  assertEquals(decision.reason, 'existing_price_not_higher');
});

Deno.test('an active reservation hides the offer before another participation commits', () => {
  const decision = firstVisitOfferDecision({ enabled: true, priceMinor: 9900, priorCommittedParticipation: false, completedRedemption: false, activeReservation: true, currentAmountSek: 165 });
  assertEquals(decision.applies, false);
  assertEquals(decision.reason, 'active_first_visit_reservation');
});

Deno.test('a completed redemption remains consumed independently of attendance', () => {
  const decision = firstVisitOfferDecision({ enabled: true, priceMinor: 9900, priorCommittedParticipation: false, completedRedemption: true, activeReservation: false, currentAmountSek: 165 });
  assertEquals(decision.applies, false);
  assertEquals(decision.reason, 'completed_first_visit_redemption');
});

Deno.test('anonymous discovery keeps list price truth and conditional offer copy', () => {
  assertEquals(activityCustomerPricePresentation({
    identifiedCustomer: false,
    finalAmountSek: 99,
    baseAmountSek: 165,
    checkoutLabel: '99 kr',
    firstVisitApplied: true,
    firstVisitPriceSek: 99,
    firstVisitRegularPriceSek: 165,
  }), {
    identityState: 'anonymous',
    displayPriceSek: 165,
    displayLabel: '165 kr',
    listPriceSek: 165,
    offerState: 'conditional',
    offerLabel: 'Första gången? 99 kr',
    offerDetail: 'Första gången? Spela för 99 kr.',
  });
});

Deno.test('identified eligible customer sees one resolved 99 SEK price everywhere', () => {
  const presentation = activityCustomerPricePresentation({
    identifiedCustomer: true,
    finalAmountSek: 99,
    baseAmountSek: 165,
    checkoutLabel: '99 kr',
    firstVisitApplied: true,
    firstVisitPriceSek: 99,
    firstVisitRegularPriceSek: 165,
  });
  assertEquals(presentation.displayPriceSek, 99);
  assertEquals(presentation.displayLabel, '99 kr');
  assertEquals(presentation.offerState, 'eligible');
  assertEquals(presentation.offerLabel, 'Prova-på · 99 kr');
});

Deno.test('returning and included customers receive no first-visit promotion', () => {
  assertEquals(activityCustomerPricePresentation({
    identifiedCustomer: true,
    finalAmountSek: 165,
    baseAmountSek: 165,
    checkoutLabel: '165 kr',
    firstVisitApplied: false,
    firstVisitPriceSek: 99,
    firstVisitRegularPriceSek: 165,
  }).offerState, null);
  assertEquals(activityCustomerPricePresentation({
    identifiedCustomer: true,
    finalAmountSek: 0,
    baseAmountSek: 165,
    checkoutLabel: 'Ingår',
    firstVisitApplied: false,
    firstVisitPriceSek: 99,
    firstVisitRegularPriceSek: 0,
  }).displayLabel, 'Ingår');
});
