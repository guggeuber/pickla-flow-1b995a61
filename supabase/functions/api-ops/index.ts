import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

type OpsMode = 'deploy' | 'opening' | 'closing' | 'weekly';
type SignalKey = 'payments' | 'bookings' | 'memberships' | 'checkin' | 'devices' | 'score' | 'mail' | 'deploy';

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

async function getState(venueId: string, userId: string) {
  const admin = getServiceClient();
  await ensureDefaults(venueId, userId);

  const [{ data: signals, error: signalsError }, { data: checks, error: checksError }, { data: incidents, error: incidentsError }] = await Promise.all([
    admin.from('ops_signals').select('*').eq('venue_id', venueId).order('signal_key'),
    admin.from('ops_check_state').select('*').eq('venue_id', venueId).order('mode').order('item_index'),
    admin.from('ops_incidents').select('*').eq('venue_id', venueId).order('created_at', { ascending: false }).limit(50),
  ]);

  if (signalsError) throw signalsError;
  if (checksError) throw checksError;
  if (incidentsError) throw incidentsError;

  return {
    signals: signals || [],
    checks: checks || [],
    incidents: incidents || [],
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
      const state = await getState(venueId, userId);
      return jsonResponse({ venueId, ...state }, 200, 5);
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

