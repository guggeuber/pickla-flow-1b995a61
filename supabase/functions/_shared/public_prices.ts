import { resolveActivityPricingDecision, type FirstVisitEligibility } from './activity_pricing.ts';
import { evaluateCommerceAvailability } from './commerce_availability.ts';

type RpcResult = { data: unknown; error: { message?: string } | null };

export type PublicPricesRpcClient = {
  rpc: (
    name: 'public_customer_prices_facts',
    args: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
};

type PublicPricesFacts = {
  input_valid?: boolean;
  venue_found?: boolean;
  venue_id?: string | null;
  commerce_enabled?: boolean;
  memberships?: unknown[];
  court_pricing?: unknown[];
  commerce_candidates?: unknown[];
  courses?: unknown[];
  has_configured_first_visit_offer?: boolean;
  first_visit_fallback_occurrence?: ActivityFact | null;
  first_visit_occurrences?: ActivityFact[];
};

type ActivityFact = {
  session?: Record<string, unknown> | null;
  session_date?: string;
  resolved_product_key?: string;
  product?: Record<string, unknown> | null;
  capacity_fill?: Record<string, unknown> | null;
  early_bird_fill?: Record<string, unknown> | null;
};

export type PublicPricesResponse = {
  memberships: Array<{
    id: string;
    name: string;
    description: string | null;
    monthly_price: number | null;
  }>;
  court_pricing: Array<{
    id: string;
    name: string;
    type: 'hourly';
    price: number;
    days_of_week: number[];
    time_from: string | null;
    time_to: string | null;
  }>;
  day_passes: Array<{
    id: string;
    name: string;
    description: string;
    base_price_sek: number;
  }>;
  punch_cards: Array<{
    id: string;
    name: string;
    description: string | null;
    base_price_sek: number;
  }>;
  courses: Array<{
    id: string;
    name: string;
    description: string | null;
    base_price_sek: number;
  }>;
  first_visit: {
    available: boolean;
    title: string | null;
    description: string | null;
    public_price_sek: number | null;
    route: string | null;
  };
};

export type PublicPricesLoadResult =
  | { kind: 'invalid_input' }
  | { kind: 'venue_not_found' }
  | { kind: 'ok'; data: PublicPricesResponse };

const ANONYMOUS_FIRST_VISIT_ELIGIBILITY: FirstVisitEligibility = {
  hasCommittedParticipation: false,
  hasCompletedRedemption: false,
  hasActiveReservation: false,
  eligible: true,
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function factsValue(value: unknown) {
  return objectValue(Array.isArray(value) ? value[0] : value) as PublicPricesFacts | null;
}

function requiredText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Prices projection unavailable');
  return value;
}

function nullableText(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function finiteNumber(value: unknown, nullable = false) {
  if (nullable && value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Prices projection unavailable');
  return number;
}

function oneRow(value: Record<string, unknown> | null | undefined) {
  return value ? [value] : [];
}

function pricingFactClient({
  capacityByKey,
  earlyBirdByKey,
}: {
  capacityByKey: Map<string, Record<string, unknown>>;
  earlyBirdByKey: Map<string, Record<string, unknown>>;
}) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      const scopeId = String(args.p_scope_id || args.p_activity_session_id || '');
      const sessionDate = String(args.p_session_date || '');
      if (name === 'capacity_fill') {
        return Promise.resolve({
          data: oneRow(capacityByKey.get(`activity_session:${scopeId}:${sessionDate}`)),
          error: null,
        });
      }
      if (name === 'activity_early_bird_fill') {
        return Promise.resolve({
          data: oneRow(earlyBirdByKey.get(`activity_session:${scopeId}:${sessionDate}`)),
          error: null,
        });
      }
      throw new Error(`Prices pricing attempted unexpected RPC: ${name}`);
    },
    from(table: string) {
      throw new Error(`Prices pricing attempted unexpected table read: ${table}`);
    },
  };
}

function publicProgramRoute(sessionId: string, sessionDate: string, venueSlug: string) {
  return `/program/${encodeURIComponent(sessionId)}?date=${encodeURIComponent(sessionDate)}&v=${encodeURIComponent(venueSlug)}`;
}

