import { resolveActivityPricingDecision, type FirstVisitEligibility } from './activity_pricing.ts';
import { resolvePublicLeagueDisplayPrice } from './public_league_pricing.ts';
import { resolveScopeAwarePricingDecision } from './scope_pricing.ts';

type RpcResult = { data: unknown; error: unknown | null };
export type TodaySecondaryRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};

type CourseFact = {
  series?: Record<string, unknown> | null;
  format?: Record<string, unknown> | null;
  artwork_url?: string | null;
  product?: Record<string, unknown> | null;
  capacity_fill?: Record<string, unknown> | null;
  early_bird_fill?: Record<string, unknown> | null;
  includes_open_play?: boolean;
};

type LeagueFact = {
  series_id?: string;
  venue_id?: string;
  name?: string;
  artwork_url?: string | null;
  start_date?: string;
  registration_opens_at?: string;
  registration_closes_at?: string;
  team_capacity?: number;
  league_night_count?: number;
  matches_per_team_per_night?: number;
  product?: Record<string, unknown> | null;
  capacity_fill?: Record<string, unknown> | null;
};

type ActivityFact = {
  session?: Record<string, unknown> | null;
  session_date?: string;
  resolved_product_key?: string;
  product?: Record<string, unknown> | null;
  capacity_fill?: Record<string, unknown> | null;
  early_bird_fill?: Record<string, unknown> | null;
};

type TodaySecondaryFacts = {
  input_valid?: boolean;
  venue_found?: boolean;
  venue_id?: string | null;
  course_candidates?: CourseFact[];
  league_candidate?: LeagueFact | null;
  has_configured_first_visit_offer?: boolean;
  activity_occurrences?: ActivityFact[];
};

export type TodaySecondaryCoursePromotion = {
  id: string;
  name: string;
  image_urls: string[];
  start_date: string;
  registration_state: 'open';
  capacity: { available_count: number };
  format: {
    name: string | null;
    description: string | null;
    presentation_type: string | null;
  };
  product: { base_price_sek: number };
  pricing: {
    scope_type: 'activity_series';
    list_price_minor: number;
    final_price_minor: number;
    pricing_reason: string;
    sales_channel: string;
    checkout_label: string;
    membership_tier_name: null;
    early_bird: {
      configured: boolean;
      active: boolean;
      applied: boolean;
      price_minor: number | null;
      slots: number | null;
      remaining: number | null;
    };
  };
  included_access: {
    open_play_series_period: { enabled: boolean };
  };
  route: string;
};

export type TodaySecondaryLeaguePromotion = {
  series: { id: string; name: string; image_urls: string[] };
  season: {
    team_capacity: number;
    league_night_count: number;
    matches_per_team_per_night: number;
  };
  capacity: { available_count: number };
  current_price_minor: number;
  pricing_reason: string;
  route: string;
};

export type TodaySecondaryActivityPrice = {
  activity_session_id: string;
  session_date: string;
  effective_price_sek: number;
  requires_checkout: boolean;
  pricing_reason: string;
  customer_presentation: {
    identityState: 'anonymous';
    displayPriceSek: number;
    displayLabel: string;
    listPriceSek: number;
    offerState: 'conditional' | null;
    offerLabel: string | null;
    offerDetail: string | null;
  };
};

export type TodaySecondaryResponse = {
  course: { mode: 'none'; item: null } | { mode: 'registration'; item: TodaySecondaryCoursePromotion };
  league: { mode: 'none'; item: null } | { mode: 'registration'; item: TodaySecondaryLeaguePromotion };
  first_visit: {
    is_first_time: true;
    has_configured_offer: boolean;
    pricing: TodaySecondaryActivityPrice[];
    occurrences: [];
    items: Array<{ route: string }>;
  };
};

export type TodaySecondaryLoadResult =
  | { kind: 'invalid_input' }
  | { kind: 'venue_not_found' }
  | { kind: 'ok'; data: TodaySecondaryResponse };

