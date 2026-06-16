import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import {
  assertVenueAdmin,
  buildFollowups,
  buildFollowupsFromSentAt,
  buildOfferHtml,
  buildOfferPayload,
  buildOfferPdfBytes,
  buildSalesDraft,
  emailHtmlFromText,
  EVENT_PACKAGES,
  leadActivity,
} from '../_shared/event_agents.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const RESEND_FROM = Deno.env.get('RESEND_FROM') || 'Pickla <hello@playpickla.com>';
const RESEND_REPLY_DOMAIN = (Deno.env.get('RESEND_INBOUND_DOMAIN') || 'playpickla.com')
  .replace(/^reply\.playpickla\.com$/i, 'playpickla.com');
const DEFAULT_DEPOSIT_PERCENT = 20;

function eventReplyAddress(eventId: string) {
  return `event-${eventId}@${RESEND_REPLY_DOMAIN}`;
}

function safeOrigin(req: Request) {
  const origin = req.headers.get('origin') || Deno.env.get('PUBLIC_SITE_URL') || 'https://www.playpickla.com';
  if (!/^https:\/\/([a-z0-9-]+\.)?playpickla\.com$/i.test(origin) && !/^http:\/\/localhost:\d+$/i.test(origin)) {
    return 'https://www.playpickla.com';
  }
  return origin;
}

function normalizeTime(value?: string | null) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function normalizeDate(value?: string | null) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) return match[1];
  const parsed = DateTime.fromISO(raw, { zone: 'utc' });
  return parsed.isValid ? parsed.setZone('Europe/Stockholm').toISODate() : null;
}

