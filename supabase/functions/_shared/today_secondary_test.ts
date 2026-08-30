import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { loadPublicTodaySecondary } from './today_secondary.ts';

const VENUE_ID = '00000000-0000-4000-8000-000000000001';

function activityFact(index: number, overrides: Record<string, unknown> = {}) {
  const id = `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`;
  const session = {
    id,
    venue_id: VENUE_ID,
    name: `Pass ${index}`,
    session_type: 'open_play',
    session_date: '2026-08-30',
    start_time: '18:00:00',
    end_time: '20:00:00',
    capacity: 20,
    price_sek: 165,
    product_key: 'open_play_slot',
    access_policy: {},
    metadata: {},
    early_bird_price_minor: null,
    early_bird_slots: null,
    scarcity_mode: 'none',
    first_visit_offer_enabled: false,
    first_visit_price_minor: null,
    first_visit_only: true,
    ...overrides,
  };
  return {
    session,
    session_date: '2026-08-30',
    resolved_product_key: 'open_play_slot',
    product: {
      id: '00000000-0000-4000-8000-000000000090',
      venue_id: VENUE_ID,
      product_key: 'open_play_slot',
      product_kind: 'session_ticket',
      base_price_sek: 165,
      early_bird_price_minor: null,
      early_bird_slots: null,
      scarcity_mode: 'none',
    },
    capacity_fill: { fill_count: 0 },
    early_bird_fill: { fill_count: 0 },
  };
}

function courseFact(overrides: Record<string, unknown> = {}) {
  const product = {
    id: '00000000-0000-4000-8000-000000000020',
    venue_id: VENUE_ID,
    product_key: 'course_access',
    product_kind: 'series_access',
    base_price_sek: 1495,
    scarcity_mode: 'none',
    early_bird_price_minor: null,
    early_bird_slots: null,
    resolver_rules: {},
  };
  return {
    series: {
      id: '00000000-0000-4000-8000-000000000010',
      venue_id: VENUE_ID,
      access_product_id: product.id,
      name: 'Parker Brunch',
      start_date: '2026-09-20',
      capacity: 20,
    },
    format: { name: 'Brunch', description: 'Spela och umgås.', presentation_type: 'social_event' },
    artwork_url: 'https://example.test/course.jpg',
    product,
    capacity_fill: { capacity: 20, committed_count: 4, active_holds_count: 1, fill_count: 5, available_count: 15 },
    early_bird_fill: { fill_count: 0 },
    includes_open_play: false,
    ...overrides,
  };
}

function facts(activityCount = 1, overrides: Record<string, unknown> = {}) {
  return {
    input_valid: true,
    venue_found: true,
    venue_id: VENUE_ID,
    course_candidates: [courseFact()],
    league_candidate: null,
    has_configured_first_visit_offer: false,
    activity_occurrences: Array.from({ length: activityCount }, (_, index) => activityFact(index)),
    ...overrides,
  };
}

async function project(rawFacts: Record<string, unknown>) {
  let calls = 0;
  const result = await loadPublicTodaySecondary({
    rpc(name) {
      calls += 1;
      assertEquals(name, 'public_customer_today_secondary_facts');
      return Promise.resolve({ data: rawFacts, error: null });
    },
  }, {
    venueSlug: 'pickla-arena-sthlm',
    startDate: '2026-08-30',
    endDate: '2026-09-05',
    asOf: '2026-08-30T10:00:00.000Z',
  });
  return { result, calls };
}

Deno.test('Today secondary stays at one remote RPC for 1, 5 and 20 occurrences', async () => {
  for (const count of [1, 5, 20]) {
    const { result, calls } = await project(facts(count));
    assertEquals(calls, 1);
    assertEquals(result.kind, 'ok');
    if (result.kind === 'ok') assertEquals(result.data.first_visit.pricing.length, count);
  }
});