function membership(value: unknown): PublicPricesResponse['memberships'][number] {
  const row = objectValue(value);
  if (!row) throw new Error('Prices projection unavailable');
  return {
    id: requiredText(row.id),
    name: requiredText(row.name),
    description: nullableText(row.description),
    monthly_price: finiteNumber(row.monthly_price, true),
  };
}

function courtPrice(value: unknown): PublicPricesResponse['court_pricing'][number] {
  const row = objectValue(value);
  if (!row || row.type !== 'hourly') throw new Error('Prices projection unavailable');
  const days = Array.isArray(row.days_of_week)
    ? row.days_of_week.map((day) => Number(day))
    : [];
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('Prices projection unavailable');
  }
  return {
    id: requiredText(row.id),
    name: requiredText(row.name),
    type: 'hourly',
    price: finiteNumber(row.price) as number,
    days_of_week: days,
    time_from: nullableText(row.time_from),
    time_to: nullableText(row.time_to),
  };
}

function coursePrice(value: unknown): PublicPricesResponse['courses'][number] {
  const row = objectValue(value);
  if (!row) throw new Error('Prices projection unavailable');
  return {
    id: requiredText(row.id),
    name: requiredText(row.name),
    description: nullableText(row.description),
    base_price_sek: finiteNumber(row.base_price_sek) as number,
  };
}

function commerceProducts(
  candidates: unknown[],
  commerceEnabled: boolean,
): Pick<PublicPricesResponse, 'day_passes' | 'punch_cards'> {
  const dayPasses: PublicPricesResponse['day_passes'] = [];
  const punchCards: PublicPricesResponse['punch_cards'] = [];

  for (const value of candidates) {
    const product = objectValue(value);
    if (!product) throw new Error('Prices projection unavailable');
    const participation = product.commerce_kind === 'participation';
    const eligible = participation
      ? Number(product.base_price_sek || 0) > 0 && evaluateCommerceAvailability(product, {
          channel: 'participation',
          venueCommerceEnabled: commerceEnabled,
        }).eligible
      : evaluateCommerceAvailability(product, {
          channel: 'standalone',
          venueCommerceEnabled: commerceEnabled,
        }).eligible || evaluateCommerceAvailability(product, {
          channel: 'activity_addon',
          venueCommerceEnabled: commerceEnabled,
          hasActiveRelationship: product.has_active_relationship === true,
        }).eligible;
    if (!eligible) continue;

    const row = {
      id: requiredText(product.id),
      name: requiredText(product.name),
      description: nullableText(product.description),
      base_price_sek: finiteNumber(product.base_price_sek) as number,
    };
    if (product.product_key === 'day_access' || product.product_kind === 'day_access') {
      dayPasses.push({ ...row, description: 'Spela Open Play hela dagen.' });
    } else if (product.product_kind === 'punch_card' || product.category === 'punch_card') {
      punchCards.push(row);
    }
  }
  return { day_passes: dayPasses, punch_cards: punchCards };
}

