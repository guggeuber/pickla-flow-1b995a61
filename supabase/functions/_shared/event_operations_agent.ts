import { DateTime } from 'https://esm.sh/luxon@3.5.0';
import { EVENT_PACKAGES, leadActivity } from './event_agents.ts';

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeTime(value?: string | null) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function timeToMinutes(value?: string | null) {
  const time = normalizeTime(value);
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeDate(value?: string | null) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) return match[1];
  const parsed = DateTime.fromISO(raw, { zone: 'utc' });
  return parsed.isValid ? parsed.setZone('Europe/Stockholm').toISODate() : null;
}

function leadText(lead: any) {
  return [
    lead.event_type,
    lead.message,
    lead.company_name,
    ...(Array.isArray(lead.activities) ? lead.activities : []),
    ...(Array.isArray(lead.resources) ? lead.resources : []),
  ].join(' ').toLowerCase();
}

function eventPreference(lead: any) {
  const text = leadText(lead);
  if (/aw|after work/.test(text)) return 'aw';
  if (/svensexa|möhippa|kalas|kompis|födelsedag|birthday|privat|private/.test(text)) return 'social';
  if (/familj|family|skola|barn|kids/.test(text)) return 'family';
  if (/företag|foretag|konferens|kickoff|möte|workshop|team|company|corporate/.test(text)) return 'corporate';
  return 'social';
}

function preferredDaysAndTimes(lead: any) {
  const preference = eventPreference(lead);
  if (preference === 'aw') return { days: [1, 2, 3, 4, 5], starts: ['16:00', '17:00'] };
  if (preference === 'corporate') return { days: [1, 2, 3, 4, 5], starts: ['10:00', '13:00', '15:00', '16:00'] };
  if (preference === 'family') return { days: [6, 0], starts: ['10:00', '11:00', '13:00', '14:00'] };
  return { days: [6, 0], starts: ['15:00', '16:00', '17:00', '18:00'] };
}

function rangeFromSchedule(dateValue?: string | null, startValue?: string | null, endValue?: string | null) {
  const eventDate = normalizeDate(dateValue);
  const startTime = normalizeTime(startValue);
  if (!eventDate || !startTime) return null;
  const endTime = normalizeTime(endValue);
  const start = DateTime.fromISO(`${eventDate}T${startTime}:00`, { zone: 'Europe/Stockholm' });
  const end = endTime
    ? DateTime.fromISO(`${eventDate}T${endTime}:00`, { zone: 'Europe/Stockholm' })
    : start.plus({ hours: 2 });
  if (!start.isValid || !end.isValid || end <= start) return null;
  return {
    event_date: eventDate,
    start_time: startTime,
    end_time: end.toFormat('HH:mm'),
    startUtc: start.toUTC().toISO(),
    endUtc: end.toUTC().toISO(),
  };
}

function openingHoursByDay(rows: any[]) {
  return new Map((rows || []).map((row: any) => [Number(row.day_of_week), row]));
}

function openingWindow(row: any) {
  const open = timeToMinutes(row?.open_time);
  let close = timeToMinutes(row?.close_time);
  if (open == null || close == null) return null;
  if (close <= open) close += 1440;
  return { open, close };
}

