import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { resolveCustomerIdForUser } from '../_shared/customers.ts';

type ServiceClient = ReturnType<typeof getServiceClient>;

const PROGRAM_STATUSES = new Set(['active', 'inactive', 'archived']);
const PUNCH_SCOPES = new Set(['open_play', 'session_type', 'product_key', 'venue', 'selected_venues', 'allowlist']);

async function canOperateVenue(admin: ServiceClient, userId: string, venueId: string) {
  const [{ data: role }, { data: staff }] = await Promise.all([
    admin.from('user_roles').select('id').eq('user_id', userId).eq('role', 'super_admin').maybeSingle(),
    admin.from('venue_staff').select('id').eq('user_id', userId).eq('venue_id', venueId).eq('is_active', true).maybeSingle(),
  ]);
  return Boolean(role || staff);
}

async function venueOrganization(admin: ServiceClient, venueId: string) {
  const { data, error } = await admin.from('venues').select('organization_id').eq('id', venueId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.organization_id as string | undefined;
}

async function resolveTargetCustomer(
  admin: ServiceClient,
  venueId: string,
  customerId?: string | null,
  targetUserId?: string | null,
) {
  const organizationId = await venueOrganization(admin, venueId);
  if (!organizationId) throw new Error('Venue not found');

  const resolvedId = customerId || (targetUserId ? await resolveCustomerIdForUser(admin, targetUserId) : null);
  if (!resolvedId) throw new Error('Customer could not be resolved');

  const { data: customer, error } = await admin.from('customers')
    .select('id, auth_user_id, organization_id, status, merged_into_id')
    .eq('id', resolvedId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!customer || customer.organization_id !== organizationId || customer.status !== 'active' || customer.merged_into_id) {
    throw new Error('Customer is outside the venue organization');
  }
  if (targetUserId && customer.auth_user_id && customer.auth_user_id !== targetUserId) {
    throw new Error('Customer and user do not match');
  }
  return { customerId: customer.id as string, userId: customer.auth_user_id as string | null, organizationId };
}

function publicProgramActive(program: any, now: number) {
  const validFrom = program.valid_from ? Date.parse(program.valid_from) : null;
  const validUntil = program.valid_until ? Date.parse(program.valid_until) : null;
  return program.status === 'active'
    && (!validFrom || now >= validFrom)
    && (!validUntil || now < validUntil);
}

function remainingUses(row: any) {
  if (row.meter_type !== 'occurrences' && row.meter_type !== 'exact_session') return null;
  return Math.max(0, Number(row.uses_limit || 0) - Number(row.uses_count || 0));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.split('/').filter(Boolean).pop() || '';
  const admin = getServiceClient();

  try {
    // Public projection: a factual label only. Program IDs and finance metadata never leave this endpoint.
    if (req.method === 'GET' && path === 'session-labels') {
      const venueId = url.searchParams.get('venueId');
      const sessionId = url.searchParams.get('sessionId');
      if (!venueId || !sessionId) return errorResponse('Missing venueId or sessionId');

      const { data: eligible, error: eligibilityError } = await admin.from('partner_program_sessions')
        .select('partner_program_id')
        .eq('venue_id', venueId)
        .eq('activity_session_id', sessionId)
        .eq('status', 'eligible');
      if (eligibilityError) {
        console.error('session-labels eligibility failed', eligibilityError.message);
        return errorResponse('Partner labels unavailable', 500);
      }
      const programIds = [...new Set((eligible || []).map((row: any) => row.partner_program_id).filter(Boolean))];
      if (programIds.length === 0) return jsonResponse({ labels: [] }, 200, 30);

      const { data: programs, error: programError } = await admin.from('partner_programs')
        .select('id, activity_label, status, valid_from, valid_until')
        .in('id', programIds);
      if (programError) {
        console.error('session-labels program lookup failed', programError.message);
        return errorResponse('Partner labels unavailable', 500);
      }
      const now = Date.now();
      return jsonResponse({
        labels: (programs || [])
          .filter((program: any) => publicProgramActive(program, now))
          .map((program: any) => ({ label: program.activity_label })),
      }, 200, 30);
    }

    const { userId, error: authError } = await getAuthenticatedClient(req);
    if (authError || !userId) return errorResponse(authError || 'Unauthorized', 401);

    if (req.method === 'GET' && path === 'my') {
      const customerId = await resolveCustomerIdForUser(admin, userId);
      if (!customerId) return jsonResponse({ rights: [] });

      const now = new Date().toISOString();
      const { data: rows, error } = await admin.from('access_entitlements')
        .select('id, venue_id, entitlement_type, status, access_reason, meter_type, starts_at, expires_at, service_date, uses_limit, uses_count')
        .eq('customer_id', customerId)
        .eq('model_version', 2)
        .in('entitlement_type', ['punch_card', 'partner_access'])
        .eq('status', 'active')
        .or(`starts_at.is.null,starts_at.lte.${now}`)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);

      const venueIds = [...new Set((rows || []).map((row: any) => row.venue_id).filter(Boolean))];
      const { data: venues, error: venueError } = venueIds.length
        ? await admin.from('venues').select('id, name, slug').in('id', venueIds)
        : { data: [], error: null };
      if (venueError) throw new Error(venueError.message);
      const venueById = new Map((venues || []).map((venue: any) => [venue.id, venue]));

      return jsonResponse({
        rights: (rows || []).map((row: any) => ({
          id: row.id,
          type: row.entitlement_type,
          status: row.status,
          label: row.entitlement_type === 'punch_card'
            ? `Klippkort · ${remainingUses(row)} gånger kvar`
            : row.access_reason,
          remaining_uses: remainingUses(row),
          starts_at: row.starts_at,
          expires_at: row.expires_at,
          service_date: row.service_date,
          venue: venueById.get(row.venue_id) || null,
        })),
      });
    }

    if (req.method === 'GET' && path === 'programs') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const organizationId = await venueOrganization(admin, venueId);
      if (!organizationId) return errorResponse('Venue not found', 404);

      const [{ data: programs, error: programError }, { data: eligibility, error: eligibilityError }] = await Promise.all([
        admin.from('partner_programs')
          .select('id, program_key, name, activity_label, access_reason, desk_label, reimbursement_amount_minor, currency, settlement_rule, status, valid_from, valid_until')
          .eq('organization_id', organizationId)
          .neq('status', 'archived')
          .order('name'),
        admin.from('partner_program_sessions')
          .select('id, partner_program_id, activity_session_id, status, reimbursement_amount_minor')
          .eq('venue_id', venueId),
      ]);
      if (programError || eligibilityError) throw new Error(programError?.message || eligibilityError?.message);
      return jsonResponse({ programs: programs || [], session_eligibility: eligibility || [] });
    }

    if (req.method === 'GET' && path === 'customer') {
      const venueId = url.searchParams.get('venueId');
      const customerId = url.searchParams.get('customerId');
      if (!venueId || !customerId) return errorResponse('Missing venueId or customerId');
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const target = await resolveTargetCustomer(admin, venueId, customerId, null);

      const { data, error } = await admin.from('access_entitlements')
        .select('id, entitlement_type, status, access_reason, meter_type, starts_at, expires_at, service_date, uses_limit, uses_count, activity_session_id')
        .eq('customer_id', target.customerId)
        .eq('venue_id', venueId)
        .eq('model_version', 2)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return jsonResponse({
        rights: (data || []).map((row: any) => ({
          id: row.id,
          type: row.entitlement_type,
          status: row.status,
          reason: row.access_reason,
          meter: row.meter_type,
          remaining_uses: remainingUses(row),
          starts_at: row.starts_at,
          expires_at: row.expires_at,
          service_date: row.service_date,
          activity_session_id: row.activity_session_id,
        })),
      });
    }

    if (req.method === 'POST' && path === 'programs') {
      const body = await req.json();
      const venueId = String(body.venueId || '');
      if (!venueId || !body.programKey || !body.name || !body.fundingCounterpartyRef) return errorResponse('Missing program fields');
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const organizationId = await venueOrganization(admin, venueId);
      if (!organizationId) return errorResponse('Venue not found', 404);
      const amount = Number(body.reimbursementAmountMinor);
      if (!Number.isInteger(amount) || amount < 0) return errorResponse('Invalid reimbursement amount');

      const name = String(body.name).trim();
      const { data, error } = await admin.from('partner_programs').insert({
        organization_id: organizationId,
        program_key: String(body.programKey).trim(),
        name,
        activity_label: String(body.activityLabel || `${name} gäller`).trim(),
        access_reason: String(body.accessReason || `Ingår via ${name}`).trim(),
        desk_label: String(body.deskLabel || name).trim(),
        funding_counterparty_ref: String(body.fundingCounterpartyRef).trim(),
        reimbursement_amount_minor: amount,
        settlement_rule: body.settlementRule && typeof body.settlementRule === 'object' ? body.settlementRule : {},
        valid_from: body.validFrom || null,
        valid_until: body.validUntil || null,
        created_by: userId,
      }).select('id, program_key, name, activity_label, access_reason, desk_label, reimbursement_amount_minor, currency, settlement_rule, status, valid_from, valid_until').single();
      if (error) throw new Error(error.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'programs') {
      const body = await req.json();
      const venueId = String(body.venueId || '');
      const programId = String(body.programId || '');
      if (!venueId || !programId) return errorResponse('Missing venueId or programId');
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const organizationId = await venueOrganization(admin, venueId);
      const { data: existing } = await admin.from('partner_programs').select('organization_id').eq('id', programId).maybeSingle();
      if (!existing || existing.organization_id !== organizationId) return errorResponse('Program not found', 404);

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const fields: Record<string, string> = {
        name: 'name', activityLabel: 'activity_label', accessReason: 'access_reason', deskLabel: 'desk_label',
        fundingCounterpartyRef: 'funding_counterparty_ref', settlementRule: 'settlement_rule',
        validFrom: 'valid_from', validUntil: 'valid_until', reimbursementAmountMinor: 'reimbursement_amount_minor', status: 'status',
      };
      for (const [input, column] of Object.entries(fields)) {
        if (Object.prototype.hasOwnProperty.call(body, input)) updates[column] = body[input];
      }
      if (updates.status && !PROGRAM_STATUSES.has(String(updates.status))) return errorResponse('Invalid status');
      if (updates.reimbursement_amount_minor != null) {
        const amount = Number(updates.reimbursement_amount_minor);
        if (!Number.isInteger(amount) || amount < 0) return errorResponse('Invalid reimbursement amount');
        updates.reimbursement_amount_minor = amount;
      }
      const { data, error } = await admin.from('partner_programs').update(updates).eq('id', programId)
        .select('id, program_key, name, activity_label, access_reason, desk_label, reimbursement_amount_minor, currency, settlement_rule, status, valid_from, valid_until')
        .single();
      if (error) throw new Error(error.message);
      return jsonResponse(data);
    }

    if (req.method === 'POST' && path === 'session-eligibility') {
      const body = await req.json();
      const venueId = String(body.venueId || '');
      const sessionId = String(body.sessionId || '');
      const programId = String(body.programId || '');
      if (!venueId || !sessionId || !programId) return errorResponse('Missing eligibility fields');
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const organizationId = await venueOrganization(admin, venueId);
      const [{ data: session }, { data: program }] = await Promise.all([
        admin.from('activity_sessions').select('venue_id').eq('id', sessionId).maybeSingle(),
        admin.from('partner_programs').select('organization_id').eq('id', programId).maybeSingle(),
      ]);
      if (!session || session.venue_id !== venueId || !program || program.organization_id !== organizationId) {
        return errorResponse('Program or session outside venue scope', 403);
      }
      const override = body.reimbursementAmountMinor == null ? null : Number(body.reimbursementAmountMinor);
      if (override != null && (!Number.isInteger(override) || override < 0)) return errorResponse('Invalid reimbursement amount');
      const { data, error } = await admin.from('partner_program_sessions').upsert({
        partner_program_id: programId,
        organization_id: organizationId,
        venue_id: venueId,
        activity_session_id: sessionId,
        status: body.eligible === false ? 'ineligible' : 'eligible',
        reimbursement_amount_minor: override,
        created_by: userId,
      }, { onConflict: 'partner_program_id,activity_session_id' })
        .select('id, partner_program_id, activity_session_id, status, reimbursement_amount_minor').single();
      if (error) throw new Error(error.message);
      return jsonResponse(data);
    }

    if (req.method === 'POST' && path === 'partner-entitlement') {
      const body = await req.json();
      const venueId = String(body.venueId || '');
      if (!venueId || !body.programId || !body.sessionId || !body.serviceDate || !body.externalReference) {
        return errorResponse('Missing partner entitlement fields');
      }
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const target = await resolveTargetCustomer(admin, venueId, body.customerId, body.targetUserId);
      const { data, error } = await admin.rpc('issue_partner_entitlement', {
        p_partner_program_id: body.programId,
        p_customer_id: target.customerId,
        p_venue_id: venueId,
        p_activity_session_id: body.sessionId,
        p_service_date: body.serviceDate,
        p_external_reference: body.externalReference,
        p_user_id: target.userId,
        p_starts_at: body.startsAt || null,
        p_expires_at: body.expiresAt || null,
        p_operator_note: body.operatorNote || null,
      });
      if (error) throw new Error(error.message);
      return jsonResponse({ id: data?.id, status: data?.status, reason: data?.access_reason }, 201);
    }

    if (req.method === 'POST' && path === 'legacy-punch-card') {
      const body = await req.json();
      const venueId = String(body.venueId || '');
      const scopeType = String(body.scopeType || '');
      if (!venueId || !PUNCH_SCOPES.has(scopeType) || !body.legacySourceRef || !body.operatorNote) {
        return errorResponse('Missing or invalid legacy punch-card fields');
      }
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const visits = Number(body.remainingVisits);
      if (!Number.isInteger(visits) || visits <= 0) return errorResponse('Remaining visits must be positive');
      const target = await resolveTargetCustomer(admin, venueId, body.customerId, body.targetUserId);
      const { data, error } = await admin.rpc('import_legacy_punch_card', {
        p_customer_id: target.customerId,
        p_venue_id: venueId,
        p_remaining_visits: visits,
        p_scope_type: scopeType,
        p_legacy_source_ref: body.legacySourceRef,
        p_operator_note: body.operatorNote,
        p_imported_by: userId,
        p_valid_from: body.validFrom || null,
        p_valid_until: body.validUntil || null,
        p_includes_session_types: Array.isArray(body.includesSessionTypes) ? body.includesSessionTypes : ['open_play'],
        p_scopes: Array.isArray(body.scopes) ? body.scopes : [],
        p_user_id: target.userId,
      });
      if (error) throw new Error(error.message);
      return jsonResponse({ id: data?.id, status: data?.status, remaining_uses: remainingUses(data) }, 201);
    }

    if (req.method === 'POST' && path === 'adjust-occurrences') {
      const body = await req.json();
      const venueId = String(body.venueId || '');
      if (!venueId || !body.entitlementId || !body.reason || !body.idempotencyKey) return errorResponse('Missing adjustment fields');
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const { data: entitlement } = await admin.from('access_entitlements').select('venue_id').eq('id', body.entitlementId).maybeSingle();
      if (!entitlement || entitlement.venue_id !== venueId) return errorResponse('Entitlement outside venue scope', 403);
      const delta = Number(body.adjustmentDelta);
      if (!Number.isInteger(delta) || delta === 0) return errorResponse('Adjustment delta must be a non-zero integer');
      const { data, error } = await admin.rpc('adjust_entitlement_occurrences', {
        p_entitlement_id: body.entitlementId,
        p_adjustment_delta: delta,
        p_reason: body.reason,
        p_idempotency_key: body.idempotencyKey,
        p_created_by: userId,
      });
      if (error) throw new Error(error.message);
      return jsonResponse(data);
    }

    if (req.method === 'POST' && path === 'reverse-consumption') {
      const body = await req.json();
      const venueId = String(body.venueId || '');
      if (!venueId || !body.consumptionId || !body.reason || !body.idempotencyKey) return errorResponse('Missing reversal fields');
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const { data: consumption } = await admin.from('entitlement_consumptions').select('venue_id').eq('id', body.consumptionId).maybeSingle();
      if (!consumption || consumption.venue_id !== venueId) return errorResponse('Consumption outside venue scope', 403);
      const { data, error } = await admin.rpc('reverse_entitlement_consumption', {
        p_consumption_id: body.consumptionId,
        p_reason: body.reason,
        p_idempotency_key: body.idempotencyKey,
        p_occurred_at: new Date().toISOString(),
        p_created_by: userId,
      });
      if (error) throw new Error(error.message);
      return jsonResponse(data);
    }

    return errorResponse('Not found', 404);
  } catch (error) {
    console.error('api-entitlements failed', error);
    return errorResponse(error instanceof Error ? error.message : 'Internal error', 500);
  }
});
