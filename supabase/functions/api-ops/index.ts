import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

type OpsMode = 'deploy' | 'opening' | 'closing' | 'weekly';
type OpsColor = 'green' | 'yellow' | 'red';
type SignalKey = 'payments' | 'bookings' | 'memberships' | 'checkin' | 'devices' | 'score' | 'mail' | 'deploy';
type AutoSignal = {
  signal_key: SignalKey;
  status: OpsColor;
  note: string;
  details?: Record<string, unknown>;
};

const SIGNAL_KEYS: SignalKey[] = ['payments', 'bookings', 'memberships', 'checkin', 'devices', 'score', 'mail', 'deploy'];

const CHECKLISTS: Record<OpsMode, string[]> = {
  deploy: [
    'Vercel production build is green',
    'Open production home, /book, /my, and one known padda route',
    'Check Supabase Edge Function logs for changed functions',
    'Check Stripe webhook deliveries and retries',
    'Run one low-risk smoke path matching the change',
    'Classify deploy as Green, Yellow, or Red',
  ],
  opening: [
    'Today page shows correct venue state and upcoming sessions',
    'Desk loads and can search one known customer',
    'Paddor are online and show expected resource state',
    'Booking availability loads for pickleball and darts',
    'Stripe dashboard has no unresolved webhook failures',
  ],
  closing: [
    'No stuck paid Stripe sessions without Pickla records',
    'No unexpected active check-ins after closing',
    'Cancellations from the day released inventory',
    'Staff noted any support corrections made during the day',
  ],
  weekly: [
    'Founder allowance and vouchers look correct for a sample user',
    'Activity sessions for the next week look sane',
    'Receipts and VAT look correct for paid, free, and multi-resource bookings',
    'Temporary staff/admin access is removed or intentionally renewed',
  ],
};

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function runStatus(results: AutoSignal[]) {
  if (results.some((result) => result.status === 'red')) return 'critical';
  if (results.some((result) => result.status === 'yellow')) return 'warning';
  return 'ok';
}

function overlaps(a: any, b: any) {
  return new Date(a.start_time).getTime() < new Date(b.end_time).getTime() &&
    new Date(b.start_time).getTime() < new Date(a.end_time).getTime();
}

async function resolveAdminVenue(userId: string, requestedVenueId: string | null) {
  const admin = getServiceClient();

  const { data: superRole } = await admin
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'super_admin')
    .maybeSingle();

  if (superRole) {
    if (requestedVenueId) return { ok: true, venueId: requestedVenueId };
    const { data: staffVenue } = await admin
      .from('venue_staff')
      .select('venue_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    return { ok: true, venueId: staffVenue?.venue_id || null };
  }

  let query = admin
    .from('venue_staff')
    .select('venue_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('role', ['venue_admin', 'staff']);

  if (requestedVenueId) query = query.eq('venue_id', requestedVenueId);

  const { data: staffVenue } = await query.limit(1).maybeSingle();
  if (!staffVenue?.venue_id) return { ok: false, venueId: null };
  return { ok: true, venueId: staffVenue.venue_id };
}

async function ensureDefaults(venueId: string, userId: string) {
  const admin = getServiceClient();

  await Promise.all(SIGNAL_KEYS.map((key) =>
    admin.from('ops_signals').upsert({
      venue_id: venueId,
      signal_key: key,
      status: 'green',
      updated_by: userId,
    }, { onConflict: 'venue_id,signal_key', ignoreDuplicates: true })
  ));

  const checklistRows = Object.entries(CHECKLISTS).flatMap(([mode, labels]) =>
    labels.map((label, index) => ({
      venue_id: venueId,
      mode,
      item_index: index,
      label,
      is_done: false,
      updated_by: userId,
    }))
  );

  await admin.from('ops_check_state').upsert(checklistRows, {
    onConflict: 'venue_id,mode,item_index',
    ignoreDuplicates: true,
  });
}

async function getBookingsSignal(admin: any, venueId: string): Promise<AutoSignal> {
  const { data: bookings, error } = await admin
    .from('bookings')
    .select('id, venue_court_id, start_time, end_time, status, booking_ref, access_code, stripe_session_id, total_price, created_at')
    .eq('venue_id', venueId)
    .in('status', ['confirmed', 'pending'])
    .lt('start_time', hoursFromNow(48))
    .gt('end_time', hoursAgo(1));

  if (error) throw error;
  const rows = bookings || [];
  const conflicts: Array<{ a: string; b: string; court: string | null }> = [];

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (a.venue_court_id && a.venue_court_id === b.venue_court_id && overlaps(a, b)) {
        conflicts.push({ a: a.booking_ref || a.id, b: b.booking_ref || b.id, court: a.venue_court_id });
      }
    }
  }

  const missingAccessCodes = rows.filter((row: any) =>
    new Date(row.end_time).getTime() > Date.now() && !row.access_code
  );

  if (conflicts.length > 0) {
    return {
      signal_key: 'bookings',
      status: 'red',
      note: `${conflicts.length} överlappande bokningskonflikt(er) hittades.`,
      details: { conflicts: conflicts.slice(0, 10), checked_rows: rows.length },
    };
  }

  if (missingAccessCodes.length > 0) {
    return {
      signal_key: 'bookings',
      status: 'yellow',
      note: `${missingAccessCodes.length} kommande bokning(ar) saknar access code.`,
      details: { booking_refs: missingAccessCodes.map((row: any) => row.booking_ref || row.id).slice(0, 20) },
    };
  }

  return { signal_key: 'bookings', status: 'green', note: `${rows.length} kommande bokningsrader kontrollerade.`, details: { checked_rows: rows.length } };
}