export async function loadPublicPrices(
  client: PublicPricesRpcClient,
  input: { venueSlug: string; startDate: string; endDate: string; asOf?: string | null },
): Promise<PublicPricesLoadResult> {
  // The only remote read. Shared resolvers below operate on these preloaded facts.
  const result = await client.rpc('public_customer_prices_facts', {
    p_venue_slug: input.venueSlug,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_as_of: input.asOf || new Date().toISOString(),
  });
  if (result.error) throw new Error(result.error.message || 'Prices projection unavailable');
  const facts = factsValue(result.data);
  if (!facts || facts.input_valid !== true) return { kind: 'invalid_input' };
  if (facts.venue_found !== true || !facts.venue_id) return { kind: 'venue_not_found' };
  if (!Array.isArray(facts.memberships) || !Array.isArray(facts.court_pricing)
    || !Array.isArray(facts.commerce_candidates) || !Array.isArray(facts.courses)
    || !Array.isArray(facts.first_visit_occurrences)) {
    throw new Error('Prices projection unavailable');
  }

  const capacityByKey = new Map<string, Record<string, unknown>>();
  const earlyBirdByKey = new Map<string, Record<string, unknown>>();
  const productCache = new Map<string, Promise<unknown>>();
  const fallbackOccurrence = facts.first_visit_fallback_occurrence == null
    ? null
    : objectValue(facts.first_visit_fallback_occurrence) as ActivityFact | null;
  if (facts.first_visit_fallback_occurrence != null && !fallbackOccurrence) {
    throw new Error('Prices projection unavailable');
  }
  const pricingOccurrences = [
    ...facts.first_visit_occurrences,
    ...(fallbackOccurrence ? [fallbackOccurrence] : []),
  ];
  for (const activity of pricingOccurrences) {
    const sessionId = String(activity.session?.id || '');
    const sessionDate = String(activity.session_date || '');
    const productKey = String(activity.resolved_product_key || '');
    capacityByKey.set(`activity_session:${sessionId}:${sessionDate}`, activity.capacity_fill || {});
    earlyBirdByKey.set(`activity_session:${sessionId}:${sessionDate}`, activity.early_bird_fill || {});
    productCache.set(`${facts.venue_id}:${productKey}`, Promise.resolve(activity.product || null));
  }
  const localClient = pricingFactClient({ capacityByKey, earlyBirdByKey });

  let firstVisitItem: {
    title: string;
    publicPriceSek: number;
    route: string;
  } | null = null;
  for (const activity of facts.first_visit_occurrences) {
    const session = activity.session;
    const sessionDate = String(activity.session_date || '');
    if (!session?.id || !sessionDate) continue;
    const decision = await resolveActivityPricingDecision({
      client: localClient,
      venueId: facts.venue_id,
      userId: null,
      customerId: null,
      firstVisitEligibility: ANONYMOUS_FIRST_VISIT_ELIGIBILITY,
      activitySessionId: String(session.id),
      sessionDate,
      requestedProductKey: session.product_key == null ? null : String(session.product_key),
      requestedAmountSek: session.price_sek == null ? null : Number(session.price_sek),
      purchaseKind: 'activity_ticket',
      session,
      productCache,
    });
    if (decision.customerPresentation.offerState !== 'conditional') continue;
    const firstVisit = objectValue(decision.debug.first_visit_offer);
    const publicPriceSek = finiteNumber(firstVisit?.price_sek) as number;
    firstVisitItem = {
      title: decision.customerPresentation.offerDetail || `Första gången? Spela för ${publicPriceSek} kr.`,
      publicPriceSek,
      route: publicProgramRoute(String(session.id), sessionDate, input.venueSlug),
    };
    break;
  }

  const hasConfiguredOffer = facts.has_configured_first_visit_offer === true;
  let fallbackPrice: number | null = null;
  if (!firstVisitItem && !hasConfiguredOffer && fallbackOccurrence) {
    const session = fallbackOccurrence.session;
    const sessionDate = String(fallbackOccurrence.session_date || '');
    if (!session?.id || !sessionDate || !fallbackOccurrence.resolved_product_key) {
      throw new Error('Prices projection unavailable');
    }
    const decision = await resolveActivityPricingDecision({
      client: localClient,
      venueId: facts.venue_id,
      userId: null,
      customerId: null,
      firstVisitEligibility: ANONYMOUS_FIRST_VISIT_ELIGIBILITY,
      activitySessionId: String(session.id),
      sessionDate,
      requestedProductKey: session.product_key == null ? null : String(session.product_key),
      requestedAmountSek: session.price_sek == null ? null : Number(session.price_sek),
      purchaseKind: 'activity_ticket',
      session,
      productCache,
      applyFirstVisit: false,
    });
    fallbackPrice = finiteNumber(decision.customerPresentation.displayPriceSek) as number;
  }
  const products = commerceProducts(facts.commerce_candidates, facts.commerce_enabled === true);
  return {
    kind: 'ok',
    data: {
      memberships: facts.memberships.map(membership),
      court_pricing: facts.court_pricing.map(courtPrice),
      ...products,
      courses: facts.courses.map(coursePrice),
      first_visit: firstVisitItem ? {
        available: true,
        title: firstVisitItem.title,
        description: 'Racket finns att låna.',
        public_price_sek: firstVisitItem.publicPriceSek,
        route: firstVisitItem.route,
      } : !hasConfiguredOffer && fallbackPrice != null ? {
        available: true,
        title: `Första gången? ${fallbackPrice} kr, racket ingår — kom på Open Play ikväll.`,
        description: null,
        public_price_sek: fallbackPrice,
        route: `/today?v=${encodeURIComponent(input.venueSlug)}`,
      } : {
        available: false,
        title: null,
        description: null,
        public_price_sek: null,
        route: null,
      },
    },
  };
}