const ANONYMOUS_FIRST_VISIT_ELIGIBILITY: FirstVisitEligibility = {
  hasCommittedParticipation: false,
  hasCompletedRedemption: false,
  hasActiveReservation: false,
  eligible: true,
};

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
      const scopeType = String(args.p_scope_type || '');
      const scopeId = String(args.p_scope_id || args.p_activity_series_id || args.p_activity_session_id || '');
      const sessionDate = String(args.p_session_date || '');
      if (name === 'capacity_fill') {
        const key = `${scopeType}:${scopeId}:${sessionDate}`;
        return Promise.resolve({ data: oneRow(capacityByKey.get(key)), error: null });
      }
      if (name === 'series_early_bird_fill') {
        return Promise.resolve({ data: oneRow(earlyBirdByKey.get(`activity_series:${scopeId}:`)), error: null });
      }
      if (name === 'activity_early_bird_fill') {
        return Promise.resolve({ data: oneRow(earlyBirdByKey.get(`activity_session:${scopeId}:${sessionDate}`)), error: null });
      }
      throw new Error(`Today secondary pricing attempted unexpected RPC: ${name}`);
    },
    from(table: string) {
      throw new Error(`Today secondary pricing attempted unexpected table read: ${table}`);
    },
  };
}

function publicProgramRoute(sessionId: string, sessionDate: string, venueSlug: string) {
  return `/program/${encodeURIComponent(sessionId)}?date=${encodeURIComponent(sessionDate)}&v=${encodeURIComponent(venueSlug)}`;
}

function asFacts(value: unknown): TodaySecondaryFacts {
  if (Array.isArray(value)) return (value[0] || {}) as TodaySecondaryFacts;
  return (value || {}) as TodaySecondaryFacts;
}