async function getPaymentsSignal(admin: any, venueId: string): Promise<AutoSignal> {
  const { data: paidBookings, error } = await admin
    .from('bookings')
    .select('id, booking_ref, stripe_session_id, total_price, created_at')
    .eq('venue_id', venueId)
    .in('status', ['confirmed', 'pending'])
    .not('stripe_session_id', 'is', null)
    .gt('total_price', 0)
    .gt('created_at', hoursAgo(24))
    .lt('created_at', minutesAgo(10));

  if (error) throw error;
  const sessions = Array.from(new Set((paidBookings || []).map((row: any) => row.stripe_session_id).filter(Boolean)));
  if (sessions.length === 0) {
    return { signal_key: 'payments', status: 'green', note: 'Inga betalda Stripe-bokningar att reconcilea senaste 24h.', details: { checked_sessions: 0 } };
  }

  const { data: receipts, error: receiptError } = await admin
    .from('booking_receipts')
    .select('stripe_session_id')
    .eq('venue_id', venueId)
    .in('stripe_session_id', sessions);
  if (receiptError) throw receiptError;

  const receiptSessions = new Set((receipts || []).map((row: any) => row.stripe_session_id));
  const missing = sessions.filter((sessionId) => !receiptSessions.has(sessionId));

  if (missing.length > 0) {
    return {
      signal_key: 'payments',
      status: missing.length > 3 ? 'red' : 'yellow',
      note: `${missing.length} betalda session(er) saknar Pickla-kvitto snapshot.`,
      details: { missing_sessions: missing.slice(0, 20), checked_sessions: sessions.length },
    };
  }

  return { signal_key: 'payments', status: 'green', note: `${sessions.length} betalda session(er) reconciled med kvitto.`, details: { checked_sessions: sessions.length } };
}

async function getDevicesSignal(admin: any, venueId: string): Promise<AutoSignal> {
  const { data: devices, error } = await admin
    .from('display_devices')
    .select('id, name, is_active, last_seen_at')
    .eq('venue_id', venueId)
    .eq('is_active', true);

  if (error) throw error;
  const rows = devices || [];
  const stale = rows.filter((device: any) => !device.last_seen_at || new Date(device.last_seen_at).getTime() < Date.now() - 20 * 60 * 1000);
  const dead = rows.filter((device: any) => !device.last_seen_at || new Date(device.last_seen_at).getTime() < Date.now() - 90 * 60 * 1000);

  if (dead.length > 0) {
    return {
      signal_key: 'devices',
      status: 'yellow',
      note: `${dead.length}/${rows.length} aktiv(a) padda/display verkar offline.`,
      details: { dead_devices: dead.map((device: any) => ({ id: device.id, name: device.name, last_seen_at: device.last_seen_at })).slice(0, 20) },
    };
  }
  if (stale.length > 0) {
    return {
      signal_key: 'devices',
      status: 'yellow',
      note: `${stale.length}/${rows.length} aktiv(a) padda/display har inte pingat på 20 min.`,
      details: { stale_devices: stale.map((device: any) => ({ id: device.id, name: device.name, last_seen_at: device.last_seen_at })).slice(0, 20) },
    };
  }
  return { signal_key: 'devices', status: 'green', note: `${rows.length} aktiv(a) padda/display är nyligen sedda.`, details: { active_devices: rows.length } };
}

