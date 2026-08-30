import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { requireVenueRole } from '../_shared/authorization.ts';
import {
  resolveCustomerIdForUser,
  resolveOrCreateCustomerIdForUser,
  resolveOrCreateGuestCustomerByEmail,
} from '../_shared/customers.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';
import {
  buildLeagueResourcePreview,
  type CanonicalResourcePreviewRow,
  type LeagueResourcePreview,
} from '../_shared/league_resource_preview.ts';
import { resolveScopeAwarePricingDecision } from '../_shared/scope_pricing.ts';
import { resolvePublicLeagueDisplayPrice } from '../_shared/public_league_pricing.ts';

type AdminClient = ReturnType<typeof getServiceClient>;
type LeagueCapacityFill = {
  team_capacity?: number;
  active_teams?: number;
  active_holds?: number;
  fill_count?: number;
  available_count?: number;
  early_bird_allocated?: number;
  early_bird_remaining?: number | null;
};
type LeagueReservation = {
  ok?: boolean;
  team_entry_id?: string;
  hold_id?: string;
  reason?: string;
  applied_price_type?: string;
  base_price_minor?: number;
  final_price_minor?: number;
  early_bird_remaining?: number | null;
  quote_changed?: boolean;
  team_capacity?: number;
  team_fill_before?: number;
  allocation_position?: number;
  early_bird_allocation_position?: number | null;
  regular_price_minor?: number;
  regular_price_type?: string;
  membership_id?: string | null;
  membership_tier_id?: string | null;
  membership_tier_name?: string | null;
};

function customerReservationPricing(reservation: LeagueReservation) {
  const pricing: Record<string, unknown> = { ...reservation };
  delete pricing.membership_id;
  delete pricing.membership_tier_id;
  return pricing;
}

type LeagueStandingRow = { team_entry_id: string; [key: string]: unknown };
type LeagueResourcePlanInput = {
  venueId: string;
  nightDates: string[];
  courtIds: string[];
  startTime: '18:00';
  endTime: '20:00';
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function optionalUserId(req: Request) {
  if (!req.headers.get('Authorization')) return null;
  const auth = await getAuthenticatedClient(req);
  return auth.error ? null : auth.userId;
}

async function requireUserId(req: Request) {
  const auth = await getAuthenticatedClient(req);
  if (auth.error || !auth.userId) throw new Error('Unauthorized');
  return auth.userId;
}

function validEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizedName(value: unknown, max = 120) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function leagueResourcePlanInput(body: Record<string, unknown>): LeagueResourcePlanInput | null {
  const venueId = String(body.venue_id || '');
  const nightDates = Array.isArray(body.night_dates) ? body.night_dates.map(String) : [];
  const courtIds = Array.isArray(body.court_ids) ? [...new Set(body.court_ids.map(String))] : [];
  const startTime = String(body.start_time || '18:00').slice(0, 5);
  const endTime = String(body.end_time || '20:00').slice(0, 5);
  const validDates = nightDates.length === 5
    && new Set(nightDates).size === 5
    && nightDates.every((date, index) => {
      const parsed = DateTime.fromISO(date, { zone: 'Europe/Stockholm' });
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && parsed.isValid && parsed.weekday === 4
        && (index === 0 || date > nightDates[index - 1]);
    });
  if (!UUID.test(venueId) || !validDates || courtIds.length !== 3 || courtIds.some((id) => !UUID.test(id))) return null;
  if (startTime !== '18:00' || endTime !== '20:00') return null;
  return { venueId, nightDates, courtIds, startTime, endTime };
}

async function previewLeagueResourcePlan(admin: AdminClient, input: LeagueResourcePlanInput): Promise<LeagueResourcePreview> {
  const { data: validCourts, error: courtError } = await admin.from('venue_courts').select('id')
    .eq('venue_id', input.venueId).eq('sport_type', 'pickleball').eq('is_available', true).in('id', input.courtIds);
  if (courtError) throw new Error(courtError.message);
  if ((validCourts || []).length !== input.courtIds.length) throw new Error('League resources are unavailable');

  const rowsByNight = await Promise.all(input.nightDates.map(async (date) => {
    const { data, error } = await admin.rpc('preview_course_resource_schedule', {
      p_venue_id: input.venueId,
      p_start_date: date,
      p_end_date: date,
      p_recurrence_days: [4],
      p_start_time: input.startTime,
      p_end_time: input.endTime,
      p_total_sessions: 1,
      p_court_ids: input.courtIds,
      p_exclude_series_id: null,
      p_exclude_session_id: null,
    });
    if (error) throw new Error(error.message);
    const rows = (data || []) as CanonicalResourcePreviewRow[];
    if (rows.length !== input.courtIds.length || new Set(rows.map((row) => row.court_id)).size !== input.courtIds.length) {
      throw new Error('League resources are unavailable');
    }
    return rows;
  }));

  const activityIds = [...new Set(rowsByNight.flatMap((rows) => rows.flatMap((row) =>
    (row.conflicts || []).filter((conflict) => conflict.source_type === 'activity_session').map((conflict) => conflict.source_id)
  )))];
  const activitySessionTypes = new Map<string, string>();
  if (activityIds.length) {
    const { data, error } = await admin.from('activity_sessions').select('id, session_type').in('id', activityIds);
    if (error) throw new Error(error.message);
    for (const session of data || []) activitySessionTypes.set(session.id, session.session_type);
  }
  return buildLeagueResourcePreview(input.nightDates, rowsByNight, activitySessionTypes);
}

function leagueConflictResponse(preview: LeagueResourcePreview | null) {
  const conflict = preview?.nights.flatMap((night) => night.courts).flatMap((court) =>
    court.conflicts.map((item) => ({ courtName: court.court_name, ...item }))
  )[0];
  const starts = conflict?.starts_at ? DateTime.fromISO(conflict.starts_at).setZone('Europe/Stockholm') : null;
  const ends = conflict?.ends_at ? DateTime.fromISO(conflict.ends_at).setZone('Europe/Stockholm') : null;
  const message = conflict && starts?.isValid && ends?.isValid
    ? `${conflict.courtName} är upptagen av ${conflict.owner_name || conflict.owner_label} ${starts.toFormat('HH:mm')}–${ends.toFormat('HH:mm')}. Ändra League-planen och kontrollera banorna igen.`
    : 'En vald bana hann bli upptagen. Ändra League-planen och kontrollera banorna igen.';
  return jsonResponse({ error: message, code: 'managed_series_resource_conflict', preview }, 409, 0);
}

function cleanLeagueImageUrls(value: unknown, seriesId: string) {
  if (!Array.isArray(value) || value.length > 1) return null;
  const storageOrigin = Deno.env.get('SUPABASE_URL');
  if (!storageOrigin) return null;
  const marker = `/storage/v1/object/public/event-logos/activity-series/${seriesId}/`;
  const urls = [...new Set(value.map((url) => String(url || '').trim()).filter(Boolean))];
  if (urls.some((url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin !== new URL(storageOrigin).origin || !parsed.pathname.startsWith(marker)
        || !/^1\.(png|jpe?g|webp)$/i.test(parsed.pathname.slice(marker.length));
    } catch {
      return true;
    }
  })) return null;
  return urls;
}