export async function loadPublicTodaySecondary(
  client: TodaySecondaryRpcClient,
  input: { venueSlug: string; startDate: string; endDate: string; asOf?: string | null },
): Promise<TodaySecondaryLoadResult> {
  // This is the only remote call. Everything below is local projection through
  // the existing pricing resolvers using preloaded canonical facts.
  const result = await client.rpc('public_customer_today_secondary_facts', {
    p_venue_slug: input.venueSlug,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_as_of: input.asOf || new Date().toISOString(),
  });
  if (result.error) throw result.error;
  const facts = asFacts(result.data);
  if (facts.input_valid !== true) return { kind: 'invalid_input' };
  if (facts.venue_found !== true || !facts.venue_id) return { kind: 'venue_not_found' };

  const venueId = facts.venue_id;
  const capacityByKey = new Map<string, Record<string, unknown>>();
  const earlyBirdByKey = new Map<string, Record<string, unknown>>();
  for (const course of facts.course_candidates || []) {
    const seriesId = String(course.series?.id || '');
    const startDate = String(course.series?.start_date || '');
    capacityByKey.set(`activity_series:${seriesId}:${startDate}`, course.capacity_fill || {});
    earlyBirdByKey.set(`activity_series:${seriesId}:`, course.early_bird_fill || {});
  }
  for (const activity of facts.activity_occurrences || []) {
    const sessionId = String(activity.session?.id || '');
    const sessionDate = String(activity.session_date || '');
    capacityByKey.set(`activity_session:${sessionId}:${sessionDate}`, activity.capacity_fill || {});
    earlyBirdByKey.set(`activity_session:${sessionId}:${sessionDate}`, activity.early_bird_fill || {});
  }
  const localClient = pricingFactClient({ capacityByKey, earlyBirdByKey });

  let coursePromotion: TodaySecondaryCoursePromotion | null = null;
  for (const course of facts.course_candidates || []) {
    const series = course.series;
    const product = course.product;
    const availableCount = Math.max(0, Number(course.capacity_fill?.available_count || 0));
    if (!series?.id || !series.start_date || !product?.id || availableCount < 1) continue;
    const decision = await resolveScopeAwarePricingDecision({
      client: localClient,
      scopeType: 'activity_series',
      scopeId: String(series.id),
      venueId,
      userId: null,
      customerId: null,
      salesChannel: 'online',
      accessProduct: product as {
        id: string;
        venue_id: string;
        product_key: string;
        product_kind?: string | null;
        base_price_sek?: number | string | null;
        scarcity_mode?: string | null;
        early_bird_price_minor?: number | string | null;
        early_bird_slots?: number | string | null;
        resolver_rules?: Record<string, unknown> | null;
      },
      series,
    });
    const earlyBird = (decision.debug?.early_bird || {}) as Record<string, unknown>;
    coursePromotion = {
      id: String(series.id),
      name: String(series.name || ''),
      image_urls: course.artwork_url ? [String(course.artwork_url)] : [],
      start_date: String(series.start_date),
      registration_state: 'open',
      capacity: { available_count: availableCount },
      format: {
        name: course.format?.name ? String(course.format.name) : null,
        description: course.format?.description ? String(course.format.description) : null,
        presentation_type: course.format?.presentation_type ? String(course.format.presentation_type) : null,
      },
      product: { base_price_sek: Number(product.base_price_sek || 0) },
      pricing: {
        scope_type: 'activity_series',
        list_price_minor: Math.round(Number(decision.listAmountSek || 0) * 100),
        final_price_minor: Math.round(Number(decision.finalAmountSek || 0) * 100),
        pricing_reason: decision.pricingReason,
        sales_channel: decision.salesChannel,
        checkout_label: decision.checkoutLabel,
        membership_tier_name: null,
        early_bird: {
          configured: earlyBird.configured === true,
          active: earlyBird.active === true,
          applied: earlyBird.applied === true,
          price_minor: earlyBird.price_minor == null ? null : Number(earlyBird.price_minor),
          slots: earlyBird.slots == null ? null : Number(earlyBird.slots),
          remaining: earlyBird.remaining == null ? null : Number(earlyBird.remaining),
        },
      },
      included_access: { open_play_series_period: { enabled: course.includes_open_play === true } },
      route: `/course/${encodeURIComponent(String(series.id))}?v=${encodeURIComponent(input.venueSlug)}`,
    };
    break;
  }

  let leaguePromotion: TodaySecondaryLeaguePromotion | null = null;
  const league = facts.league_candidate;
  if (league?.series_id && league.product) {
    const regularPriceMinor = Math.round(Number(league.product.base_price_sek || 0) * 100);
    const displayPrice = resolvePublicLeagueDisplayPrice({
      regularPriceMinor,
      regularPriceReason: 'league_team_base_price',
      scarcityMode: league.product.scarcity_mode == null ? null : String(league.product.scarcity_mode),
      earlyBirdPriceMinor: Number(league.product.early_bird_price_minor || 0),
      earlyBirdRemaining: Number(league.capacity_fill?.early_bird_remaining || 0),
    });
    leaguePromotion = {
      series: {
        id: String(league.series_id),
        name: String(league.name || ''),
        image_urls: league.artwork_url ? [String(league.artwork_url)] : [],
      },
      season: {
        team_capacity: Number(league.team_capacity || 0),
        league_night_count: Number(league.league_night_count || 0),
        matches_per_team_per_night: Number(league.matches_per_team_per_night || 0),
      },
      capacity: { available_count: Math.max(0, Number(league.capacity_fill?.available_count || 0)) },
      current_price_minor: displayPrice.currentPriceMinor,
      pricing_reason: displayPrice.pricingReason,
      route: `/seriespel/${encodeURIComponent(String(league.series_id))}?v=${encodeURIComponent(input.venueSlug)}`,
    };
  }

  const productCache = new Map<string, Promise<unknown>>();
  for (const activity of facts.activity_occurrences || []) {
    productCache.set(
      `${venueId}:${String(activity.resolved_product_key || '')}`,
      Promise.resolve(activity.product || null),
    );
  }
  const activityPricing = await Promise.all((facts.activity_occurrences || []).map(async (activity) => {
    const session = activity.session;
    const sessionDate = String(activity.session_date || '');
    if (!session?.id || !sessionDate) return null;
    const decision = await resolveActivityPricingDecision({
      client: localClient,
      venueId,
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
    return {
      activity_session_id: String(session.id),
      session_date: sessionDate,
      effective_price_sek: decision.effectivePriceSek,
      requires_checkout: decision.requiresCheckout,
      pricing_reason: decision.pricingReason,
      customer_presentation: {
        ...decision.customerPresentation,
        identityState: 'anonymous' as const,
        offerState: decision.customerPresentation.offerState === 'conditional' ? 'conditional' as const : null,
      },
    };
  }));
  const pricing = activityPricing.filter((item): item is TodaySecondaryActivityPrice => item !== null);
  const items = pricing
    .filter((item) => item.customer_presentation.offerState === 'conditional')
    .map((item) => ({ route: publicProgramRoute(item.activity_session_id, item.session_date, input.venueSlug) }));

  return {
    kind: 'ok',
    data: {
      course: coursePromotion ? { mode: 'registration', item: coursePromotion } : { mode: 'none', item: null },
      league: leaguePromotion ? { mode: 'registration', item: leaguePromotion } : { mode: 'none', item: null },
      first_visit: {
        is_first_time: true,
        has_configured_offer: facts.has_configured_first_visit_offer === true,
        pricing,
        occurrences: [],
        items,
      },
    },
  };
}