async function getCheckinSignal(admin: any, venueId: string): Promise<AutoSignal> {
  const { data: longOpen, error } = await admin
    .from('venue_checkins')
    .select('id, player_name, entry_type, checked_in_at')
    .eq('venue_id', venueId)
    .is('checked_out_at', null)
    .lt('checked_in_at', hoursAgo(8))
    .limit(25);

  if (error) throw error;
  const rows = longOpen || [];
  if (rows.length > 0) {
    return {
      signal_key: 'checkin',
      status: 'yellow',
      note: `${rows.length} aktiv(a) check-in verkar ha stått öppen längre än 8h.`,
      details: { checkins: rows },
    };
  }
  return { signal_key: 'checkin', status: 'green', note: 'Inga uppenbart fastnade check-ins hittades.', details: {} };
}

async function getMembershipsSignal(admin: any, venueId: string): Promise<AutoSignal> {
  const { data: expiredActive, error } = await admin
    .from('memberships')
    .select('id, user_id, expires_at, status')
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .not('expires_at', 'is', null)
    .lt('expires_at', todayIsoDate())
    .limit(25);

  if (error) throw error;
  const rows = expiredActive || [];
  if (rows.length > 0) {
    return {
      signal_key: 'memberships',
      status: 'yellow',
      note: `${rows.length} medlemskap är fortfarande active trots passerat expires_at.`,
      details: { memberships: rows },
    };
  }
  return { signal_key: 'memberships', status: 'green', note: 'Medlemskapens active/expiry-status ser rimlig ut.', details: {} };
}

async function getScoreSignal(admin: any, venueId: string): Promise<AutoSignal> {
  const { data: stuckMatches, error } = await admin
    .from('score_matches')
    .select('id, player1_name, player2_name, updated_at, status')
    .eq('venue_id', venueId)
    .in('status', ['pending', 'in_progress'])
    .lt('updated_at', hoursAgo(6))
    .limit(25);

  if (error) throw error;
  const rows = stuckMatches || [];
  if (rows.length > 0) {
    return {
      signal_key: 'score',
      status: 'yellow',
      note: `${rows.length} score-match(er) verkar fastnade längre än 6h.`,
      details: { matches: rows },
    };
  }
  return { signal_key: 'score', status: 'green', note: 'Inga fastnade score-matcher hittades.', details: {} };
}

async function getMailSignal(admin: any, venueId: string): Promise<AutoSignal> {
  const { data: events, error: eventError } = await admin
    .from('events')
    .select('id')
    .eq('venue_id', venueId)
    .gt('created_at', hoursAgo(72))
    .limit(100);
  if (eventError) throw eventError;

  const eventIds = (events || []).map((event: any) => event.id);
  if (eventIds.length === 0) return { signal_key: 'mail', status: 'green', note: 'Inga nya eventmail att kontrollera senaste 72h.', details: {} };

  const { data: failed, error } = await admin
    .from('event_communications')
    .select('id, event_id, status, subject, created_at')
    .in('event_id', eventIds)
    .in('status', ['failed', 'error', 'bounced'])
    .limit(25);

  if (error) throw error;
  const rows = failed || [];
  if (rows.length > 0) {
    return {
      signal_key: 'mail',
      status: 'yellow',
      note: `${rows.length} kundmail/eventmail har felstatus.`,
      details: { communications: rows },
    };
  }
  return { signal_key: 'mail', status: 'green', note: 'Inga mailfel hittades för nya event.', details: { checked_events: eventIds.length } };
}

async function writeAutoSignal(admin: any, venueId: string, userId: string | null, signal: AutoSignal) {
  const now = new Date().toISOString();
  const { error } = await admin.from('ops_signals')
    .upsert({
      venue_id: venueId,
      signal_key: signal.signal_key,
      status: signal.status,
      note: signal.note,
      source: 'auto',
      details: signal.details || {},
      last_auto_checked_at: now,
      updated_by: userId,
    }, { onConflict: 'venue_id,signal_key' });
  if (error) throw error;
}