Deno.test('Today secondary preserves Course normal, Early Bird, social-event and capacity behavior', async () => {
  const regular = await project(facts(0));
  if (regular.result.kind !== 'ok') throw new Error('projection failed');
  assertEquals(regular.result.data.course.item?.format.presentation_type, 'social_event');
  assertEquals(regular.result.data.course.item?.pricing.final_price_minor, 149500);
  assertEquals(regular.result.data.course.item?.capacity.available_count, 15);

  const earlyProduct = { ...courseFact().product, scarcity_mode: 'early_bird', early_bird_price_minor: 119500, early_bird_slots: 5 };
  const early = await project(facts(0, { course_candidates: [courseFact({ product: earlyProduct, series: { ...courseFact().series, access_product_id: earlyProduct.id }, early_bird_fill: { fill_count: 2 } })] }));
  if (early.result.kind !== 'ok') throw new Error('projection failed');
  assertEquals(early.result.data.course.item?.pricing.pricing_reason, 'early_bird');
  assertEquals(early.result.data.course.item?.pricing.final_price_minor, 119500);

  const full = await project(facts(0, { course_candidates: [courseFact({ capacity_fill: { available_count: 0 } })] }));
  if (full.result.kind !== 'ok') throw new Error('projection failed');
  assertEquals(full.result.data.course, { mode: 'none', item: null });
});

Deno.test('Today secondary preserves First Visit and Early Bird precedence', async () => {
  const firstVisit = activityFact(1, {
    first_visit_offer_enabled: true,
    first_visit_price_minor: 9900,
  });
  let output = await project(facts(1, { has_configured_first_visit_offer: true, activity_occurrences: [firstVisit] }));
  if (output.result.kind !== 'ok') throw new Error('projection failed');
  assertEquals(output.result.data.first_visit.pricing[0].pricing_reason, 'first_visit_offer');
  assertEquals(output.result.data.first_visit.pricing[0].effective_price_sek, 99);
  assertEquals(output.result.data.first_visit.pricing[0].customer_presentation.displayPriceSek, 165);
  assertEquals(output.result.data.first_visit.pricing[0].customer_presentation.offerState, 'conditional');
  assertEquals(output.result.data.first_visit.items.length, 1);

  const early = activityFact(2, {
    first_visit_offer_enabled: true,
    first_visit_price_minor: 9900,
    scarcity_mode: 'early_bird',
    early_bird_price_minor: 7900,
    early_bird_slots: 2,
  });
  output = await project(facts(1, { activity_occurrences: [{ ...early, early_bird_fill: { fill_count: 0 } }] }));
  if (output.result.kind !== 'ok') throw new Error('projection failed');
  assertEquals(output.result.data.first_visit.pricing[0].pricing_reason, 'early_bird');
  assertEquals(output.result.data.first_visit.pricing[0].effective_price_sek, 79);
  assertEquals(output.result.data.first_visit.pricing[0].customer_presentation.offerState, null);

  const equal = activityFact(3, {
    first_visit_offer_enabled: true,
    first_visit_price_minor: 9900,
    scarcity_mode: 'early_bird',
    early_bird_price_minor: 9900,
    early_bird_slots: 2,
  });
  output = await project(facts(1, { activity_occurrences: [{ ...equal, early_bird_fill: { fill_count: 0 } }] }));
  if (output.result.kind !== 'ok') throw new Error('projection failed');
  assertEquals(output.result.data.first_visit.pricing[0].pricing_reason, 'first_visit_offer');

  output = await project(facts(1, { activity_occurrences: [{ ...early, early_bird_fill: { fill_count: 2 } }] }));
  if (output.result.kind !== 'ok') throw new Error('projection failed');
  assertEquals(output.result.data.first_visit.pricing[0].pricing_reason, 'first_visit_offer');
});

Deno.test('Today secondary handles missing product fallback, zero price and private venue states', async () => {
  const fallback = { ...activityFact(4), product: null };
  let output = await project(facts(1, { activity_occurrences: [fallback] }));
  if (output.result.kind !== 'ok') throw new Error('projection failed');
  assertEquals(output.result.data.first_visit.pricing[0].effective_price_sek, 165);

  const zero = activityFact(5, { price_sek: 0 });
  output = await project(facts(1, { activity_occurrences: [{ ...zero, product: null }] }));
  if (output.result.kind !== 'ok') throw new Error('projection failed');
  assertEquals(output.result.data.first_visit.pricing[0].effective_price_sek, 0);
  assertEquals(output.result.data.first_visit.pricing[0].requires_checkout, false);

  assertEquals((await project({ input_valid: false })).result, { kind: 'invalid_input' });
  assertEquals((await project({ input_valid: true, venue_found: false })).result, { kind: 'venue_not_found' });
});