function leagueCatalogError(message: string) {
  if (message.includes('league_catalog_not_found')) return ['Seriespelet kunde inte hittas.', 404] as const;
  if (message.includes('league_catalog_lifecycle_locked')) return ['Avslutade eller inställda Seriespel kan inte redigeras.', 409] as const;
  if (message.includes('league_catalog_product_invalid')) return ['League-produkten är inte i ett redigerbart läge.', 409] as const;
  if (message.includes('league_catalog_content_invalid')) return ['Ange en titel och högst 1 000 tecken beskrivning.', 400] as const;
  if (message.includes('league_deadlines_invalid')) return ['Datumen måste ligga i ordning före den första League-kvällen.', 400] as const;
  if (message.includes('league_registration_open_historical')) return ['Anmälningsstarten har redan passerat och är därför låst.', 409] as const;
  if (message.includes('league_registration_deadline_historical')) return ['Anmälningsdeadline har redan passerat och är därför låst.', 409] as const;
  if (message.includes('league_fixture_deadline_historical')) return ['Deadline för spelschemat är redan historisk eller publicerad och är därför låst.', 409] as const;
  if (message.includes('league_registration_open_must_be_future')
      || message.includes('league_registration_deadline_must_be_future')
      || message.includes('league_fixture_deadline_must_be_future')) {
    return ['En redigerbar deadline måste ligga i framtiden.', 400] as const;
  }
  if (message.includes('league_price_invalid')) return ['Teampriset måste vara ett positivt helt SEK-belopp.', 400] as const;
  if (message.includes('league_early_bird_pair_required') || message.includes('league_early_bird_invalid')) {
    return ['Early Bird kräver ett lägre teampris och mellan 1 och 6 lag.', 400] as const;
  }
  if (message.includes('league_pricing_historical')) return ['Teampriset är låst eftersom anmälan har stängt.', 409] as const;
  return [message, 400] as const;
}

