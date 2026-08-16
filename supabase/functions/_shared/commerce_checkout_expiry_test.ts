import { assertEquals } from 'jsr:@std/assert@1';
import { stripeCheckoutCanBeReleased } from './commerce_checkout_expiry.ts';

Deno.test('only authoritative unpaid Stripe expiry may release a checkout hold', () => {
  assertEquals(stripeCheckoutCanBeReleased({ status: 'expired', payment_status: 'unpaid' }), true);
  assertEquals(stripeCheckoutCanBeReleased({ status: 'expired', payment_status: 'paid' }), false);
  assertEquals(stripeCheckoutCanBeReleased({ status: 'complete', payment_status: 'paid' }), false);
  assertEquals(stripeCheckoutCanBeReleased({ status: 'open', payment_status: 'unpaid' }), false);
});