function generateAlternativeTimes(lead: any, range: any, hoursRows: any[]) {
  if (!range?.event_date || !range?.start_time || !range?.end_time) return [];
  const hoursMap = openingHoursByDay(hoursRows);
  const prefs = preferredDaysAndTimes(lead);
  const requested = DateTime.fromISO(range.event_date, { zone: 'Europe/Stockholm' });
  const startMinutes = timeToMinutes(range.start_time) ?? 0;
  let endMinutes = timeToMinutes(range.end_time) ?? startMinutes + 120;
  if (endMinutes <= startMinutes) endMinutes += 1440;
  const duration = Math.max(60, Math.min(360, endMinutes - startMinutes));
  const suggestions: any[] = [];

  for (let offset = 0; offset <= 21 && suggestions.length < 4; offset += 1) {
    const day = requested.plus({ days: offset });
    const dayOfWeek = day.weekday % 7;
    if (!prefs.days.includes(dayOfWeek)) continue;
    const hours = hoursMap.get(dayOfWeek);
    if (!hours || hours.is_closed) continue;
    const window = openingWindow(hours);
    if (!window) continue;

    for (const start of prefs.starts) {
      const candidateStart = timeToMinutes(start);
      if (candidateStart == null) continue;
      const candidateEnd = candidateStart + duration;
      if (candidateStart < window.open || candidateEnd > window.close) continue;
      suggestions.push({
        event_date: day.toISODate(),
        start_time: minutesToTime(candidateStart),
        end_time: minutesToTime(candidateEnd),
        reason: `Passar ${eventPreference(lead)} och ligger inom öppettiderna.`,
      });
      break;
    }
  }

  return suggestions;
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

function packageForLead(lead: any, offer: any) {
  const packages = EVENT_PACKAGES as Record<string, any>;
  const existing = String(offer?.offer_payload?.package?.key || offer?.package_type || lead.package_type || '');
  if (existing && packages[existing]) return packages[existing];

  const text = [
    lead.event_type,
    lead.message,
    ...(Array.isArray(lead.activities) ? lead.activities : []),
    ...(Array.isArray(lead.resources) ? lead.resources : []),
  ].join(' ').toLowerCase();

  if (/liga|league|serie|återkommande/.test(text)) return packages.league;
  if (/konferens|möte|lunch|workshop/.test(text)) return packages.conference;
  if (/aw|after work|pizza|dryck|bar|dart|mat|bubbel/.test(text)) return packages.aw_social;
  if (Number(lead.participants_count || 0) >= 30) return packages.aw_social;
  return packages.standard;
}

function fallbackPrice(lead: any, pack: any, offer: any) {
  if (Number(offer?.total_price || 0) > 0) return Number(offer.total_price);
  const participants = Number(lead.participants_count || 1);
  if (pack?.key === 'league') return Math.max(12000, Math.ceil(participants / 4) * 3500);
  return Math.max(0, participants * Number(pack?.pricePerPerson || 0));
}

function resourceName(row: any) {
  return row?.name || row?.event_resource_catalog?.name || 'Resurs';
}

function chooseRecommendedResources(lead: any, pack: any, catalog: any[], allocations: any[]) {
  const allocatedIds = uniqueStrings(allocations.map((row: any) => row.resource_catalog_id));
  if (allocatedIds.length) {
    return allocations.map((row: any) => ({
      resource_catalog_id: row.resource_catalog_id,
      venue_court_id: row.venue_court_id || null,
      name: row.name || resourceName(row),
      resource_type: row.resource_type || 'resource',
      source: 'existing_allocation',
    }));
  }

  const text = [
    lead.event_type,
    lead.message,
    pack?.title,
    ...(Array.isArray(lead.activities) ? lead.activities : []),
    ...(Array.isArray(lead.resources) ? lead.resources : []),
  ].join(' ').toLowerCase();

  const active = catalog.filter((row) => row.is_active !== false);
  const courts = active.filter((row) => row.resource_type === 'court' && row.is_bookable !== false && row.venue_court_id);
  const spaces = active.filter((row) => ['space', 'food_drink'].includes(row.resource_type));
  const staff = active.filter((row) => row.resource_type === 'staff');
  const participants = Number(lead.participants_count || 1);
  const courtCount = Math.max(1, Math.min(4, Math.ceil(participants / 8)));
  const picked = courts.slice(0, courtCount);

  if (/lounge|aw|after work|konferens|möte|bar|restaurang|mat|dryck|lunch/.test(text)) {
    picked.push(...spaces.filter((row) => /lounge|bar|restaurang|restaurant|konferens/i.test(row.name)).slice(0, 2));
  }
  if (/värd|host|coach|event|instruktör|spel|aktivitet/.test(text) || participants >= 10) {
    picked.push(...staff.slice(0, 1));
  }

  const seen = new Set<string>();
  return picked
    .filter((row) => {
      if (!row.id || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row) => ({
      resource_catalog_id: row.id,
      venue_court_id: row.venue_court_id || null,
      name: row.name,
      resource_type: row.resource_type,
      source: 'agent_suggested',
    }));
}

async function registrationCounts(admin: any, sessionIds: string[], startDate: string, endDate: string) {
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
    const key = `${row.activity_session_id}:${row.session_date}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function activityOverrides(admin: any, venueId: string, sessionIds: string[], startDate: string, endDate: string) {
  const map = new Map<string, any>();
  if (!sessionIds.length || !startDate || !endDate) return map;
  const { data, error } = await admin
    .from('activity_session_overrides')
    .select('id, activity_session_id, session_date, status, reason')
    .eq('venue_id', venueId)
    .in('activity_session_id', sessionIds)
    .gte('session_date', startDate)
    .lte('session_date', endDate);
  if (error) throw new Error(error.message);
  for (const row of data || []) map.set(`${row.activity_session_id}:${row.session_date}`, row);
  return map;
}

async function analyzeCapacity(admin: any, lead: any, eventRow: any, resources: any[], range: any, catalog: any[] = []) {
  if (!range?.startUtc || !range?.endUtc) {
    return {
      ok: false,
      conflicts: [{ type: 'schedule', label: 'Eventet saknar komplett datum/start/slut.' }],
      affected_activities: [],
      affected_registrations: 0,
      affected_bookings: 0,
      active_blocks: 0,
      alternative_times: [],
      alternative_resources: [],
    };
  }

  const venueId = lead.venue_id;
  const courtIds = uniqueStrings(resources.map((row) => row.venue_court_id).filter(Boolean));
  const catalogIds = uniqueStrings(resources.map((row) => row.resource_catalog_id).filter(Boolean));
  const catalogById = new Map((catalog || []).map((row: any) => [row.id, row]));
  const selectedCatalogIds = new Set(catalogIds);
  const unavailableCatalogIds = new Set<string>();
  const unavailableCourtIds = new Set<string>();
  const conflicts: any[] = [];

  for (const resource of resources || []) {
    if (!resource.resource_catalog_id) continue;
    const catalogRow = catalogById.get(resource.resource_catalog_id);
    const courtBookableMissing = (resource.resource_type === 'court' || catalogRow?.resource_type === 'court') && catalogRow?.is_bookable === false;
    if (!catalogRow || catalogRow.is_active === false || courtBookableMissing) {
      unavailableCatalogIds.add(resource.resource_catalog_id);
      if (resource.venue_court_id) unavailableCourtIds.add(resource.venue_court_id);
      conflicts.push({
        type: 'resource_unavailable',
        id: resource.resource_catalog_id,
        label: `${resource.name || 'Resurs'} är inte aktiv/bokningsbar.`,
        severity: 'high',
      });
    }
  }

  const { data: hoursRows, error: hoursError } = await admin
    .from('opening_hours')
    .select('day_of_week, open_time, close_time, is_closed')
    .eq('venue_id', venueId);
  if (hoursError) throw new Error(hoursError.message);

  const eventDay = DateTime.fromISO(range.event_date, { zone: 'Europe/Stockholm' });
  const dayOfWeek = eventDay.weekday % 7;
  const hours = openingHoursByDay(hoursRows || []).get(dayOfWeek);
  const openingConflict = {
    type: 'opening_hours',
    label: 'Venue is closed at requested time',
    severity: 'high',
    day_of_week: dayOfWeek,
    open_time: hours?.open_time || null,
    close_time: hours?.close_time || null,
  };
  const startMinutes = timeToMinutes(range.start_time);
  let endMinutes = timeToMinutes(range.end_time);
  if (startMinutes != null && endMinutes != null && endMinutes <= startMinutes) endMinutes += 1440;
  const window = hours && !hours.is_closed ? openingWindow(hours) : null;
  if (!hours || hours.is_closed || !window || startMinutes == null || endMinutes == null || startMinutes < window.open || endMinutes > window.close) {
    conflicts.push(openingConflict);
  }

  const { data: driftRows, error: driftError } = await admin
    .from('venue_operation_overrides')
    .select('id, title, override_type, starts_at, ends_at, affects_entire_venue')
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .lt('starts_at', range.endUtc)
    .gt('ends_at', range.startUtc)
    .limit(20);
  if (driftError) throw new Error(driftError.message);
  for (const row of driftRows || []) {
    conflicts.push({
      type: 'drift',
      id: row.id,
      label: row.title || 'Driftavvikelse',
      severity: row.affects_entire_venue === false ? 'medium' : 'high',
      starts_at: row.starts_at,
      ends_at: row.ends_at,
    });
  }

  let blockQuery = admin
    .from('event_resource_blocks')
    .select('id, title, reason, status, starts_at, ends_at, resource_catalog_id, event_id, event_resource_catalog(id, name, venue_court_id)')
    .eq('venue_id', venueId)
    .in('status', ['hold', 'confirmed'])
    .lt('starts_at', range.endUtc)
    .gt('ends_at', range.startUtc)
    .limit(40);
  if (catalogIds.length) blockQuery = blockQuery.in('resource_catalog_id', catalogIds);
  const { data: blocks, error: blockError } = await blockQuery;
  if (blockError) throw new Error(blockError.message);
  for (const row of blocks || []) {
    if (eventRow?.id && row.event_id === eventRow.id) continue;
    if (row.resource_catalog_id) unavailableCatalogIds.add(row.resource_catalog_id);
    const resource = Array.isArray(row.event_resource_catalog) ? row.event_resource_catalog[0] : row.event_resource_catalog;
    if (resource?.venue_court_id) unavailableCourtIds.add(resource.venue_court_id);
    conflicts.push({
      type: 'resource_block',
      id: row.id,
      label: row.title || resourceName(resource),
      severity: 'high',
      starts_at: row.starts_at,
      ends_at: row.ends_at,
    });
  }

  let affectedBookings = 0;
  if (courtIds.length) {
    const { data: bookings, count, error } = await admin
      .from('bookings')
      .select('id, booking_ref, venue_court_id, start_time, end_time, status, venue_courts(id, name)', { count: 'exact' })
      .eq('venue_id', venueId)
      .neq('status', 'cancelled')
      .in('venue_court_id', courtIds)
      .lt('start_time', range.endUtc)
      .gt('end_time', range.startUtc)
      .limit(12);
    if (error) throw new Error(error.message);
    affectedBookings = count ?? (bookings || []).length;
    for (const row of bookings || []) {
      if (row.venue_court_id) unavailableCourtIds.add(row.venue_court_id);
      conflicts.push({
        type: 'booking',
        id: row.id,
        label: row.booking_ref || row.venue_courts?.name || 'Bokning',
        severity: 'high',
        starts_at: row.start_time,
        ends_at: row.end_time,
      });
    }
  }

  const dates = localDatesBetween(range.startUtc, range.endUtc);
  const startMs = DateTime.fromISO(range.startUtc, { zone: 'utc' }).toMillis();
  const endMs = DateTime.fromISO(range.endUtc, { zone: 'utc' }).toMillis();
  const { data: sessions, error: sessionsError } = await admin
    .from('activity_sessions')
    .select('id, name, session_type, session_date, recurrence_days, start_time, end_time, court_ids, is_active, publish_status')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .limit(500);
  if (sessionsError) throw new Error(sessionsError.message);

  const courtSet = new Set(courtIds);
  const affectedActivities: any[] = [];
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
        affectedActivities.push({
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

  const sessionIds = uniqueStrings(affectedActivities.map((row) => row.activity_session_id));
  const [counts, overrides] = await Promise.all([
    registrationCounts(admin, sessionIds, dates[0] || '', dates[dates.length - 1] || ''),
    activityOverrides(admin, venueId, sessionIds, dates[0] || '', dates[dates.length - 1] || ''),
  ]);
  let affectedRegistrations = 0;
  for (const activity of affectedActivities) {
    const key = `${activity.activity_session_id}:${activity.session_date}`;
    const count = counts.get(key) || 0;
    const override = overrides.get(key);
    affectedRegistrations += count;
    activity.registrations_count = count;
    activity.override_status = override?.status || null;
    if (!['hidden', 'cancelled'].includes(String(override?.status || ''))) {
      conflicts.push({
        type: 'activity',
        id: activity.activity_session_id,
        label: activity.name,
        severity: count > 0 ? 'high' : 'medium',
        session_date: activity.session_date,
        start_time: activity.start_time,
        end_time: activity.end_time,
        registrations_count: count,
      });
    }
  }

  const alternativeResources = (catalog || [])
    .filter((row: any) => row.resource_type === 'court')
    .filter((row: any) => row.is_active !== false && row.is_bookable !== false && row.venue_court_id)
    .filter((row: any) => !selectedCatalogIds.has(row.id))
    .filter((row: any) => !unavailableCatalogIds.has(row.id) && !unavailableCourtIds.has(row.venue_court_id))
    .slice(0, Math.max(2, courtIds.length || 2))
    .map((row: any) => ({
      resource_catalog_id: row.id,
      venue_court_id: row.venue_court_id,
      name: row.name,
      resource_type: row.resource_type,
      reason: 'Alternativ bana utan känd konflikt i aktuell analys.',
    }));

  return {
    ok: conflicts.length === 0,
    conflicts,
    affected_activities: affectedActivities.slice(0, 12),
    affected_registrations: affectedRegistrations,
    affected_bookings: affectedBookings,
    active_blocks: (blocks || []).filter((row: any) => !eventRow?.id || row.event_id !== eventRow.id).length,
    alternative_times: generateAlternativeTimes(lead, range, hoursRows || []),
    alternative_resources: alternativeResources,
  };
}

function nextActionFor(payload: any) {
  if (!payload.recommended_schedule?.event_date || !payload.recommended_schedule?.start_time || !payload.recommended_schedule?.end_time) {
    return 'set_schedule';
  }
  if (payload.conflicts?.some((row: any) => row.type === 'opening_hours')) return 'choose_alternative_time';
  if (!payload.capacity_ok) return 'resolve_conflicts';
  if (payload.affected_registrations > 0) return 'review_activity_capacity';
  if (!payload.existing_offer_id) return 'create_offer';
  return 'approve_offer';
}

function riskFor(payload: any) {
  if (payload.conflicts?.some((row: any) => row.severity === 'high')) return 'high';
  if (payload.affected_registrations > 0) return 'high';
  if (!payload.capacity_ok) return 'medium';
  if (!payload.recommended_schedule?.event_date || payload.affected_registrations > 0 || !payload.recommended_resources?.length) return 'medium';
  return 'low';
}

function summaryFor(payload: any, lead: any) {
  const leadName = lead.company_name || lead.contact_name || 'Leadet';
  const schedule = payload.recommended_schedule;
  const resources = payload.recommended_resources?.slice(0, 4).map((row: any) => row.name).join(', ') || 'resurser behöver väljas';
  const firstAlternative = payload.alternative_times?.[0];
  if (!schedule?.event_date) return `${leadName}: sätt datum/tid innan offert eller bokning. Agenten föreslår ${payload.recommended_package?.title}.`;
  if (payload.conflicts?.some((row: any) => row.type === 'opening_hours')) {
    const alt = firstAlternative ? ` Föreslå ${firstAlternative.event_date} ${firstAlternative.start_time}-${firstAlternative.end_time} istället.` : ' Välj en annan tid inom öppettiderna.';
    return `${leadName}: venue är stängt vid önskad tid ${schedule.event_date} ${schedule.start_time}-${schedule.end_time}.${alt}`;
  }
  if (!payload.capacity_ok) return `${leadName}: kapacitetskonflikt hittad för ${schedule.event_date} ${schedule.start_time}-${schedule.end_time}.`;
  if (payload.affected_registrations > 0) return `${leadName}: kapacitet OK men ${payload.affected_registrations} registreringar påverkas. Rekommenderade resurser: ${resources}.`;
  return `${leadName}: rekommendera ${payload.recommended_package?.title} ${schedule.event_date} ${schedule.start_time}-${schedule.end_time} med ${resources}.`;
}

export async function buildEventOperationsRecommendation(admin: any, leadId: string) {
  const { data: lead, error: leadError } = await admin
    .from('event_leads')
    .select('*')
    .eq('id', leadId)
    .maybeSingle();
  if (leadError || !lead) throw new Error(leadError?.message || 'Lead not found');

  const [eventResult, offerResult, allocationsResult, catalogResult] = await Promise.all([
    lead.event_id
      ? admin.from('events').select('*').eq('id', lead.event_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from('event_offers')
      .select('id, title, package_type, status, total_price, offer_payload, created_at')
      .eq('event_lead_id', lead.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    lead.event_id
      ? admin.from('event_resource_allocations')
        .select('id, resource_catalog_id, venue_court_id, venue_staff_id, resource_type, name, status, start_at, end_at')
        .eq('event_id', lead.event_id)
        .in('status', ['proposed', 'confirmed'])
      : Promise.resolve({ data: [], error: null }),
    admin.from('event_resource_catalog')
      .select('id, resource_type, name, description, venue_court_id, venue_staff_id, is_bookable, is_active')
      .eq('venue_id', lead.venue_id)
      .eq('is_active', true)
      .limit(200),
  ]);
  if (eventResult.error) throw new Error(eventResult.error.message);
  if (offerResult.error) throw new Error(offerResult.error.message);
  if (allocationsResult.error) throw new Error(allocationsResult.error.message);
  if (catalogResult.error) throw new Error(catalogResult.error.message);

  const eventRow = eventResult.data;
  const offer = offerResult.data;
  const allocations = allocationsResult.data || [];
  const catalog = catalogResult.data || [];

  const pack = packageForLead(lead, offer);
  const range = rangeFromSchedule(eventRow?.start_date || lead.preferred_date, eventRow?.start_time || lead.preferred_time, eventRow?.end_time);
  const recommendedResources = chooseRecommendedResources(lead, pack, catalog, allocations);
  const capacity = await analyzeCapacity(admin, lead, eventRow, recommendedResources, range, catalog);

  const payload: any = {
    summary: '',
    risk: 'low',
    capacity_ok: capacity.ok,
    recommended_package: {
      key: pack?.key || lead.package_type || 'standard',
      title: pack?.title || 'Företagsevent',
      price_per_person: Number(pack?.pricePerPerson || 0),
    },
    recommended_schedule: {
      event_date: range?.event_date || normalizeDate(eventRow?.start_date || lead.preferred_date),
      start_time: range?.start_time || normalizeTime(eventRow?.start_time || lead.preferred_time),
      end_time: range?.end_time || normalizeTime(eventRow?.end_time),
      source: eventRow?.start_date || eventRow?.start_time ? 'event' : 'lead_request',
    },
    recommended_resources: recommendedResources,
    capacity_result: capacity,
    conflicts: capacity.conflicts,
    affected_activities: capacity.affected_activities,
    affected_registrations: capacity.affected_registrations,
    affected_bookings: capacity.affected_bookings,
    active_blocks: capacity.active_blocks,
    alternative_times: capacity.alternative_times,
    alternative_resources: capacity.alternative_resources,
    price_recommendation: {
      total_sek: fallbackPrice(lead, pack, offer),
      source: offer?.id ? 'existing_offer' : 'package_estimate',
    },
    existing_offer_id: offer?.id || null,
    next_action: '',
  };
  payload.risk = riskFor(payload);
  payload.next_action = nextActionFor(payload);
  payload.summary = summaryFor(payload, lead);

  return { lead, event: eventRow || null, offer: offer || null, recommendation: payload };
}

export async function createEventOperationsRecommendationActivity(admin: any, leadId: string, actorUserId?: string | null) {
  const result = await buildEventOperationsRecommendation(admin, leadId);
  const { lead, offer, recommendation } = result;
  const { data: activity, error } = await admin.from('event_lead_activities').insert(leadActivity({
    lead,
    offerId: offer?.id || null,
    type: 'agent_recommendation',
    title: 'Agent recommendation',
    body: recommendation.summary,
    actorUserId: actorUserId || null,
    metadata: recommendation,
  })).select('*').single();
  if (error) throw new Error(error.message);
  return { ...result, activity };
}

export async function logAgentRecommendationDecision(
  admin: any,
  lead: any,
  decision: 'approved' | 'rejected',
  actorUserId?: string | null,
  recommendationId?: string | null,
) {
  const type = decision === 'approved' ? 'agent_recommendation_approved' : 'agent_recommendation_rejected';
  const title = decision === 'approved' ? 'Agent recommendation approved' : 'Agent recommendation rejected';
  const body = decision === 'approved'
    ? 'Rekommendationen godkändes manuellt. Inga åtgärder kördes i Phase 1.'
    : 'Rekommendationen avvisades manuellt. Inga åtgärder kördes.';
  const { data, error } = await admin.from('event_lead_activities').insert(leadActivity({
    lead,
    type,
    title,
    body,
    actorUserId: actorUserId || null,
    metadata: { recommendation_activity_id: recommendationId || null, phase: 'agent_inbox_phase_1' },
  })).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}