function requestId(req: Request, body?: Record<string, unknown>) {
  return String(body?.request_id || req.headers.get('x-request-id') || crypto.randomUUID()).trim().slice(0, 200);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function staff(admin: AdminClient, userId: string, venueId: string) {
  await requireVenueRole(admin, userId, venueId, ['venue_admin', 'desk_staff']);
}

async function loadSeasonBySeries(admin: AdminClient, seriesId: string, requireActive = false) {
  if (!UUID.test(seriesId)) throw new Error('Seriespel kunde inte hittas.');
  const { data: series, error } = await admin.from('activity_series')
    .select('id, venue_id, format_id, access_product_id, name, description, image_urls, series_type, sport_type, status, start_date, end_date, total_sessions, registration_opens_at, registration_closes_at, start_time, end_time, court_ids, metadata, activity_formats(name, presentation_type), venues(name, slug, timezone)')
    .eq('id', seriesId).eq('series_type', 'league').maybeSingle();
  if (error || !series || (requireActive && series.status !== 'active')) {
    throw new Error(error?.message || 'Seriespel kunde inte hittas.');
  }
  const { data: season, error: seasonError } = await admin.from('league_seasons')
    .select('*').eq('activity_series_id', series.id).maybeSingle();
  if (seasonError || !season) throw new Error(seasonError?.message || 'Seriespel kunde inte hittas.');
  return { series, season };
}

async function loadPublicProjection(admin: AdminClient, seriesId: string, userId: string | null) {
  const { series, season } = await loadSeasonBySeries(admin, seriesId, true);
  const [{ data: product, error: productError }, { data: sessions, error: sessionsError }, capacityResult] = await Promise.all([
    admin.from('access_products').select('id, venue_id, product_key, product_kind, name, description, base_price_sek, vat_rate, scarcity_mode, early_bird_price_minor, early_bird_slots, status, is_active').eq('id', series.access_product_id).maybeSingle(),
    admin.from('activity_sessions').select('id, session_date, start_time, end_time, court_ids, series_occurrence_index').eq('series_id', series.id).eq('session_type', 'league').eq('is_active', true).order('series_occurrence_index'),
    admin.rpc('league_team_capacity_fill', { p_league_season_id: season.id }).maybeSingle(),
  ]);
  if (productError || sessionsError || capacityResult.error || !product) {
    throw new Error(productError?.message || sessionsError?.message || capacityResult.error?.message || 'Seriespel kunde inte läsas.');
  }
  const { data: teamRows, error: teamError } = await admin.from('league_team_entries')
    .select('id, team_name, status').eq('league_season_id', season.id)
    .in('status', season.fixtures_published_at ? ['active', 'withdrawn'] : ['active']).order('activated_at');
  if (teamError) throw new Error(teamError.message);
  const capacity = (capacityResult.data || {}) as LeagueCapacityFill;
  const basePriceMinor = Math.round(Number(product.base_price_sek || 0) * 100);
  let regularPriceMinor = basePriceMinor;
  let regularPriceReason = 'league_team_base_price';
  let winningMembershipTierName: string | null = null;
  let customerTeamId: string | null = null;
  let customerId: string | null = null;
  if (userId) {
    customerId = await resolveCustomerIdForUser(admin, userId);
    const regularDecision = await resolveScopeAwarePricingDecision({
      client: admin,
      scopeType: 'activity_series',
      scopeId: series.id,
      venueId: series.venue_id,
      userId,
      customerId,
      salesChannel: 'online',
      accessProduct: product,
      series,
      applyEarlyBird: false,
    });
    regularPriceMinor = Math.round(Number(regularDecision.finalAmountSek || 0) * 100);
    if (regularDecision.pricingReason === 'membership_tier_pricing') {
      regularPriceReason = 'membership_tier_pricing';
      winningMembershipTierName = regularDecision.membershipTierName;
    }
    if (customerId) {
      const { data: membership } = await admin.from('league_team_members')
        .select('team_entry_id, league_team_entries!inner(status)')
        .eq('league_season_id', season.id).eq('customer_id', customerId).eq('status', 'active').maybeSingle();
      customerTeamId = membership?.team_entry_id || null;
    }
  }
  const { currentPriceMinor, pricingReason } = resolvePublicLeagueDisplayPrice({
    regularPriceMinor,
    regularPriceReason,
    scarcityMode: product.scarcity_mode,
    earlyBirdPriceMinor: Number(product.early_bird_price_minor || 0),
    earlyBirdRemaining: Number(capacity.early_bird_remaining || 0),
  });
  let fixtures: unknown[] = [];
  let standings: unknown[] = [];
  if (season.fixtures_published_at) {
    const [{ data: fixtureRows, error: fixtureError }, standingsResult] = await Promise.all([
      admin.from('league_fixtures')
        .select('id, league_night_session_id, round_number, block_number, venue_court_id, team_a_entry_id, team_b_entry_id, scheduled_start_at, scheduled_end_at, status, league_fixture_results(id, state, outcome_type, sets, walkover_winner_team_id, version)')
        .eq('league_season_id', season.id).order('round_number').order('block_number').order('venue_court_id'),
      admin.rpc('get_league_standings', { p_league_season_id: season.id }),
    ]);
    if (fixtureError || standingsResult.error) throw new Error(fixtureError?.message || standingsResult.error?.message);
    fixtures = fixtureRows || [];
    standings = standingsResult.data || [];
  }
  const courtIds = Array.from(new Set((sessions || []).flatMap((session) => session.court_ids || [])));
  const { data: courts, error: courtsError } = courtIds.length
    ? await admin.from('venue_courts').select('id, name, court_number').in('id', courtIds).order('court_number')
    : { data: [], error: null };
  if (courtsError) throw new Error(courtsError.message);
  return {
    series,
    season,
    product,
    sessions: sessions || [],
    courts: courts || [],
    capacity,
    current_price_minor: currentPriceMinor,
    pricing_reason: pricingReason,
    membership_tier_name: pricingReason === 'membership_tier_pricing' ? winningMembershipTierName : null,
    teams: teamRows || [],
    fixtures,
    standings,
    customer_team_id: customerTeamId,
  };
}

async function createLeagueCart(admin: AdminClient, req: Request, body: Record<string, unknown>, userId: string) {
  const seriesId = String(body.series_id || '').trim();
  const teamName = String(body.team_name || '').trim().replace(/\s+/g, ' ');
  const playerName = normalizedName(body.player_name);
  const playerEmail = validEmail(body.player_email);
  const registrationRequestId = String(body.registration_request_id || '').trim().slice(0, 200);
  const sourceLineId = String(body.source_line_id || '').trim();
  if (Array.from(teamName).length < 3 || Array.from(teamName).length > 40 || /[<>]/.test(teamName)) {
    throw new Error('Lagnamnet måste vara 3–40 tecken och får inte innehålla HTML.');
  }
  if (!playerName || !playerEmail || registrationRequestId.length < 16 || !UUID.test(sourceLineId)) {
    throw new Error('Fyll i lagnamn, namn och e-post för spelare 2.');
  }
  if (body.age_confirmed !== true) throw new Error('Båda spelarna måste vara 18+.');
  const { series, season } = await loadSeasonBySeries(admin, seriesId, true);
  const captainCustomerId = await resolveOrCreateCustomerIdForUser(admin, userId, series.venue_id, 'league_team_captain');
  if (!captainCustomerId) throw new Error('Lagkaptenens kundprofil kunde inte lösas.');
  const { data: authResult, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError || !authResult?.user?.email) throw new Error('Lagkaptenens e-post kunde inte lösas.');
  if (authResult.user.email.trim().toLowerCase() === playerEmail) throw new Error('Spelare 2 måste vara en annan person.');

  // A retry may arrive after this captain's own hold has consumed the last
  // visible slot. Do not reject that retry in the read-only preflight; the
  // locked RPC below verifies the complete team payload before reusing it.
  const [requestEntryResult, captainEntryResult] = await Promise.all([
    admin.from('league_team_entries')
      .select('id, team_name_key, status, registration_request_id, captain_customer_id, capacity_hold_id')
      .eq('league_season_id', season.id).eq('registration_request_id', registrationRequestId).maybeSingle(),
    admin.from('league_team_entries')
      .select('id, team_name_key, status, registration_request_id, captain_customer_id, capacity_hold_id')
      .eq('league_season_id', season.id).eq('captain_customer_id', captainCustomerId)
      .in('status', ['pending', 'active']).order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (requestEntryResult.error || captainEntryResult.error) {
    throw new Error(requestEntryResult.error?.message || captainEntryResult.error?.message);
  }
  const requestEntry = requestEntryResult.data;
  if (requestEntry && requestEntry.captain_customer_id !== captainCustomerId) {
    throw new Error('Registreringsförfrågan tillhör en annan kund. Börja om anmälan.');
  }
  if (requestEntry?.status === 'cancelled') {
    throw new Error('Den tidigare reservationen har löpt ut. Börja om anmälan.');
  }
  const existingForCaptain = requestEntry || captainEntryResult.data;

  let playerCustomerId: string | null = null;
  if (existingForCaptain) {
    const { data: existingPlayer, error: existingPlayerError } = await admin.from('league_team_members')
      .select('customer_id, customers!inner(primary_email)')
      .eq('team_entry_id', existingForCaptain.id).eq('role', 'player')
      .in('status', ['pending', 'active']).maybeSingle();
    if (existingPlayerError) throw new Error(existingPlayerError.message);
    const playerCustomer = Array.isArray(existingPlayer?.customers)
      ? existingPlayer?.customers[0] : existingPlayer?.customers;
    if (existingForCaptain.team_name_key !== teamName.toLowerCase()
      || String(playerCustomer?.primary_email || '').trim().toLowerCase() !== playerEmail) {
      throw new Error('Det finns redan en pågående laganmälan med andra uppgifter. Slutför den eller börja om efter att reservationen löpt ut.');
    }
    playerCustomerId = existingPlayer?.customer_id || null;
  }

  // A capacity preflight avoids creating a guest customer for an already-full
  // League. The RPC below is still the only capacity authority and closes the race.
  const { data: preflightData, error: preflightError } = await admin.rpc('league_team_capacity_fill', {
    p_league_season_id: season.id,
  }).maybeSingle();
  if (preflightError) throw new Error(preflightError.message);
  const preflight = (preflightData || {}) as LeagueCapacityFill;
  if (Number(preflight?.available_count || 0) <= 0 && !existingForCaptain) throw new Error('Seriespelet är fullt.');
  if (!playerCustomerId) {
    playerCustomerId = await resolveOrCreateGuestCustomerByEmail(admin, {
      venueId: series.venue_id,
      email: playerEmail,
      displayName: playerName,
      source: 'league_team_player_2',
    });
  }
  if (playerCustomerId === captainCustomerId) throw new Error('Spelare 2 måste vara en annan person.');

  const { data: reservedData, error: reserveError } = await admin.rpc('reserve_league_team_entry_v2', {
    p_league_season_id: season.id,
    p_captain_user_id: userId,
    p_captain_customer_id: captainCustomerId,
    p_player_customer_id: playerCustomerId,
    p_team_name: teamName,
    p_registration_request_id: registrationRequestId,
    p_source_id: sourceLineId,
    p_age_confirmed: true,
    p_quoted_price_minor: body.quoted_price_minor == null ? null : Number(body.quoted_price_minor),
  }).maybeSingle();
  if (reserveError) throw new Error(reserveError.message);
  const reserved = (reservedData || {}) as LeagueReservation;
  if (!reserved?.ok || !reserved?.team_entry_id || !reserved?.hold_id) {
    throw new Error(reserved?.reason === 'capacity_full' ? 'Seriespelet blev precis fullt.' : 'Lagplatsen kunde inte reserveras.');
  }
  const { data: existingEntry, error: existingError } = await admin.from('league_team_entries')
    .select('id, commerce_order_id').eq('id', reserved.team_entry_id).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existingEntry?.commerce_order_id) {
    return {
      order: { id: existingEntry.commerce_order_id },
      cart_token: existingEntry.commerce_order_id,
      pricing: customerReservationPricing(reserved),
    };
  }
  const [{ data: venue, error: venueError }, { data: product, error: productError }] = await Promise.all([
    admin.from('venues').select('id, organization_id').eq('id', series.venue_id).maybeSingle(),
    admin.from('access_products').select('*').eq('id', series.access_product_id).maybeSingle(),
  ]);
  if (venueError || productError || !venue || !product) {
    await admin.rpc('release_capacity_hold', { p_hold_id: reserved.hold_id, p_reason: 'league_product_load_failed' });
    throw new Error(venueError?.message || productError?.message || 'League product missing');
  }
  const token = crypto.randomUUID() + crypto.randomUUID();
  const captainName = normalizedName(authResult.user.user_metadata?.full_name || authResult.user.user_metadata?.name || authResult.user.email);
  const { data: order, error: orderError } = await admin.from('commerce_orders').insert({
    organization_id: venue.organization_id,
    venue_id: series.venue_id,
    customer_id: captainCustomerId,
    user_id: userId,
    guest_token_hash: await sha256(token),
    draft_scope: `league:${season.id}`,
    guest_name: captainName || null,
    guest_email: authResult.user.email.trim().toLowerCase(),
    metadata: {
      source: 'league_team_registration',
      league_season_id: season.id,
      league_team_entry_id: reserved.team_entry_id,
      registration_request_id: registrationRequestId,
    },
  }).select('*').single();
  if (orderError || !order) {
    await admin.rpc('release_capacity_hold', { p_hold_id: reserved.hold_id, p_reason: 'league_order_create_failed' });
    throw new Error(orderError?.message || 'Kundvagnen kunde inte skapas.');
  }
  const priceMinor = Number(reserved.final_price_minor || 0);
  const baseMinor = Number(reserved.base_price_minor || priceMinor);
  const vatRate = Number(product.vat_rate || 0);
  const exVatMinor = Math.round(priceMinor / (1 + vatRate / 100));
  const { error: lineError } = await admin.from('commerce_order_lines').insert({
    id: sourceLineId,
    commerce_order_id: order.id,
    product_id: product.id,
    product_key: product.product_key,
    product_name: `${series.name} · Lagplats`,
    commerce_kind: 'participation',
    quantity: 1,
    unit_price_minor: priceMinor,
    discount_minor: 0,
    line_total_inc_vat_minor: priceMinor,
    line_total_ex_vat_minor: exVatMinor,
    vat_rate: vatRate,
    vat_amount_minor: priceMinor - exVatMinor,
    source_type: 'league_team_entry',
    source_id: reserved.team_entry_id,
    fulfillment_type: 'participation',
    activity_series_id: series.id,
    league_team_entry_id: reserved.team_entry_id,
    capacity_hold_id: reserved.hold_id,
    resolver_snapshot: {
      scope: 'league_team_entry',
      scope_type: 'league_season',
      purchase_kind: 'league_team',
      league_season_id: season.id,
      league_team_entry_id: reserved.team_entry_id,
      base_team_price_minor: baseMinor,
      final_price_minor: priceMinor,
      pricing_reason: reserved.applied_price_type,
      regular_price_minor: reserved.regular_price_minor,
      regular_price_type: reserved.regular_price_type,
      early_bird_remaining: reserved.early_bird_remaining,
      team_capacity: reserved.team_capacity,
      team_fill_before: reserved.team_fill_before,
      team_fill_at_reservation: reserved.allocation_position,
      allocation_position: reserved.allocation_position,
      early_bird_allocation_position: reserved.early_bird_allocation_position,
      membership_pricing_applied: reserved.applied_price_type === 'membership_tier_pricing',
      membership_id: reserved.regular_price_type === 'membership_tier_pricing' ? reserved.membership_id : null,
      membership_tier_id: reserved.regular_price_type === 'membership_tier_pricing' ? reserved.membership_tier_id : null,
      membership_tier_name: reserved.regular_price_type === 'membership_tier_pricing' ? reserved.membership_tier_name : null,
      team_identity: { team_name: teamName, captain_customer_id: captainCustomerId, player_customer_id: playerCustomerId },
    },
    product_snapshot: {
      name: product.name,
      product_key: product.product_key,
      product_kind: product.product_kind,
      base_price_sek: product.base_price_sek,
      vat_rate: vatRate,
      team_place: true,
    },
    metadata: { registration_request_id: registrationRequestId },
  });
  if (lineError) {
    await admin.from('commerce_orders').delete().eq('id', order.id).eq('status', 'draft');
    await admin.rpc('release_capacity_hold', { p_hold_id: reserved.hold_id, p_reason: 'league_order_line_create_failed' });
    throw new Error(lineError.message);
  }
  const { error: attachError } = await admin.rpc('attach_league_team_commerce', {
    p_team_entry_id: reserved.team_entry_id,
    p_hold_id: reserved.hold_id,
    p_commerce_order_id: order.id,
    p_commerce_order_line_id: sourceLineId,
  });
  if (attachError) {
    await admin.from('commerce_orders').delete().eq('id', order.id).eq('status', 'draft');
    await admin.rpc('release_capacity_hold', { p_hold_id: reserved.hold_id, p_reason: 'league_commerce_attach_failed' });
    throw new Error(attachError.message);
  }
  return { order: { id: order.id }, cart_token: order.id, pricing: customerReservationPricing(reserved) };
}

async function myLeagues(admin: AdminClient, userId: string) {
  const customerId = await resolveCustomerIdForUser(admin, userId);
  if (!customerId) return { items: [] };
  const { data: memberships, error } = await admin.from('league_team_members')
    .select('id, league_season_id, team_entry_id, role, status, league_team_entries!inner(id, team_name, status, captain_customer_id, commerce_order_id), league_seasons!inner(id, activity_series_id, fixtures_published_at, activity_series!inner(id, venue_id, name, start_date, end_date, start_time, end_time, image_urls, status, venues(name, slug)))')
    .eq('customer_id', customerId).eq('status', 'active');
  if (error) throw new Error(error.message);
  const items = await Promise.all((memberships || []).map(async (membership) => {
    const season = Array.isArray(membership.league_seasons) ? membership.league_seasons[0] : membership.league_seasons;
    const series = Array.isArray(season.activity_series) ? season.activity_series[0] : season.activity_series;
    const team = Array.isArray(membership.league_team_entries) ? membership.league_team_entries[0] : membership.league_team_entries;
    const [{ data: sessions }, { data: fixtures }, { data: standings }] = await Promise.all([
      admin.from('activity_sessions').select('id, session_date, start_time, end_time').eq('series_id', series.id).eq('session_type', 'league').eq('is_active', true).gte('session_date', DateTime.now().setZone('Europe/Stockholm').toISODate()).order('session_date').limit(1),
      season.fixtures_published_at
        ? admin.from('league_fixtures').select('id, league_night_session_id, round_number, block_number, venue_court_id, team_a_entry_id, team_b_entry_id, scheduled_start_at, scheduled_end_at, status').eq('league_season_id', season.id).or(`team_a_entry_id.eq.${team.id},team_b_entry_id.eq.${team.id}`).gte('scheduled_end_at', new Date().toISOString()).in('status', ['scheduled', 'postponed']).order('scheduled_start_at').limit(10)
        : Promise.resolve({ data: [] }),
      admin.rpc('get_league_standings', { p_league_season_id: season.id }),
    ]);
    const standing = ((standings || []) as LeagueStandingRow[]).find((row) => row.team_entry_id === team.id) || null;
    const allFixtureRows = fixtures || [];
    const nextFixtureSessionId = allFixtureRows[0]?.league_night_session_id;
    const fixtureRows = nextFixtureSessionId
      ? allFixtureRows.filter((fixture) => fixture.league_night_session_id === nextFixtureSessionId)
      : [];
    const teamIds = Array.from(new Set(fixtureRows.flatMap((fixture) => [fixture.team_a_entry_id, fixture.team_b_entry_id])));
    const courtIds = Array.from(new Set(fixtureRows.map((fixture) => fixture.venue_court_id)));
    const [{ data: fixtureTeams }, { data: fixtureCourts }] = await Promise.all([
      teamIds.length ? admin.from('league_team_entries').select('id, team_name').in('id', teamIds) : Promise.resolve({ data: [] }),
      courtIds.length ? admin.from('venue_courts').select('id, name').in('id', courtIds) : Promise.resolve({ data: [] }),
    ]);
    const teamNames = new Map((fixtureTeams || []).map((row) => [row.id, row.team_name]));
    const courtNames = new Map((fixtureCourts || []).map((row) => [row.id, row.name]));
    const nextFixtures = fixtureRows.map((fixture) => ({
      ...fixture,
      opponent_team_name: teamNames.get(fixture.team_a_entry_id === team.id ? fixture.team_b_entry_id : fixture.team_a_entry_id) || null,
      court_name: courtNames.get(fixture.venue_court_id) || null,
    }));
    let nextSession = sessions?.[0] || null;
    if (fixtureRows.length > 0) {
      const firstStart = DateTime.fromISO(fixtureRows[0].scheduled_start_at).setZone('Europe/Stockholm');
      const lastEnd = DateTime.fromISO(fixtureRows[fixtureRows.length - 1].scheduled_end_at).setZone('Europe/Stockholm');
      nextSession = {
        id: nextFixtureSessionId,
        session_date: firstStart.toISODate(),
        start_time: firstStart.toFormat('HH:mm:ss'),
        end_time: lastEnd.toFormat('HH:mm:ss'),
      };
    }
    return { membership, team, season, series, next_session: nextSession, next_fixtures: nextFixtures, standing };
  }));
  return { items };
}

async function leagueHome(admin: AdminClient, venueSlug: string, userId: string | null) {
  const { data: venue, error: venueError } = await admin.from('venues').select('id').eq('slug', venueSlug).maybeSingle();
  if (venueError || !venue) throw new Error(venueError?.message || 'Venue not found');
  if (userId) {
    const mine = await myLeagues(admin, userId);
    const owned = mine.items.find((item) => item.series.venue_id === venue.id && item.team.status === 'active');
    if (owned) return { mode: 'next', item: owned };
  }
  const { data: series, error } = await admin.from('activity_series')
    .select('id').eq('venue_id', venue.id).eq('series_type', 'league').eq('status', 'active')
    .gt('registration_closes_at', new Date().toISOString()).order('start_date').limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!series) return { mode: 'none', item: null };
  const projection = await loadPublicProjection(admin, series.id, userId);
  return projection.customer_team_id ? { mode: 'none', item: null } : { mode: 'registration', item: projection };
}

async function adminProjection(admin: AdminClient, venueId: string) {
  const { data: seasons, error } = await admin.from('league_seasons')
    .select('*, activity_series!inner(id, venue_id, name, description, image_urls, status, start_date, end_date, registration_opens_at, registration_closes_at, start_time, end_time, court_ids, access_product_id, venues(slug), access_products(id, name, description, product_kind, base_price_sek, vat_rate, scarcity_mode, early_bird_price_minor, early_bird_slots, status, is_active))')
    .eq('venue_id', venueId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const [{ data: courts, error: courtError }, enriched] = await Promise.all([
    admin.from('venue_courts').select('id, name, court_number, sport_type, is_available').eq('venue_id', venueId).eq('sport_type', 'pickleball').order('court_number'),
    Promise.all((seasons || []).map(async (season) => {
      const [{ data: teams }, { data: members }, { data: sessions }, { data: fixtures }, { data: validation }, { data: standings }] = await Promise.all([
        admin.from('league_team_entries').select('id, team_name, status, captain_customer_id, payer_customer_id, commerce_order_id, commerce_order_line_id, pricing_reason, final_price_minor, activated_at').eq('league_season_id', season.id).order('created_at'),
        admin.from('league_team_members').select('id, team_entry_id, customer_id, role, status, customers(id, display_name, first_name, last_name, primary_email)').eq('league_season_id', season.id).in('status', ['pending', 'active']),
        admin.from('activity_sessions').select('id, session_date, start_time, end_time, court_ids, capacity, series_occurrence_index, is_active').eq('series_id', season.activity_series_id).eq('session_type', 'league').order('series_occurrence_index'),
        admin.from('league_fixtures').select('*').eq('league_season_id', season.id).order('round_number').order('block_number').order('venue_court_id'),
        admin.rpc('validate_league_fixtures_v1', { p_league_season_id: season.id }),
        admin.rpc('get_league_standings', { p_league_season_id: season.id }),
      ]);
      const fixtureIds = (fixtures || []).map((fixture) => fixture.id);
      const { data: results } = fixtureIds.length
        ? await admin.from('league_fixture_results').select('*').in('fixture_id', fixtureIds)
        : { data: [] };
      const orderIds = (teams || []).map((team) => team.commerce_order_id).filter(Boolean);
      const { data: orders } = orderIds.length
        ? await admin.from('commerce_orders').select('id, status, total_inc_vat_minor, paid_at, stripe_payment_intent_id').in('id', orderIds)
        : { data: [] };
      const series = Array.isArray(season.activity_series) ? season.activity_series[0] : season.activity_series;
      const lifecycleEditable = ['draft', 'active', 'paused'].includes(series?.status || '');
      const hasCompetitionOrCommercialHistory = Boolean(
        (teams || []).length || (fixtures || []).length || (results || []).length || (orders || []).length
        || season.generated_team_fingerprint || season.fixtures_published_at
      );
      const now = Date.now();
      return {
        ...season,
        teams: teams || [],
        members: members || [],
        sessions: sessions || [],
        fixtures: fixtures || [],
        results: results || [],
        orders: orders || [],
        validation,
        standings: standings || [],
        edit_policy: {
          lifecycle_editable: lifecycleEditable,
          registration_opens_editable: lifecycleEditable && new Date(series?.registration_opens_at || 0).getTime() > now,
          registration_deadline_editable: lifecycleEditable && new Date(series?.registration_closes_at || 0).getTime() > now,
          fixture_deadline_editable: lifecycleEditable && !season.fixtures_published_at
            && new Date(season.fixture_publication_deadline || 0).getTime() > now,
          pricing_editable: lifecycleEditable && new Date(series?.registration_closes_at || 0).getTime() > now,
          schedule_editable: false,
          schedule_lock_reason: hasCompetitionOrCommercialHistory
            ? 'participants_matches_or_payments_exist'
            : 'league_v1_structure_locked',
          historical_prices_frozen: Boolean((teams || []).length || (orders || []).length),
        },
      };
    })),
  ]);
  if (courtError) throw new Error(courtError.message);
  return { seasons: enriched, courts: courts || [] };
}

async function operationsProjection(admin: AdminClient, venueId: string, date: string) {
  const { data: sessions, error } = await admin.from('activity_sessions')
    .select('id, series_id, name, session_date, start_time, end_time, court_ids')
    .eq('venue_id', venueId).in('session_type', ['league', 'league_reschedule']).eq('session_date', date).eq('is_active', true);
  if (error) throw new Error(error.message);
  if (!(sessions || []).length) return { nights: [] };
  const sessionIds = (sessions || []).map((session) => session.id);
  const { data: fixtures, error: fixtureError } = await admin.from('league_fixtures')
    .select('*, league_fixture_results(*)').in('league_night_session_id', sessionIds).order('block_number').order('venue_court_id');
  if (fixtureError) throw new Error(fixtureError.message);
  const teamIds = Array.from(new Set((fixtures || []).flatMap((fixture) => [fixture.team_a_entry_id, fixture.team_b_entry_id])));
  const [{ data: teams }, { data: members }, { data: courts }] = await Promise.all([
    teamIds.length ? admin.from('league_team_entries').select('id, team_name').in('id', teamIds) : Promise.resolve({ data: [] }),
    teamIds.length ? admin.from('league_team_members').select('id, team_entry_id, customer_id, role, customers(id, display_name, first_name, last_name)').in('team_entry_id', teamIds).eq('status', 'active') : Promise.resolve({ data: [] }),
    admin.from('venue_courts').select('id, name, court_number').eq('venue_id', venueId),
  ]);
  const memberIds = (members || []).map((member) => member.id);
  const { data: registrations } = memberIds.length
    ? await admin.from('session_registrations')
      .select('id, activity_session_id, customer_id, league_team_member_id, status')
      .in('activity_session_id', sessionIds).in('league_team_member_id', memberIds)
    : { data: [] };
  const customerIds = (members || []).map((member) => member.customer_id);
  const { data: checkins } = customerIds.length ? await admin.from('venue_checkins')
    .select('id, user_id, customer_id, checked_in_at, checked_out_at').eq('venue_id', venueId)
    .eq('session_date', date).in('customer_id', customerIds).is('checked_out_at', null) : { data: [] };
  return { nights: sessions || [], fixtures: fixtures || [], teams: teams || [], members: members || [], registrations: registrations || [], checkins: checkins || [], courts: courts || [] };
}

const handler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.split('/').filter(Boolean).pop() || '';
  const admin = getServiceClient();
  try {
    const userId = await optionalUserId(req);
    if (req.method === 'GET' && path === 'public') {
      const seriesId = url.searchParams.get('seriesId') || '';
      return jsonResponse(await loadPublicProjection(admin, seriesId, userId), 200, 15);
    }
    if (req.method === 'POST' && path === 'register') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      return jsonResponse(await createLeagueCart(admin, req, body, authenticatedUserId), 201, 0);
    }
    if (req.method === 'GET' && path === 'my') {
      const authenticatedUserId = userId || await requireUserId(req);
      return jsonResponse(await myLeagues(admin, authenticatedUserId), 200, 15);
    }
    if (req.method === 'GET' && path === 'home') {
      return jsonResponse(await leagueHome(admin, url.searchParams.get('v') || 'pickla-arena-sthlm', userId), 200, 15);
    }
    if (req.method === 'GET' && path === 'admin') {
      const authenticatedUserId = userId || await requireUserId(req);
      const venueId = url.searchParams.get('venueId') || '';
      await staff(admin, authenticatedUserId, venueId);
      return jsonResponse(await adminProjection(admin, venueId), 200, 0);
    }
    if (req.method === 'GET' && path === 'operations') {
      const authenticatedUserId = userId || await requireUserId(req);
      const venueId = url.searchParams.get('venueId') || '';
      const date = url.searchParams.get('date') || DateTime.now().setZone('Europe/Stockholm').toISODate()!;
      await staff(admin, authenticatedUserId, venueId);
      return jsonResponse(await operationsProjection(admin, venueId, date), 200, 0);
    }
    if (req.method === 'POST' && path === 'resource-preview') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const resourcePlan = leagueResourcePlanInput(body);
      if (!resourcePlan) return errorResponse('Fem League-kvällar och exakt tre banor krävs för resurskontrollen.', 400);
      await requireVenueRole(admin, authenticatedUserId, resourcePlan.venueId, ['venue_admin']);
      return jsonResponse(await previewLeagueResourcePlan(admin, resourcePlan), 200, 0);
    }
    if (req.method === 'PATCH' && path === 'artwork') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const leagueSeasonId = String(body.league_season_id || '');
      if (!UUID.test(leagueSeasonId)) return errorResponse('Seriespelet kunde inte hittas.', 404);
      const { data: season, error: seasonError } = await admin.from('league_seasons')
        .select('id, venue_id, activity_series_id').eq('id', leagueSeasonId).maybeSingle();
      if (seasonError) throw new Error(seasonError.message);
      if (!season) return errorResponse('Seriespelet kunde inte hittas.', 404);
      await requireVenueRole(admin, authenticatedUserId, season.venue_id, ['venue_admin']);
      const imageUrls = cleanLeagueImageUrls(body.image_urls, season.activity_series_id);
      if (!imageUrls) return errorResponse('Använd Picklas Series-bilduppladdning.', 400);
      const { data: series, error } = await admin.from('activity_series')
        .update({ image_urls: imageUrls })
        .eq('id', season.activity_series_id).eq('venue_id', season.venue_id).eq('series_type', 'league')
        .select('id, image_urls').maybeSingle();
      if (error) throw new Error(error.message);
      if (!series) return errorResponse('Seriespelet kunde inte hittas.', 404);
      return jsonResponse(series, 200, 0);
    }
    if (req.method === 'PATCH' && path === 'catalog') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const leagueSeasonId = String(body.league_season_id || '');
      if (!UUID.test(leagueSeasonId)) return errorResponse('Seriespelet kunde inte hittas.', 404);
      const { data: season, error: seasonError } = await admin.from('league_seasons')
        .select('id, venue_id').eq('id', leagueSeasonId).maybeSingle();
      if (seasonError) throw new Error(seasonError.message);
      if (!season) return errorResponse('Seriespelet kunde inte hittas.', 404);
      await requireVenueRole(admin, authenticatedUserId, season.venue_id, ['venue_admin']);
      const { data, error } = await admin.rpc('update_league_catalog_v1', {
        p_league_season_id: leagueSeasonId,
        p_name: String(body.name || '').trim(),
        p_description: String(body.description || '').trim() || null,
        p_registration_opens_at: body.registration_opens_at,
        p_registration_deadline: body.registration_deadline,
        p_fixture_publication_deadline: body.fixture_publication_deadline,
        p_base_price_minor: Number(body.base_price_minor),
        p_early_bird_price_minor: body.early_bird_price_minor == null ? null : Number(body.early_bird_price_minor),
        p_early_bird_slots: body.early_bird_slots == null ? null : Number(body.early_bird_slots),
        p_actor_user_id: authenticatedUserId,
      }).maybeSingle();
      if (error) {
        const [message, status] = leagueCatalogError(error.message);
        return errorResponse(message, status);
      }
      return jsonResponse({ edit: data }, 200, 0);
    }
    if (req.method === 'POST' && path === 'create') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const venueId = String(body.venue_id || '');
      await requireVenueRole(admin, authenticatedUserId, venueId, ['venue_admin']);
      const resourcePlan = leagueResourcePlanInput(body);
      const { data, error } = await admin.rpc('create_league_season_v1', {
        p_venue_id: venueId,
        p_name: normalizedName(body.name),
        p_description: String(body.description || '').trim() || null,
        p_image_urls: [],
        p_night_dates: body.night_dates,
        p_court_ids: body.court_ids,
        p_registration_opens_at: body.registration_opens_at,
        p_registration_deadline: body.registration_deadline,
        p_fixture_publication_deadline: body.fixture_publication_deadline,
        p_base_price_minor: Number(body.base_price_minor),
        p_vat_rate: Number(body.vat_rate),
        p_early_bird_price_minor: body.early_bird_price_minor == null ? null : Number(body.early_bird_price_minor),
        p_early_bird_slots: body.early_bird_slots == null ? null : Number(body.early_bird_slots),
        p_publish: body.publish === true,
        p_actor_user_id: authenticatedUserId,
      }).maybeSingle();
      if (error) {
        if (error.message.includes('managed_series_resource_conflict')) {
          let concurrentPreview: LeagueResourcePreview | null = null;
          if (resourcePlan) {
            try {
              concurrentPreview = await previewLeagueResourcePlan(admin, resourcePlan);
            } catch (previewError) {
              console.error('league_resource_conflict_preview_failed', previewError);
            }
          }
          return leagueConflictResponse(concurrentPreview);
        }
        throw new Error(error.message);
      }
      return jsonResponse({ season: data }, 201, 0);
    }
    if (req.method === 'POST' && ['publish-offer', 'generate-fixtures', 'publish-fixtures'].includes(path)) {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const seasonId = String(body.league_season_id || '');
      const { data: season } = await admin.from('league_seasons').select('venue_id').eq('id', seasonId).maybeSingle();
      if (!season) throw new Error('League season not found');
      await requireVenueRole(admin, authenticatedUserId, season.venue_id, ['venue_admin']);
      const rpc = path === 'publish-offer' ? 'publish_league_offer_v1'
        : path === 'generate-fixtures' ? 'generate_league_fixtures_v1' : 'publish_league_fixtures_v1';
      const { data, error } = await admin.rpc(rpc, {
        p_league_season_id: seasonId,
        p_actor_user_id: authenticatedUserId,
      });
      if (error) throw new Error(error.message);
      return jsonResponse({ data }, 200, 0);
    }
    if (req.method === 'POST' && path === 'result') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const fixtureId = String(body.fixture_id || '');
      const { data: fixture } = await admin.from('league_fixtures').select('league_seasons!inner(venue_id)').eq('id', fixtureId).maybeSingle();
      const linkedSeason = Array.isArray(fixture?.league_seasons) ? fixture?.league_seasons[0] : fixture?.league_seasons;
      if (!linkedSeason?.venue_id) throw new Error('Fixture not found');
      await staff(admin, authenticatedUserId, linkedSeason.venue_id);
      const { data, error } = await admin.rpc('save_league_fixture_result_v1', {
        p_fixture_id: fixtureId,
        p_state: body.state,
        p_outcome_type: body.outcome_type,
        p_sets: body.sets || [],
        p_walkover_winner_team_id: body.walkover_winner_team_id || null,
        p_expected_version: Number(body.expected_version || 0),
        p_request_id: requestId(req, body),
        p_actor_user_id: authenticatedUserId,
      }).maybeSingle();
      if (error) throw new Error(error.message);
      return jsonResponse({ result: data }, 200, 0);
    }
    if (req.method === 'POST' && path === 'postpone') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const { data, error } = await admin.rpc('set_league_fixture_postponed_v1', {
        p_fixture_id: body.fixture_id,
        p_actor_user_id: authenticatedUserId,
        p_request_id: requestId(req, body),
        p_reason: String(body.reason || '').trim(),
      }).maybeSingle();
      if (error) throw new Error(error.message);
      return jsonResponse({ fixture: data }, 200, 0);
    }
    if (req.method === 'POST' && path === 'reschedule-fixture') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const { data, error } = await admin.rpc('reschedule_league_fixture_v1', {
        p_fixture_id: body.fixture_id,
        p_scheduled_start_at: body.scheduled_start_at,
        p_venue_court_id: body.venue_court_id,
        p_actor_user_id: authenticatedUserId,
        p_request_id: requestId(req, body),
        p_reason: String(body.reason || '').trim(),
      }).maybeSingle();
      if (error) throw new Error(error.message);
      return jsonResponse({ fixture: data }, 200, 0);
    }
    if (req.method === 'POST' && path === 'reschedule-night') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const { data, error } = await admin.rpc('reschedule_league_night_v1', {
        p_league_night_session_id: body.league_night_session_id,
        p_new_date: body.new_date,
        p_actor_user_id: authenticatedUserId,
        p_request_id: requestId(req, body),
        p_reason: String(body.reason || '').trim(),
      }).maybeSingle();
      if (error) throw new Error(error.message);
      return jsonResponse({ session: data }, 200, 0);
    }
    if (req.method === 'POST' && path === 'replace-player') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const { data: entry } = await admin.from('league_team_entries').select('league_seasons!inner(venue_id)').eq('id', body.team_entry_id).maybeSingle();
      const linkedSeason = Array.isArray(entry?.league_seasons) ? entry?.league_seasons[0] : entry?.league_seasons;
      if (!linkedSeason?.venue_id) throw new Error('Team not found');
      await staff(admin, authenticatedUserId, linkedSeason.venue_id);
      const email = validEmail(body.player_email);
      const name = normalizedName(body.player_name);
      if (!email || !name) throw new Error('Namn och e-post krävs.');
      const newCustomerId = await resolveOrCreateGuestCustomerByEmail(admin, { venueId: linkedSeason.venue_id, email, displayName: name, source: 'league_roster_replacement' });
      const { data, error } = await admin.rpc('replace_league_player', {
        p_team_entry_id: body.team_entry_id,
        p_new_customer_id: newCustomerId,
        p_actor_user_id: authenticatedUserId,
        p_request_id: requestId(req, body),
        p_reason: String(body.reason || '').trim(),
        p_age_confirmed: body.age_confirmed === true,
      }).maybeSingle();
      if (error) throw new Error(error.message);
      return jsonResponse({ member: data }, 200, 0);
    }
    if (req.method === 'POST' && path === 'rename-team') {
      const authenticatedUserId = userId || await requireUserId(req);
      const body = await req.json();
      const { data: entry } = await admin.from('league_team_entries').select('league_seasons!inner(venue_id)').eq('id', body.team_entry_id).maybeSingle();
      const linkedSeason = Array.isArray(entry?.league_seasons) ? entry?.league_seasons[0] : entry?.league_seasons;
      if (!linkedSeason?.venue_id) throw new Error('Team not found');
      await requireVenueRole(admin, authenticatedUserId, linkedSeason.venue_id, ['venue_admin']);
      const { data, error } = await admin.rpc('rename_league_team', {
        p_team_entry_id: body.team_entry_id,
        p_team_name: normalizedName(body.team_name, 40),
        p_actor_user_id: authenticatedUserId,
        p_request_id: requestId(req, body),
        p_reason: String(body.reason || '').trim(),
      }).maybeSingle();
      if (error) throw new Error(error.message);
      return jsonResponse({ team: data }, 200, 0);
    }
    return errorResponse('Not found', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'League request failed';
    const status = message === 'Unauthorized' ? 401
      : message.startsWith('Forbidden') || message.includes('staff_required') ? 403
      : message.includes('not found') || message.includes('hittas') ? 404
      : message.includes('full') || message.includes('fullt') || message.includes('conflict') || message.includes('already') || message.includes('locked') ? 409
      : 400;
    return errorResponse(message, status);
  }
};

Deno.serve(handler);