function parsePositiveAmount(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function eventDateTimeRange(eventRow: any) {
  const date = normalizeDate(eventRow?.start_date);
  const startTime = normalizeTime(eventRow?.start_time);
  if (!date || !startTime) return null;
  const endTime = normalizeTime(eventRow?.end_time);
  const start = DateTime.fromISO(`${date}T${startTime}:00`, { zone: 'Europe/Stockholm' });
  const end = endTime
    ? DateTime.fromISO(`${date}T${endTime}:00`, { zone: 'Europe/Stockholm' })
    : start.plus({ hours: 2 });
  if (!start.isValid || !end.isValid || end <= start) return null;
  return { start, end, startUtc: start.toUTC().toISO(), endUtc: end.toUTC().toISO() };
}

function overlapTime(aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null) {
  const startA = normalizeTime(aStart);
  const endA = normalizeTime(aEnd) || (startA ? DateTime.fromISO(`2026-01-01T${startA}:00`).plus({ hours: 2 }).toFormat('HH:mm') : null);
  const startB = normalizeTime(bStart);
  const endB = normalizeTime(bEnd) || (startB ? DateTime.fromISO(`2026-01-01T${startB}:00`).plus({ hours: 2 }).toFormat('HH:mm') : null);
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && endA > startB;
}

async function checkEventResourceConflicts(admin: any, eventRow: any) {
  const range = eventDateTimeRange(eventRow);
  if (!range) {
    return {
      ok: false,
      reason: 'Eventet behöver datum, starttid och rimlig sluttid innan bokning kan bekräftas.',
      conflicts: [],
      courtIds: [],
    };
  }

  const { data: eventCourts } = await admin
    .from('event_courts')
    .select('venue_court_id, venue_courts(id, name, court_number)')
    .eq('event_id', eventRow.id);
  const courtIds = (eventCourts || []).map((row: any) => row.venue_court_id).filter(Boolean);
  if (courtIds.length === 0) {
    return { ok: true, reason: null, conflicts: [], courtIds: [] };
  }

  const conflicts: any[] = [];
  const eventDate = normalizeDate(eventRow.start_date);
  const { data: bookingRows } = await admin
    .from('bookings')
    .select('id, booking_ref, venue_court_id, start_time, end_time, status, venue_courts(name, court_number)')
    .eq('venue_id', eventRow.venue_id)
    .in('venue_court_id', courtIds)
    .in('status', ['confirmed', 'checked_in', 'active'])
    .lt('start_time', range.endUtc)
    .gt('end_time', range.startUtc);

  for (const row of bookingRows || []) {
    conflicts.push({
      type: 'booking',
      id: row.id,
      label: row.booking_ref || 'Bokning',
      court: row.venue_courts?.name || row.venue_courts?.court_number || row.venue_court_id,
      start_time: row.start_time,
      end_time: row.end_time,
    });
  }

  const { data: eventRows } = await admin
    .from('events')
    .select('id, name, display_name, start_date, start_time, end_time, planning_status, event_courts(venue_court_id, venue_courts(name, court_number))')
    .eq('venue_id', eventRow.venue_id)
    .neq('id', eventRow.id)
    .not('planning_status', 'in', '("cancelled","done")');

  for (const other of eventRows || []) {
    if (eventDate && normalizeDate(other.start_date) !== eventDate) continue;
    if (!overlapTime(eventRow.start_time, eventRow.end_time, other.start_time, other.end_time)) continue;
    for (const court of other.event_courts || []) {
      if (!courtIds.includes(court.venue_court_id)) continue;
      conflicts.push({
        type: 'event',
        id: other.id,
        label: other.display_name || other.name || 'Event',
        court: court.venue_courts?.name || court.venue_court_id,
        start_time: other.start_time,
        end_time: other.end_time,
      });
    }
  }

  return {
    ok: conflicts.length === 0,
    reason: conflicts.length ? 'Valda resurser är upptagna.' : null,
    conflicts,
    courtIds,
  };
}

function localDatesBetween(startUtc: string, endUtc: string) {
  const start = DateTime.fromISO(startUtc, { zone: 'utc' }).setZone('Europe/Stockholm').startOf('day');
  const end = DateTime.fromISO(endUtc, { zone: 'utc' }).setZone('Europe/Stockholm').minus({ millisecond: 1 }).startOf('day');
  const dates: string[] = [];
  for (let cursor = start; cursor <= end && dates.length < 45; cursor = cursor.plus({ days: 1 })) {
    dates.push(cursor.toISODate()!);
  }
  return dates;
}

function occurrenceOverrideKey(activitySessionId: string, sessionDate: string) {
  return `${activitySessionId}:${sessionDate}`;
}

async function activityRegistrationCounts(admin: any, sessionIds: string[], startDate: string, endDate: string) {
  const counts = new Map<string, number>();
  if (!sessionIds.length || !startDate || !endDate) return counts;

  const { data, error } = await admin
    .from('session_registrations')
    .select('activity_session_id, session_date, status')
    .in('activity_session_id', sessionIds)
    .gte('session_date', startDate)
    .lte('session_date', endDate);
  if (error) throw new Error(error.message);

  for (const row of data || []) {
    if (row.status === 'cancelled') continue;
    const key = occurrenceOverrideKey(row.activity_session_id, row.session_date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function activityOverrideMap(admin: any, venueId: string, sessionIds: string[], startDate: string, endDate: string) {
  const overrides = new Map<string, any>();
  if (!sessionIds.length || !startDate || !endDate) return overrides;

  const { data, error } = await admin
    .from('activity_session_overrides')
    .select('id, activity_session_id, session_date, status, reason')
    .eq('venue_id', venueId)
    .in('activity_session_id', sessionIds)
    .gte('session_date', startDate)
    .lte('session_date', endDate);
  if (error) throw new Error(error.message);

  for (const row of data || []) {
    overrides.set(occurrenceOverrideKey(row.activity_session_id, row.session_date), row);
  }
  return overrides;
}

async function analyzeEventCapacityImpact(admin: any, eventRow: any, courtIds: string[], startUtc: string, endUtc: string) {
  if (!courtIds.length) {
    return {
      bookings: { count: 0, samples: [] },
      activities: { count: 0, registrations_count: 0, samples: [], limited: false },
    };
  }

  let bookingsQuery = admin
    .from('bookings')
    .select('id, booking_ref, start_time, end_time, status, venue_court_id, venue_courts(id, name)', { count: 'exact' })
    .eq('venue_id', eventRow.venue_id)
    .neq('status', 'cancelled')
    .lt('start_time', endUtc)
    .gt('end_time', startUtc)
    .order('start_time', { ascending: true })
    .limit(8);
  if (courtIds.length) bookingsQuery = bookingsQuery.in('venue_court_id', courtIds);
  const { data: bookings, count: bookingCount, error: bookingsError } = await bookingsQuery;
  if (bookingsError) throw new Error(bookingsError.message);

  const dates = localDatesBetween(startUtc, endUtc);
  const startMs = DateTime.fromISO(startUtc, { zone: 'utc' }).toMillis();
  const endMs = DateTime.fromISO(endUtc, { zone: 'utc' }).toMillis();
  const { data: sessions, error: sessionsError } = await admin
    .from('activity_sessions')
    .select('id, name, session_type, session_date, recurrence_days, start_time, end_time, court_ids, is_active, publish_status')
    .eq('venue_id', eventRow.venue_id)
    .eq('is_active', true)
    .limit(500);
  if (sessionsError) throw new Error(sessionsError.message);

  const courtSet = new Set(courtIds);
  const activitySamples: any[] = [];
  let activityCount = 0;
  for (const session of sessions || []) {
    const sessionCourtIds = Array.isArray(session.court_ids) ? session.court_ids.map((id: unknown) => String(id)) : [];
    if (courtIds.length && sessionCourtIds.length && !sessionCourtIds.some((id: string) => courtSet.has(id))) continue;

    for (const date of dates) {
      const isConcrete = session.session_date === date;
      const isRecurring = !session.session_date && Array.isArray(session.recurrence_days)
        && session.recurrence_days.includes(DateTime.fromISO(date, { zone: 'Europe/Stockholm' }).weekday % 7);
      if (!isConcrete && !isRecurring) continue;

      const occurrenceStart = DateTime.fromISO(`${date}T${String(session.start_time).slice(0, 5)}:00`, { zone: 'Europe/Stockholm' }).toUTC();
      let occurrenceEnd = DateTime.fromISO(`${date}T${String(session.end_time).slice(0, 5)}:00`, { zone: 'Europe/Stockholm' }).toUTC();
      if (!occurrenceStart.isValid || !occurrenceEnd.isValid) continue;
      if (occurrenceEnd <= occurrenceStart) occurrenceEnd = occurrenceEnd.plus({ days: 1 });
      if (occurrenceStart.toMillis() < endMs && occurrenceEnd.toMillis() > startMs) {
        activityCount += 1;
        if (activitySamples.length < 12) {
          activitySamples.push({
            id: session.id,
            activity_session_id: session.id,
            name: session.name,
            session_type: session.session_type,
            session_date: date,
            start_time: String(session.start_time).slice(0, 5),
            end_time: String(session.end_time).slice(0, 5),
          });
        }
      }
    }
  }

  const sampleSessionIds = activitySamples.map((sample) => sample.activity_session_id);
  const startDate = dates[0] || '';
  const endDate = dates[dates.length - 1] || '';
  const [registrationCounts, overrides] = await Promise.all([
    activityRegistrationCounts(admin, sampleSessionIds, startDate, endDate),
    activityOverrideMap(admin, eventRow.venue_id, sampleSessionIds, startDate, endDate),
  ]);
  let registrationsCount = 0;
  for (const sample of activitySamples) {
    const key = occurrenceOverrideKey(sample.activity_session_id, sample.session_date);
    const count = registrationCounts.get(key) || 0;
    const override = overrides.get(key);
    registrationsCount += count;
    sample.registrations_count = count;
    sample.override_status = override?.status || null;
    sample.activity_session_override_id = override?.id || null;
  }

  return {
    bookings: {
      count: bookingCount ?? (bookings || []).length,
      samples: bookings || [],
    },
    activities: {
      count: activityCount,
      registrations_count: registrationsCount,
      samples: activitySamples,
      limited: dates.length >= 45,
    },
  };
}

async function selectedEventCourtResources(admin: any, eventRow: any) {
  const { data: allocations, error: allocationError } = await admin
    .from('event_resource_allocations')
    .select('id, venue_id, event_id, resource_catalog_id, venue_court_id, resource_type, name, status')
    .eq('venue_id', eventRow.venue_id)
    .eq('event_id', eventRow.id)
    .in('status', ['proposed', 'confirmed']);
  if (allocationError) throw new Error(allocationError.message);

  const catalogIds = uniqueStrings((allocations || []).map((row: any) => row.resource_catalog_id).filter(Boolean));
  const { data: catalogRows, error: catalogError } = catalogIds.length
    ? await admin
      .from('event_resource_catalog')
      .select('id, name, resource_type, venue_court_id, is_bookable, is_active')
      .eq('venue_id', eventRow.venue_id)
      .eq('resource_type', 'court')
      .eq('is_bookable', true)
      .eq('is_active', true)
      .in('id', catalogIds)
    : { data: [], error: null };
  if (catalogError) throw new Error(catalogError.message);

  const catalogById = new Map((catalogRows || []).map((row: any) => [row.id, row]));
  let resources = (allocations || [])
    .map((allocation: any) => {
      const catalog = catalogById.get(allocation.resource_catalog_id);
      if (!catalog?.venue_court_id) return null;
      return {
        allocation_id: allocation.id,
        resource_catalog_id: catalog.id,
        venue_court_id: catalog.venue_court_id,
        name: catalog.name || allocation.name,
      };
    })
    .filter(Boolean);

  if (resources.length === 0) {
    const { data: eventCourts, error: courtsError } = await admin
      .from('event_courts')
      .select('venue_court_id')
      .eq('event_id', eventRow.id);
    if (courtsError) throw new Error(courtsError.message);

    const courtIds = uniqueStrings((eventCourts || []).map((row: any) => row.venue_court_id).filter(Boolean));
    if (courtIds.length) {
      const { data: fallbackCatalog, error: fallbackError } = await admin
        .from('event_resource_catalog')
        .select('id, name, venue_court_id')
        .eq('venue_id', eventRow.venue_id)
        .eq('resource_type', 'court')
        .eq('is_bookable', true)
        .eq('is_active', true)
        .in('venue_court_id', courtIds);
      if (fallbackError) throw new Error(fallbackError.message);
      resources = (fallbackCatalog || []).map((row: any) => ({
        allocation_id: null,
        resource_catalog_id: row.id,
        venue_court_id: row.venue_court_id,
        name: row.name,
      }));
    }
  }

  const seen = new Set<string>();
  return {
    allocations: allocations || [],
    resources: resources.filter((row: any) => {
      if (seen.has(row.resource_catalog_id)) return false;
      seen.add(row.resource_catalog_id);
      return true;
    }),
  };
}

async function createOrUpdateEventResourceBlocks(admin: any, eventRow: any, lead: any, offer: any, userId: string) {
  const range = eventDateTimeRange(eventRow);
  if (!range?.startUtc || !range?.endUtc) throw new Error('Eventet behöver datum, starttid och sluttid innan resurser kan blockeras.');

  const { allocations, resources } = await selectedEventCourtResources(admin, eventRow);
  const resourceIds = resources.map((row: any) => row.resource_catalog_id);
  const courtIds = resources.map((row: any) => row.venue_court_id).filter(Boolean);

  const { data: existingBlocks, error: existingError } = await admin
    .from('event_resource_blocks')
    .select('id, resource_catalog_id')
    .eq('venue_id', eventRow.venue_id)
    .eq('event_id', eventRow.id)
    .eq('event_offer_id', offer.id);
  if (existingError) throw new Error(existingError.message);

  const existingByResource = new Map((existingBlocks || []).map((row: any) => [row.resource_catalog_id, row]));
  const keepIds = new Set(resourceIds);
  const blocksToInsert = [];
  const blockIdsToUpdate: string[] = [];
  const blockIdsToRelease = (existingBlocks || [])
    .filter((row: any) => !keepIds.has(row.resource_catalog_id))
    .map((row: any) => row.id);

  for (const resource of resources) {
    const existing = existingByResource.get(resource.resource_catalog_id);
    if (existing?.id) {
      blockIdsToUpdate.push(existing.id);
      continue;
    }
    blocksToInsert.push({
      venue_id: eventRow.venue_id,
      resource_catalog_id: resource.resource_catalog_id,
      event_id: eventRow.id,
      event_lead_id: lead.id,
      event_offer_id: offer.id,
      title: offer.title || eventRow.display_name || eventRow.name || 'Event',
      reason: 'event',
      status: 'confirmed',
      starts_at: range.startUtc,
      ends_at: range.endUtc,
      blocks_public_booking: true,
      created_by: userId,
      metadata: {
        event_id: eventRow.id,
        event_lead_id: lead.id,
        event_offer_id: offer.id,
        event_resource_allocation_id: resource.allocation_id,
        venue_court_id: resource.venue_court_id,
        source: 'event_confirm_booking',
      },
    });
  }

  if (blockIdsToUpdate.length) {
    const { error } = await admin
      .from('event_resource_blocks')
      .update({
        event_lead_id: lead.id,
        title: offer.title || eventRow.display_name || eventRow.name || 'Event',
        reason: 'event',
        status: 'confirmed',
        starts_at: range.startUtc,
        ends_at: range.endUtc,
        blocks_public_booking: true,
      })
      .eq('venue_id', eventRow.venue_id)
      .in('id', blockIdsToUpdate);
    if (error) throw new Error(error.message);
  }

  if (blockIdsToRelease.length) {
    const { error } = await admin
      .from('event_resource_blocks')
      .update({ status: 'released', blocks_public_booking: false })
      .eq('venue_id', eventRow.venue_id)
      .in('id', blockIdsToRelease);
    if (error) throw new Error(error.message);
  }

  if (blocksToInsert.length) {
    const { error } = await admin.from('event_resource_blocks').insert(blocksToInsert);
    if (error) throw new Error(error.message);
  }

  const allocationIds = (allocations || []).map((row: any) => row.id).filter(Boolean);
  if (allocationIds.length) {
    const { error } = await admin
      .from('event_resource_allocations')
      .update({ status: 'confirmed', start_at: range.startUtc, end_at: range.endUtc })
      .eq('venue_id', eventRow.venue_id)
      .eq('event_id', eventRow.id)
      .in('id', allocationIds);
    if (error) throw new Error(error.message);
  }

  const { data: blocks, error: blockFetchError } = await admin
    .from('event_resource_blocks')
    .select('id, resource_catalog_id, event_id, event_lead_id, event_offer_id, title, reason, status, starts_at, ends_at, blocks_public_booking, event_resource_catalog(id, name, resource_type, venue_court_id)')
    .eq('venue_id', eventRow.venue_id)
    .eq('event_id', eventRow.id)
    .eq('event_offer_id', offer.id)
    .in('status', ['hold', 'confirmed'])
    .order('starts_at', { ascending: true });
  if (blockFetchError) throw new Error(blockFetchError.message);

  const impact = await analyzeEventCapacityImpact(admin, eventRow, courtIds, range.startUtc, range.endUtc);
  return {
    allocations: {
      selected_count: allocations.length,
      confirmed_count: allocationIds.length,
    },
    resources,
    blocks: blocks || [],
    created_count: blocksToInsert.length,
    updated_count: blockIdsToUpdate.length,
    released_count: blockIdsToRelease.length,
    impact,
  };
}

function fallbackOfferCatalog(resources: any[] = []) {
  const templates = Object.values(EVENT_PACKAGES).map((pack: any, index) => ({
    id: null,
    template_key: pack.key,
    title: pack.title,
    subtitle: pack.subtitle,
    description: pack.pitch,
    default_price_per_person: pack.pricePerPerson,
    min_price_per_person: null,
    max_price_per_person: null,
    payload: {
      included: pack.includes,
      agenda: pack.agenda,
    },
    sort_order: (index + 1) * 10,
  }));
  const items = Object.values(EVENT_PACKAGES).flatMap((pack: any, packageIndex) =>
    pack.includes.map((title: string, index: number) => ({
      id: `${pack.key}-${index}`,
      venue_id: null,
      template_id: null,
      item_type: /pizza|dryck|lunch/i.test(title) ? 'food_drink' : /coach|värd/i.test(title) ? 'staff' : 'activity',
      title,
      description: null,
      included_by_default: true,
      sort_order: packageIndex * 100 + index,
    }))
  );
  return { templates, items, resources, fallback: true };
}

async function fetchOfferCatalog(admin: any, venueId: string) {
  const [{ data: templates, error: templateErr }, { data: items, error: itemErr }, { data: resources, error: resourceErr }] = await Promise.all([
    admin.from('event_offer_templates')
      .select('id, venue_id, template_key, title, subtitle, description, default_price_per_person, min_price_per_person, max_price_per_person, payload, sort_order')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    admin.from('event_offer_items')
      .select('id, venue_id, template_id, item_type, title, description, unit_price, unit, included_by_default, sort_order')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    admin.from('event_resource_catalog')
      .select('id, venue_id, resource_type, name, description, venue_court_id, venue_staff_id, capacity, unit, default_unit_price, is_bookable, sort_order')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('resource_type', { ascending: true })
      .order('sort_order', { ascending: true }),
  ]);
  if (!templateErr && !itemErr && !resourceErr) {
    return { templates: templates || [], items: items || [], resources: resources || [], fallback: false };
  }

  const { data: courts } = await admin
    .from('venue_courts')
    .select('id, name, sport_type, court_number')
    .eq('venue_id', venueId)
    .eq('is_available', true)
    .order('sport_type', { ascending: true })
    .order('court_number', { ascending: true });
  const fallbackResources = (courts || []).map((court: any) => ({
    id: `court-${court.id}`,
    venue_id: venueId,
    resource_type: 'court',
    name: court.name,
    description: court.sport_type,
    venue_court_id: court.id,
    venue_staff_id: null,
    capacity: null,
    unit: 'event',
    default_unit_price: 0,
    is_bookable: true,
    sort_order: court.court_number || 100,
  }));
  return fallbackOfferCatalog(fallbackResources);
}

function uniqueStrings(values: unknown[]) {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

async function applyOfferResourcePlan(admin: any, lead: any, offerConfig: any) {
  const selectedIds = Array.isArray(offerConfig?.selected_resource_ids)
    ? offerConfig.selected_resource_ids.map((id: unknown) => String(id)).filter(Boolean)
    : [];
  if (!lead.event_id || selectedIds.length === 0) {
    return { resources: uniqueStrings(offerConfig?.resources || []), selectedResources: [] };
  }

  const fallbackCourtIds = uniqueStrings(selectedIds
    .filter((id) => id.startsWith('court-'))
    .map((id) => id.replace(/^court-/, '')));
  if (fallbackCourtIds.length > 0) {
    const { data: courts } = await admin
      .from('venue_courts')
      .select('id, name, sport_type')
      .eq('venue_id', lead.venue_id)
      .in('id', fallbackCourtIds);
    if (courts?.length) {
      await admin.from('event_courts').delete().eq('event_id', lead.event_id);
      await admin.from('event_courts').insert(courts.map((court: any) => ({
        event_id: lead.event_id,
        venue_court_id: court.id,
      })));
      return {
        resources: uniqueStrings([...(offerConfig?.resources || []), ...courts.map((court: any) => court.name)]),
        selectedResources: courts.map((court: any) => ({
          id: `court-${court.id}`,
          resource_type: 'court',
          name: court.name,
          venue_court_id: court.id,
        })),
      };
    }
  }

  const { data: catalogRows, error } = await admin
    .from('event_resource_catalog')
    .select('id, venue_id, resource_type, name, description, venue_court_id, venue_staff_id')
    .eq('venue_id', lead.venue_id)
    .in('id', selectedIds);
  if (error) {
    return { resources: uniqueStrings(offerConfig?.resources || []), selectedResources: [] };
  }

  const selectedResources = catalogRows || [];
  const courtIds = uniqueStrings(selectedResources.map((row: any) => row.venue_court_id).filter(Boolean));
  const nonCourtNames = uniqueStrings(selectedResources.filter((row: any) => row.resource_type !== 'court').map((row: any) => row.name));
  const staffNames = uniqueStrings(selectedResources.filter((row: any) => row.resource_type === 'staff').map((row: any) => row.name));
  const resourceNames = uniqueStrings([...(offerConfig?.resources || []), ...selectedResources.map((row: any) => row.name)]);

  if (courtIds.length > 0) {
    await admin.from('event_courts').delete().eq('event_id', lead.event_id);
    await admin.from('event_courts').insert(courtIds.map((venueCourtId) => ({
      event_id: lead.event_id,
      venue_court_id: venueCourtId,
    })));
  }

  const eventUpdate: Record<string, unknown> = { resources: nonCourtNames };
  if (staffNames.length) eventUpdate.staffing = staffNames.join(', ');
  await admin.from('events').update(eventUpdate).eq('id', lead.event_id);

  const { data: eventRow } = await admin.from('events').select('start_date, start_time, end_time').eq('id', lead.event_id).maybeSingle();
  const range = eventDateTimeRange(eventRow || {});
  try {
    await admin.from('event_resource_allocations')
      .delete()
      .eq('event_id', lead.event_id)
      .eq('status', 'proposed');
    await admin.from('event_resource_allocations').insert(selectedResources.map((row: any) => ({
      venue_id: lead.venue_id,
      event_id: lead.event_id,
      resource_catalog_id: row.id,
      venue_court_id: row.venue_court_id || null,
      venue_staff_id: row.venue_staff_id || null,
      resource_type: row.resource_type,
      name: row.name,
      quantity: 1,
      start_at: range?.startUtc || null,
      end_at: range?.endUtc || null,
      status: 'proposed',
    })));
  } catch (_) {
    // Resource allocations are planning metadata; event_courts above remains the blocking inventory source.
  }

  return { resources: resourceNames, selectedResources };
}

function buildBookingConfirmationText({ lead, offer, eventRow, depositUrl, depositAmount }: any) {
  const date = normalizeDate(eventRow.start_date) || normalizeDate(lead.preferred_date) || 'enligt överenskommelse';
  const time = eventRow.start_time ? `${String(eventRow.start_time).slice(0, 5)}${eventRow.end_time ? `-${String(eventRow.end_time).slice(0, 5)}` : ''}` : 'tid enligt överenskommelse';
  return [
    `Hej ${lead.contact_name || ''},`,
    '',
    'Tack! Vi har nu lagt upp er bokning hos Pickla.',
    '',
    `Event: ${offer.title || lead.company_name || lead.contact_name}`,
    `Datum/tid: ${date} · ${time}`,
    `Antal personer: ${lead.participants_count || 'enligt offert'}`,
    `Totalpris enligt offert: ${Number(offer.total_price || lead.estimated_value || 0).toLocaleString('sv-SE')} kr`,
    `Handpenning: ${Number(depositAmount || 0).toLocaleString('sv-SE')} kr`,
    '',
    'Säkra bokningen genom att betala handpenningen här:',
    depositUrl,
    '',
    'När handpenningen är betald är bokningen bindande enligt villkoren i offerten. Slutbetalning hanteras enligt överenskommelse.',
    '',
    'Hälsningar,',
    'Pickla Event',
  ].join('\n');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sendResendEmail({
  to,
  subject,
  html,
  replyTo,
  attachments,
}: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string }>;
}) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) throw new Error('Missing RESEND_API_KEY');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(attachments?.length ? { attachments } : {}),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || 'Resend email failed');
  return data;
}

async function createDepositCheckout({ req, stripe, lead, offer, eventRow, depositAmountSek }: any) {
  const origin = safeOrigin(req);
  const title = `Handpenning · ${offer.title || lead.company_name || lead.contact_name || 'Pickla Event'}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: lead.email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'sek',
        unit_amount: Math.round(Number(depositAmountSek) * 100),
        product_data: {
          name: title.slice(0, 120),
          description: 'Handpenning för företagsevent hos Pickla',
          metadata: {
            event_lead_id: lead.id,
            event_offer_id: offer.id,
            event_id: eventRow.id,
          },
        },
      },
    }],
    metadata: {
      purchase_type: 'event_deposit',
      event_lead_id: lead.id,
      event_offer_id: offer.id,
      event_id: eventRow.id,
      venue_id: lead.venue_id,
    },
    success_url: `${origin}/hub/admin?event_deposit=success&lead=${lead.id}`,
    cancel_url: `${origin}/hub/admin?event_deposit=cancelled&lead=${lead.id}`,
  });
  return session;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const path = new URL(req.url).pathname.split('/').pop() || '';

  try {
    const { userId, error } = await getAuthenticatedClient(req);
    if (error || !userId) return errorResponse(error || 'Unauthorized', 401);
    const admin = getServiceClient();

    if (req.method === 'GET' && path === 'offer-catalog') {
      const venueId = new URL(req.url).searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');
      if (!await assertVenueAdmin(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const catalog = await fetchOfferCatalog(admin, venueId);
      return jsonResponse(catalog);
    }

    if (req.method === 'POST' && path === 'generate-offer') {
      const { leadId, offerConfig } = await req.json();
      if (!leadId) return errorResponse('Missing leadId');

      const { data: lead, error: leadErr } = await admin.from('event_leads').select('*').eq('id', leadId).maybeSingle();
      if (leadErr || !lead) return errorResponse('Lead not found', 404);
      if (!await assertVenueAdmin(admin, userId, lead.venue_id)) return errorResponse('Forbidden', 403);

      const { data: venue } = await admin.from('venues').select('id, name, email, phone, address').eq('id', lead.venue_id).maybeSingle();
      const resourcePlan = await applyOfferResourcePlan(admin, lead, offerConfig || {});
      const mergedOfferConfig = {
        ...(offerConfig || {}),
        resources: resourcePlan.resources,
      };
      const payload = buildOfferPayload(lead, venue, mergedOfferConfig);
      const html = buildOfferHtml(payload);
      const sales = buildSalesDraft(payload);

      const { data: offer, error: offerErr } = await admin.from('event_offers').insert({
        venue_id: lead.venue_id,
        event_id: lead.event_id ?? null,
        event_lead_id: lead.id,
        title: payload.title,
        package_type: payload.package.key,
        price_per_person: payload.price_per_person || 0,
        total_price: payload.total_price,
        html_snapshot: html,
        email_subject: sales.subject,
        email_body: sales.emailBody,
        sms_text: sales.smsText,
        offer_payload: payload,
        status: 'draft',
      }).select('*').single();
      if (offerErr) return errorResponse(offerErr.message, 500);

      await admin.from('event_leads').update({
        status: 'offer_generated',
        package_type: payload.package.key,
        estimated_value: payload.total_price,
      }).eq('id', lead.id);

      const followups = buildFollowups(lead, offer.id);
      await admin.from('event_followups').insert(followups);
      await admin.from('event_lead_activities').insert([
        leadActivity({
          lead,
          offerId: offer.id,
          type: 'offer_generated',
          title: 'Offer generated',
          body: `${payload.package.title} skapades med totalpris ${Number(payload.total_price).toLocaleString('sv-SE')} kr.`,
          actorUserId: userId,
          metadata: {
            package_type: payload.package.key,
            total_price: payload.total_price,
            selected_resource_ids: offerConfig?.selected_resource_ids || [],
            selected_resources: resourcePlan.selectedResources?.map((row: any) => row.name) || [],
            selected_item_ids: offerConfig?.selected_item_ids || [],
          },
        }),
        ...followups.map((row: any) => leadActivity({
          lead,
          offerId: offer.id,
          type: 'followup_scheduled',
          title: 'Follow-up scheduled',
          body: row.message,
          actorUserId: userId,
          metadata: { followup_type: row.followup_type, scheduled_at: row.scheduled_at },
        })),
      ]);

      return jsonResponse({ offer, payload, html, sales });
    }

    if (req.method === 'POST' && path === 'generate-pdf') {
      const { offerId } = await req.json();
      if (!offerId) return errorResponse('Missing offerId');

      const { data: offer, error: offerErr } = await admin.from('event_offers')
        .select('*, event_leads(id, venue_id)')
        .eq('id', offerId)
        .maybeSingle();
      if (offerErr || !offer) return errorResponse('Offer not found', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);

      const pdfBytes = await buildOfferPdfBytes(offer.offer_payload || {});
      const pdfPath = `${offer.venue_id}/${offer.event_lead_id}/${offer.id}.pdf`;
      const { error: uploadErr } = await admin.storage.from('event-offers').upload(pdfPath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });
      if (uploadErr) return errorResponse(uploadErr.message, 500);

      await admin.from('event_offers').update({ pdf_url: pdfPath, status: 'pdf_ready' }).eq('id', offer.id);
      await admin.from('event_lead_activities').insert(leadActivity({
        lead: { id: offer.event_lead_id, venue_id: offer.venue_id },
        offerId: offer.id,
        type: 'pdf_ready',
        title: 'PDF ready',
        body: 'Offert-PDF skapades och lagrades privat.',
        actorUserId: userId,
        metadata: { pdf_url: pdfPath },
      }));
      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(pdfPath, 60 * 60 * 24 * 7);
      return jsonResponse({ ok: true, pdf_url: pdfPath, signed_url: signed?.signedUrl || null });
    }

    if (req.method === 'GET' && path === 'preview-send') {
      const offerId = new URL(req.url).searchParams.get('offerId');
      if (!offerId) return errorResponse('Missing offerId');
      const { data: offer } = await admin.from('event_offers')
        .select('*, event_leads(*)')
        .eq('id', offerId)
        .maybeSingle();
      if (!offer) return errorResponse('Offer not found', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);
      const lead = Array.isArray(offer.event_leads) ? offer.event_leads[0] : offer.event_leads;
      if (!lead?.email) return errorResponse('Lead has no email');
      if (!offer.pdf_url) return errorResponse('Offer has no PDF', 404);
      const sales = buildSalesDraft(offer.offer_payload || {});
      const subject = offer.email_subject || sales.subject;
      const body = offer.email_body || sales.emailBody;
      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(offer.pdf_url, 60 * 60);
      return jsonResponse({
        offer,
        lead,
        to: lead.email,
        subject,
        email_body: body,
        html: emailHtmlFromText(body),
        pdf_url: offer.pdf_url,
        signed_url: signed?.signedUrl || null,
      });
    }

    if (req.method === 'GET' && path === 'signed-url') {
      const offerId = new URL(req.url).searchParams.get('offerId');
      if (!offerId) return errorResponse('Missing offerId');
      const { data: offer } = await admin.from('event_offers').select('id, venue_id, pdf_url').eq('id', offerId).maybeSingle();
      if (!offer?.pdf_url) return errorResponse('Offer has no PDF', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);
      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(offer.pdf_url, 60 * 60);
      return jsonResponse({ signed_url: signed?.signedUrl || null });
    }

    if (req.method === 'GET' && path === 'booking-preview') {
      const leadId = new URL(req.url).searchParams.get('leadId');
      const offerId = new URL(req.url).searchParams.get('offerId');
      if (!leadId) return errorResponse('Missing leadId');
      const { data: lead } = await admin.from('event_leads').select('*').eq('id', leadId).maybeSingle();
      if (!lead) return errorResponse('Lead not found', 404);
      if (!await assertVenueAdmin(admin, userId, lead.venue_id)) return errorResponse('Forbidden', 403);
      const { data: offer } = offerId
        ? await admin.from('event_offers').select('*').eq('id', offerId).maybeSingle()
        : await admin.from('event_offers').select('*').eq('event_lead_id', lead.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!offer) return errorResponse('Offer not found', 404);
      if (offer.event_lead_id !== lead.id) return errorResponse('Offer does not belong to lead', 403);
      if (!lead.event_id) return errorResponse('Lead has no event yet', 404);
      const { data: eventRow } = await admin.from('events').select('*').eq('id', lead.event_id).maybeSingle();
      if (!eventRow) return errorResponse('Event not found', 404);
      const resourceCheck = await checkEventResourceConflicts(admin, eventRow);
      const total = Number(offer.total_price || lead.estimated_value || 0);
      const defaultDeposit = Math.max(500, Math.min(total || 500, Math.round((total * DEFAULT_DEPOSIT_PERCENT) / 100)));
      return jsonResponse({ lead, offer, event: eventRow, resource_check: resourceCheck, default_deposit_amount: defaultDeposit });
    }

    if (req.method === 'POST' && path === 'confirm-booking') {
      const { leadId, offerId, depositAmountSek } = await req.json();
      if (!leadId) return errorResponse('Missing leadId');
      const { data: lead } = await admin.from('event_leads').select('*').eq('id', leadId).maybeSingle();
      if (!lead) return errorResponse('Lead not found', 404);
      if (!await assertVenueAdmin(admin, userId, lead.venue_id)) return errorResponse('Forbidden', 403);
      const { data: offer } = offerId
        ? await admin.from('event_offers').select('*').eq('id', offerId).maybeSingle()
        : await admin.from('event_offers').select('*').eq('event_lead_id', lead.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!offer) return errorResponse('Offer not found', 404);
      if (offer.event_lead_id !== lead.id) return errorResponse('Offer does not belong to lead', 403);
      if (!lead.event_id) return errorResponse('Lead has no event yet', 404);
      const { data: eventRow } = await admin.from('events').select('*').eq('id', lead.event_id).maybeSingle();
      if (!eventRow) return errorResponse('Event not found', 404);

      const resourceCheck = await checkEventResourceConflicts(admin, eventRow);
      if (!resourceCheck.ok) return jsonResponse({ ok: false, blocked: true, resource_check: resourceCheck }, 409);
      const capacityPlan = await createOrUpdateEventResourceBlocks(admin, eventRow, lead, offer, userId);

      const total = Number(offer.total_price || lead.estimated_value || 0);
      const fallbackDeposit = Math.max(500, Math.min(total || 500, Math.round((total * DEFAULT_DEPOSIT_PERCENT) / 100)));
      const requestedDeposit = parsePositiveAmount(depositAmountSek, fallbackDeposit);
      const deposit = Math.round(Math.max(100, Math.min(requestedDeposit, Math.max(total || fallbackDeposit, fallbackDeposit))));

      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeKey) return errorResponse('Stripe not configured', 500);
      const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
      const checkout = await createDepositCheckout({ req, stripe, lead, offer, eventRow, depositAmountSek: deposit });
      if (!checkout.url) return errorResponse('Could not create deposit checkout', 500);

      const sentAt = new Date().toISOString();
      const emailBody = buildBookingConfirmationText({
        lead,
        offer,
        eventRow,
        depositUrl: checkout.url,
        depositAmount: deposit,
      });
      const subject = `Bokningsbekräftelse: ${offer.title || 'Pickla Event'}`;
      const html = emailHtmlFromText(emailBody);
      const replyTo = eventRow.id ? eventReplyAddress(eventRow.id) : undefined;
      const sendResult = await sendResendEmail({
        to: lead.email,
        subject,
        html,
        replyTo,
      });
      const providerMessageId = sendResult?.id || sendResult?.data?.id || null;

      await admin.from('events').update({
        planning_status: 'booked',
        visibility: 'internal',
        status: 'upcoming',
      }).eq('id', eventRow.id);
      await admin.from('event_leads').update({ status: 'booking_confirmed' }).eq('id', lead.id);
      const { data: updatedOffer } = await admin.from('event_offers').update({
        status: 'booking_confirmed',
        booking_confirmed_at: sentAt,
        booking_confirmed_by: userId,
        deposit_amount: deposit,
        deposit_stripe_session_id: checkout.id,
        deposit_checkout_url: checkout.url,
        deposit_sent_at: sentAt,
      }).eq('id', offer.id).select('*').single();

      await admin.from('event_communications').insert({
        event_id: eventRow.id,
        direction: 'outbound',
        channel: 'email',
        from_email: RESEND_FROM,
        to_email: lead.email,
        subject,
        body_text: emailBody,
        body_html: html,
        provider: 'resend',
        provider_message_id: providerMessageId,
        status: 'sent',
        created_by: userId,
        metadata: {
          event_lead_id: lead.id,
          event_offer_id: offer.id,
          type: 'booking_confirmation',
          deposit_amount: deposit,
          deposit_stripe_session_id: checkout.id,
        },
      });

      await admin.from('event_lead_activities').insert([
        leadActivity({
          lead,
          offerId: offer.id,
          type: 'booking_confirmed',
          title: 'Booking confirmed',
          body: 'Eventet bekräftades efter resurskontroll.',
          actorUserId: userId,
          metadata: { event_id: eventRow.id, resource_check: resourceCheck, capacity_plan: capacityPlan },
        }),
        leadActivity({
          lead,
          offerId: offer.id,
          type: 'deposit_link_sent',
          title: 'Deposit link sent',
          body: `Handpenningslänk på ${Number(deposit).toLocaleString('sv-SE')} kr skickades till ${lead.email}.`,
          actorUserId: userId,
          metadata: { stripe_session_id: checkout.id, deposit_amount: deposit },
        }),
      ]);

      return jsonResponse({
        ok: true,
        lead_status: 'booking_confirmed',
        event_status: 'booked',
        offer: updatedOffer,
        checkout_url: checkout.url,
        stripe_session_id: checkout.id,
        deposit_amount: deposit,
        resource_check: resourceCheck,
        capacity_plan: capacityPlan,
        impact: capacityPlan.impact,
      });
    }

    if (req.method === 'POST' && path === 'send-offer') {
      const { offerId } = await req.json();
      if (!offerId) return errorResponse('Missing offerId');
      const { data: offer } = await admin.from('event_offers')
        .select('*, event_leads(*)')
        .eq('id', offerId)
        .maybeSingle();
      if (!offer) return errorResponse('Offer not found', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);
      if (offer.status === 'sent' && offer.sent_at) return errorResponse('Offer already sent', 409);

      const lead = Array.isArray(offer.event_leads) ? offer.event_leads[0] : offer.event_leads;
      if (!lead?.email) return errorResponse('Lead has no email');
      if (!offer.pdf_url) return errorResponse('Offer has no PDF', 404);

      const { data: file, error: downloadErr } = await admin.storage.from('event-offers').download(offer.pdf_url);
      if (downloadErr || !file) return errorResponse(downloadErr?.message || 'Could not read PDF', 500);
      const pdfBytes = new Uint8Array(await file.arrayBuffer());
      const sales = buildSalesDraft(offer.offer_payload || {});
      const subject = offer.email_subject || sales.subject;
      const textBody = offer.email_body || sales.emailBody;
      const html = emailHtmlFromText(textBody);
      const replyTo = offer.event_id ? eventReplyAddress(offer.event_id) : undefined;
      const sendResult = await sendResendEmail({
        to: lead.email,
        subject,
        html,
        replyTo,
        attachments: [{
          filename: `Pickla-offert-${String(offer.id).slice(0, 8)}.pdf`,
          content: bytesToBase64(pdfBytes),
        }],
      });

      const sentAt = new Date().toISOString();
      const providerMessageId = sendResult?.id || sendResult?.data?.id || null;
      const { data: updatedOffer, error: updateErr } = await admin.from('event_offers').update({
        status: 'sent',
        sent_at: sentAt,
        sent_by: userId,
        provider_message_id: providerMessageId,
      }).eq('id', offer.id).select('*').single();
      if (updateErr) return errorResponse(updateErr.message, 500);
      await admin.from('event_leads').update({ status: 'offer_sent' }).eq('id', lead.id);

      if (lead.event_id) {
        await admin.from('event_communications').insert({
          event_id: lead.event_id,
          direction: 'outbound',
          channel: 'email',
          from_email: RESEND_FROM,
          to_email: lead.email,
          subject,
          body_text: textBody,
          body_html: html,
          provider: 'resend',
          provider_message_id: providerMessageId,
          status: 'sent',
          created_by: userId,
          metadata: { event_lead_id: lead.id, event_offer_id: offer.id, pdf_url: offer.pdf_url },
        });
      }

      await admin.from('event_followups')
        .delete()
        .eq('event_lead_id', lead.id)
        .eq('status', 'scheduled');
      const followups = buildFollowupsFromSentAt(lead, offer.id, sentAt);
      await admin.from('event_followups').insert(followups);
      await admin.from('event_lead_activities').insert([
        leadActivity({
          lead,
          offerId: offer.id,
          type: 'offer_sent',
          title: 'Offer sent',
          body: `Offerten skickades till ${lead.email}.`,
          actorUserId: userId,
          metadata: { provider: 'resend', provider_message_id: providerMessageId },
        }),
        ...followups.map((row: any) => leadActivity({
          lead,
          offerId: offer.id,
          type: 'followup_scheduled',
          title: 'Follow-up scheduled',
          body: row.message,
          actorUserId: userId,
          metadata: { followup_type: row.followup_type, scheduled_at: row.scheduled_at, from_sent_at: sentAt },
        })),
      ]);

      return jsonResponse({ ok: true, offer: updatedOffer, sent_at: sentAt, provider_message_id: providerMessageId });
    }

    if (req.method === 'POST' && path === 'draft') {
      const { offerId } = await req.json();
      if (!offerId) return errorResponse('Missing offerId');
      const { data: offer } = await admin.from('event_offers').select('*').eq('id', offerId).maybeSingle();
      if (!offer) return errorResponse('Offer not found', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);

      const sales = buildSalesDraft(offer.offer_payload || {});
      const { data, error: updateErr } = await admin.from('event_offers').update({
        email_subject: sales.subject,
        email_body: sales.emailBody,
        sms_text: sales.smsText,
        status: offer.status === 'draft' ? 'mail_draft_ready' : offer.status,
      }).eq('id', offer.id).select('*').single();
      if (updateErr) return errorResponse(updateErr.message);
      return jsonResponse({ offer: data, sales });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Server error', 500);
  }
});