async function syncAutoIncident(admin: any, venueId: string, userId: string | null, signal: AutoSignal) {
  const agentKey = `auto:${signal.signal_key}`;
  const { data: existing } = await admin
    .from('ops_incidents')
    .select('id, status')
    .eq('venue_id', venueId)
    .contains('metadata', { agent_key: agentKey })
    .neq('status', 'resolved')
    .limit(1)
    .maybeSingle();

  if (signal.status === 'red') {
    if (existing?.id) {
      await admin.from('ops_incidents')
        .update({
          title: signal.note,
          severity: 'P1',
          status: 'open',
          impact: JSON.stringify(signal.details || {}),
          updated_by: userId,
        })
        .eq('id', existing.id);
      return;
    }

    await admin.from('ops_incidents').insert({
      venue_id: venueId,
      severity: 'P1',
      title: signal.note,
      status: 'open',
      owner_name: 'Ops Agent',
      impact: JSON.stringify(signal.details || {}),
      metadata: { agent_key: agentKey, signal_key: signal.signal_key },
      created_by: userId,
      updated_by: userId,
    });
    return;
  }

  if (existing?.id) {
    await admin.from('ops_incidents')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        verification: `Ops Agent resolved: ${signal.note}`,
        updated_by: userId,
      })
      .eq('id', existing.id);
  }
}

async function runAutoChecks(venueId: string, userId: string | null) {
  const admin = getServiceClient();
  const startedAt = new Date().toISOString();
  const checkers = [
    getPaymentsSignal,
    getBookingsSignal,
    getMembershipsSignal,
    getCheckinSignal,
    getDevicesSignal,
    getScoreSignal,
    getMailSignal,
  ];

  const results: AutoSignal[] = [];
  for (const checker of checkers) {
    try {
      const signal = await checker(admin, venueId);
      results.push(signal);
      await writeAutoSignal(admin, venueId, userId, signal);
      await syncAutoIncident(admin, venueId, userId, signal);
    } catch (err) {
      const failed: AutoSignal = {
        signal_key: 'deploy',
        status: 'yellow',
        note: `Ops Agent kunde inte köra en check: ${err instanceof Error ? err.message : 'unknown error'}`,
        details: { error: err instanceof Error ? err.message : err },
      };
      results.push(failed);
      await writeAutoSignal(admin, venueId, userId, failed);
    }
  }

  const status = runStatus(results);
  const { data: run, error } = await admin.from('ops_agent_runs').insert({
    venue_id: venueId,
    status,
    summary: { results },
    created_by: userId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  }).select().single();
  if (error) throw error;

  return { run, results };
}

async function maybeRunAutoChecks(venueId: string, userId: string) {
  const admin = getServiceClient();
  try {
    const { data: lastRun, error } = await admin
      .from('ops_agent_runs')
      .select('finished_at')
      .eq('venue_id', venueId)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('ops_agent_runs unavailable; skipping auto checks', error.message);
      return;
    }

    if (!lastRun?.finished_at || new Date(lastRun.finished_at).getTime() < Date.now() - 60 * 1000) {
      await runAutoChecks(venueId, userId);
    }
  } catch (err) {
    console.warn('Ops Agent auto-run skipped', err);
  }
}

