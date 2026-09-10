import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  canListPublicCorporateAccount,
  canResolvePublicCorporateAccount,
  deriveCorporateParticipation,
  normalizeCorporateSlug,
  normalizeExternalBookingLabel,
  normalizeExternalBookingUrl,
} from './corporate.ts';

Deno.test('corporate slug and public visibility semantics are canonical', () => {
  assertEquals(normalizeCorporateSlug('  Ericsson-SE  '), 'ericsson-se');
  assertThrows(() => normalizeCorporateSlug('Ericsson SE'));

  assertEquals(canResolvePublicCorporateAccount({ is_active: true, public_visibility: 'private', slug: 'ericsson' }), false);
  assertEquals(canResolvePublicCorporateAccount({ is_active: true, public_visibility: 'unlisted', slug: 'ericsson' }), true);
  assertEquals(canListPublicCorporateAccount({ is_active: true, public_visibility: 'unlisted', slug: 'ericsson' }), false);
  assertEquals(canListPublicCorporateAccount({ is_active: true, public_visibility: 'listed', slug: 'ericsson' }), true);
  assertEquals(canResolvePublicCorporateAccount({ is_active: false, public_visibility: 'listed', slug: 'ericsson' }), false);
});

Deno.test('external booking URL accepts only normalized HTTPS without credentials', () => {
  assertEquals(normalizeExternalBookingUrl('  https://book.example.test/path  '), 'https://book.example.test/path');
  assertEquals(normalizeExternalBookingUrl(' '), null);
  assertThrows(() => normalizeExternalBookingUrl('http://book.example.test'));
  assertThrows(() => normalizeExternalBookingUrl('javascript:alert(1)'));
  assertThrows(() => normalizeExternalBookingUrl('data:text/plain,no'));
  assertThrows(() => normalizeExternalBookingUrl('https://user:secret@book.example.test'));
  assertEquals(normalizeExternalBookingLabel('  Boka via ESIK  '), 'Boka via ESIK');
  assertEquals(normalizeExternalBookingLabel(''), null);
});

Deno.test('Phase 1 participation derivation never reports Pickla ready', () => {
  assertEquals(deriveCorporateParticipation({ participation_management_mode: 'unconfigured' }).state, 'not_configured');
  assertEquals(deriveCorporateParticipation({ participation_management_mode: 'external', company_name: 'Ericsson', purchaser_name: 'ESIK' }), {
    mode: 'external',
    state: 'external_pending',
    message: 'Deltagandet hanteras av Ericsson/ESIK. Mer bokningsinformation kommer snart.',
    cta: null,
  });
  assertEquals(deriveCorporateParticipation({ participation_management_mode: 'external', external_booking_url: 'https://book.example.test' }), {
    mode: 'external',
    state: 'external_ready',
    message: null,
    cta: { label: 'Gå till bokning', url: 'https://book.example.test/' },
  });
  assertEquals(deriveCorporateParticipation({ participation_management_mode: 'external', external_booking_url: 'https://book.example.test', external_booking_label: 'Boka via ESIK' }).cta?.label, 'Boka via ESIK');
  assertEquals(deriveCorporateParticipation({ participation_management_mode: 'external', external_booking_url: '' }).state, 'external_pending');
  assertEquals(deriveCorporateParticipation({ participation_management_mode: 'external', external_booking_url: 'not-a-url' }).cta, null);
  assertEquals(deriveCorporateParticipation({ participation_management_mode: 'pickla' }).state, 'pickla_pending');

  for (const mode of ['unconfigured', 'external', 'pickla']) {
    const state = deriveCorporateParticipation({ participation_management_mode: mode }).state;
    assertEquals(state === 'pickla_ready', false);
  }
});