async function getState(venueId: string, userId: string) {
  const admin = getServiceClient();
  await ensureDefaults(venueId, userId);

  const [
    { data: signals, error: signalsError },
    { data: checks, error: checksError },
    { data: incidents, error: incidentsError },
  ] = await Promise.all([
    admin.from('ops_signals').select('*').eq('venue_id', venueId).order('signal_key'),
    admin.from('ops_check_state').select('*').eq('venue_id', venueId).order('mode').order('item_index'),
    admin.from('ops_incidents').select('*').eq('venue_id', venueId).order('created_at', { ascending: false }).limit(50),
  ]);

  if (signalsError) throw signalsError;
  if (checksError) throw checksError;
  if (incidentsError) throw incidentsError;

  const { data: agentRuns, error: agentRunsError } = await admin
    .from('ops_agent_runs')
    .select('*')
    .eq('venue_id', venueId)
    .order('finished_at', { ascending: false })
    .limit(5);

  if (agentRunsError) console.warn('ops_agent_runs unavailable in state', agentRunsError.message);

  return {
    signals: signals || [],
    checks: checks || [],
    incidents: incidents || [],
    agentRuns: agentRunsError ? [] : (agentRuns || []),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, error } = await getAuthenticatedClient(req);
    if (error || !userId) return errorResponse(error || 'Unauthorized', 401);

    const url = new URL(req.url);
    const path = url.pathname.split('/').pop() || '';
    const body = ['POST', 'PATCH'].includes(req.method) ? await req.json().catch(() => ({})) : {};
    const requestedVenueId = url.searchParams.get('venueId') || body.venueId || null;
    const { ok, venueId } = await resolveAdminVenue(userId, requestedVenueId);
    if (!ok || !venueId) return errorResponse('Forbidden: ops admin only', 403);

    const admin = getServiceClient();

    if (req.method === 'GET' && path === 'state') {
      await maybeRunAutoChecks(venueId, userId);
      const state = await getState(venueId, userId);
      return jsonResponse({ venueId, ...state }, 200, 5);
    }

    if (req.method === 'POST' && path === 'run-checks') {
      const result = await runAutoChecks(venueId, userId);
      const state = await getState(venueId, userId);
      return jsonResponse({ success: true, ...result, state });
    }

    if (req.method === 'PATCH' && path === 'signal') {
      const { signal_key, status, note } = body;
      if (!SIGNAL_KEYS.includes(signal_key)) return errorResponse('Invalid signal_key');
      if (!['green', 'yellow', 'red'].includes(status)) return errorResponse('Invalid status');

      const { data, error: e } = await admin.from('ops_signals')
        .upsert({
          venue_id: venueId,
          signal_key,
          status,
          note: note || null,
          updated_by: userId,
        }, { onConflict: 'venue_id,signal_key' })
        .select()
        .single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'PATCH' && path === 'check') {
      const { mode, item_index, is_done } = body;
      if (!Object.keys(CHECKLISTS).includes(mode)) return errorResponse('Invalid mode');
      const label = CHECKLISTS[mode as OpsMode]?.[Number(item_index)];
      if (!label) return errorResponse('Invalid item_index');

      const { data, error: e } = await admin.from('ops_check_state')
        .upsert({
          venue_id: venueId,
          mode,
          item_index,
          label,
          is_done: Boolean(is_done),
          updated_by: userId,
        }, { onConflict: 'venue_id,mode,item_index' })
        .select()
        .single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'POST' && path === 'incident') {
      const { severity = 'P2', title, owner_name, affected_route, affected_ids, impact } = body;
      if (!title?.trim()) return errorResponse('Missing title');
      if (!['P0', 'P1', 'P2', 'P3'].includes(severity)) return errorResponse('Invalid severity');

      const { data, error: e } = await admin.from('ops_incidents')
        .insert({
          venue_id: venueId,
          severity,
          title: title.trim(),
          owner_name: owner_name || null,
          affected_route: affected_route || null,
          affected_ids: affected_ids || null,
          impact: impact || null,
          created_by: userId,
          updated_by: userId,
        })
        .select()
        .single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'incident') {
      const { incident_id, status, ...fields } = body;
      if (!incident_id) return errorResponse('Missing incident_id');
      if (status && !['open', 'contained', 'resolved'].includes(status)) return errorResponse('Invalid status');

      const updates: Record<string, unknown> = {
        updated_by: userId,
      };
      ['severity', 'title', 'owner_name', 'affected_route', 'affected_ids', 'impact', 'containment', 'fix_reference', 'verification', 'follow_up'].forEach((key) => {
        if (fields[key] !== undefined) updates[key] = fields[key];
      });
      if (status) {
        updates.status = status;
        updates.resolved_at = status === 'resolved' ? new Date().toISOString() : null;
      }

      const { data, error: e } = await admin.from('ops_incidents')
        .update(updates)
        .eq('id', incident_id)
        .eq('venue_id', venueId)
        .select()
        .single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'incident') {
      const incidentId = url.searchParams.get('incidentId');
      if (!incidentId) return errorResponse('Missing incidentId');
      const { error: e } = await admin.from('ops_incidents')
        .delete()
        .eq('id', incidentId)
        .eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ success: true });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    console.error('api-ops error', err);
    return errorResponse(err instanceof Error ? err.message : 'Internal error', 500);
  }
});
