import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { resolveCustomerIdForUser } from '../_shared/customers.ts';

type ServiceClient = ReturnType<typeof getServiceClient>;

const PROGRAM_STATUSES = new Set(['active', 'inactive', 'archived']);
const CONSUMPTION_TRIGGERS = new Set(['on_checkin', 'on_commitment', 'on_session_end']);
const NO_SHOW_POLICIES = new Set(['do_not_consume', 'consume', 'manual_review']);
const PUNCH_SCOPES = new Set(['open_play', 'session_type', 'product_key', 'venue', 'selected_venues', 'allowlist']);
const FUNDERS = new Set(['self_prepaid', 'subscription', 'house_comped', 'partner', 'employer', 'sponsor']);

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
          .select('id, program_key, name, activity_label, access_reason, desk_label, funding_counterparty_ref, reimbursement_amount_minor, currency, settlement_rule, agreement_version, agreement_effective_date, consumption_trigger, no_show_policy, status, valid_from, valid_until')
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

    if (req.method === 'GET' && path === 'operations') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const organizationId = await venueOrganization(admin, venueId);
      if (!organizationId) return errorResponse('Venue not found', 404);

      const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const [{ data: rights, error: rightsError }, { data: receivables, error: receivableError }] = await Promise.all([
        admin.from('access_entitlements')
          .select('id, customer_id, user_id, status, access_reason, service_date, activity_session_id, partner_program_id, uses_count, created_at')
          .eq('venue_id', venueId)
          .eq('entitlement_type', 'partner_access')
          .gte('service_date', since)
          .order('service_date', { ascending: false })
          .limit(250),
        admin.from('partner_receivable_events')
          .select('id, partner_program_id, entitlement_consumption_id, customer_id, activity_session_id, event_type, amount_minor, currency, occurred_at, settlement_state')
          .eq('venue_id', venueId)
          .order('occurred_at', { ascending: false })
          .limit(250),
      ]);
      if (rightsError || receivableError) throw new Error(rightsError?.message || receivableError?.message);

      const entitlementIds = (rights || []).map((right: any) => right.id).filter(Boolean);
      const customerIds = [...new Set([
        ...(rights || []).map((right: any) => right.customer_id),
        ...(receivables || []).map((event: any) => event.customer_id),
      ].filter(Boolean))];
      const sessionIds = [...new Set([
        ...(rights || []).map((right: any) => right.activity_session_id),
        ...(receivables || []).map((event: any) => event.activity_session_id),
      ].filter(Boolean))];
      const programIds = [...new Set([
        ...(rights || []).map((right: any) => right.partner_program_id),
        ...(receivables || []).map((event: any) => event.partner_program_id),
      ].filter(Boolean))];

      const [consumptionResult, registrationResult, customerResult, sessionResult, programResult] = await Promise.all([
        entitlementIds.length
          ? admin.from('entitlement_consumptions')
            .select('id, entitlement_id, event_type, reverses_consumption_id, reason, occurred_at')
            .in('entitlement_id', entitlementIds)
            .order('occurred_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        entitlementIds.length
          ? admin.from('session_registrations')
            .select('id, source_id, status')
            .eq('venue_id', venueId)
            .eq('source_type', 'partner_access')
            .in('source_id', entitlementIds)
          : Promise.resolve({ data: [], error: null }),
        customerIds.length
          ? admin.from('customers').select('id, display_name, first_name, last_name').in('id', customerIds)
          : Promise.resolve({ data: [], error: null }),
        sessionIds.length
          ? admin.from('activity_sessions').select('id, name, start_time, end_time').in('id', sessionIds)
          : Promise.resolve({ data: [], error: null }),
        programIds.length
          ? admin.from('partner_programs').select('id, name, desk_label').eq('organization_id', organizationId).in('id', programIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const readError = consumptionResult.error || registrationResult.error || customerResult.error || sessionResult.error || programResult.error;
      if (readError) throw new Error(readError.message);

      const customerById = new Map((customerResult.data || []).map((customer: any) => [customer.id, customer]));
      const sessionById = new Map((sessionResult.data || []).map((session: any) => [session.id, session]));
      const programById = new Map((programResult.data || []).map((program: any) => [program.id, program]));
      const registrationByEntitlement = new Map((registrationResult.data || []).map((registration: any) => [registration.source_id, registration]));
      const consumptionsByEntitlement = new Map<string, any[]>();
      for (const consumption of consumptionResult.data || []) {
        const current = consumptionsByEntitlement.get(consumption.entitlement_id) || [];
        current.push(consumption);
        consumptionsByEntitlement.set(consumption.entitlement_id, current);
      }
      const customerName = (customer: any) => [customer?.first_name, customer?.last_name]
        .map((part) => String(part || '').trim()).filter(Boolean).join(' ') || customer?.display_name || 'Kund';

      return jsonResponse({
        assignments: (rights || []).map((right: any) => {
          const events = consumptionsByEntitlement.get(right.id) || [];
          const use = events.find((event: any) => event.event_type === 'use');
          const reversed = use && events.some((event: any) => event.event_type === 'reversal' && event.reverses_consumption_id === use.id);
          const program = programById.get(right.partner_program_id);
          const registration = registrationByEntitlement.get(right.id);
          return {
            id: right.id,
            status: right.status,
            access_reason: right.access_reason,
            service_date: right.service_date,
            customer: { id: right.customer_id, name: customerName(customerById.get(right.customer_id)) },
            activity: sessionById.get(right.activity_session_id) || null,
            program: program ? { name: program.name, desk_label: program.desk_label } : null,
            registration: registration ? { id: registration.id, status: registration.status } : null,
            attendance: use && !reversed ? { consumption_id: use.id, occurred_at: use.occurred_at, reconciled: Boolean(use.reason) } : null,
          };
        }),
        receivables: (receivables || []).map((event: any) => ({
          id: event.id,
          event_type: event.event_type,
          amount_minor: event.amount_minor,
          currency: event.currency,
          occurred_at: event.occurred_at,
          settlement_state: event.settlement_state,
          customer_name: customerName(customerById.get(event.customer_id)),
          activity_name: sessionById.get(event.activity_session_id)?.name || 'Aktivitet',
          program_name: programById.get(event.partner_program_id)?.name || 'Partner',
        })),
      });
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
      const currency = String(body.currency || 'SEK').trim().toUpperCase();
      const consumptionTrigger = String(body.consumptionTrigger || 'on_checkin');
      const noShowPolicy = String(body.noShowPolicy || 'do_not_consume');
      if (currency !== 'SEK') return errorResponse('Unsupported reimbursement currency');
      if (!CONSUMPTION_TRIGGERS.has(consumptionTrigger)) return errorResponse('Invalid consumption trigger');
      if (!NO_SHOW_POLICIES.has(noShowPolicy)) return errorResponse('Invalid no-show policy');

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
        currency,
        settlement_rule: body.settlementRule && typeof body.settlementRule === 'object' ? body.settlementRule : {},
        consumption_trigger: consumptionTrigger,
        no_show_policy: noShowPolicy,
        ...(body.agreementVersion ? { agreement_version: String(body.agreementVersion).trim() } : {}),
        ...(body.agreementEffectiveDate ? { agreement_effective_date: String(body.agreementEffectiveDate) } : {}),
        valid_from: body.validFrom || null,
        valid_until: body.validUntil || null,
        created_by: userId,
      }).select('id, program_key, name, activity_label, access_reason, desk_label, funding_counterparty_ref, reimbursement_amount_minor, currency, settlement_rule, agreement_version, agreement_effective_date, consumption_trigger, no_show_policy, status, valid_from, valid_until').single();
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
        agreementVersion: 'agreement_version', agreementEffectiveDate: 'agreement_effective_date',
        consumptionTrigger: 'consumption_trigger', noShowPolicy: 'no_show_policy',
        validFrom: 'valid_from', validUntil: 'valid_until', reimbursementAmountMinor: 'reimbursement_amount_minor', status: 'status',
      };
      for (const [input, column] of Object.entries(fields)) {
        if (Object.prototype.hasOwnProperty.call(body, input)) updates[column] = body[input];
      }
      if (updates.status && !PROGRAM_STATUSES.has(String(updates.status))) return errorResponse('Invalid status');
      if (updates.consumption_trigger && !CONSUMPTION_TRIGGERS.has(String(updates.consumption_trigger))) return errorResponse('Invalid consumption trigger');
      if (updates.no_show_policy && !NO_SHOW_POLICIES.has(String(updates.no_show_policy))) return errorResponse('Invalid no-show policy');
      if (updates.reimbursement_amount_minor != null) {
        const amount = Number(updates.reimbursement_amount_minor);
        if (!Number.isInteger(amount) || amount < 0) return errorResponse('Invalid reimbursement amount');
        updates.reimbursement_amount_minor = amount;
      }
      const { data, error } = await admin.from('partner_programs').update(updates).eq('id', programId)
        .select('id, program_key, name, activity_label, access_reason, desk_label, funding_counterparty_ref, reimbursement_amount_minor, currency, settlement_rule, agreement_version, agreement_effective_date, consumption_trigger, no_show_policy, status, valid_from, valid_until')
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

    if (req.method === 'POST' && path === 'revoke-partner-entitlement') {
      const body = await req.json();
      const venueId = String(body.venueId || '');
      const entitlementId = String(body.entitlementId || '');
      const reason = String(body.reason || '').trim();
      if (!venueId || !entitlementId || !reason) return errorResponse('Missing revocation fields');
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const { data: entitlement, error: entitlementError } = await admin.from('access_entitlements')
        .select('id, venue_id, entitlement_type, status, metadata')
        .eq('id', entitlementId)
        .maybeSingle();
      if (entitlementError) throw new Error(entitlementError.message);
      if (!entitlement || entitlement.venue_id !== venueId || entitlement.entitlement_type !== 'partner_access') {
        return errorResponse('Partner entitlement outside venue scope', 403);
      }
      if (entitlement.status === 'revoked') return jsonResponse({ id: entitlement.id, status: 'revoked', idempotent: true });
      const { data, error } = await admin.from('access_entitlements').update({
        status: 'revoked',
        operator_note: reason,
        metadata: {
          ...(entitlement.metadata && typeof entitlement.metadata === 'object' ? entitlement.metadata : {}),
          revocation: { reason, actor_id: userId, occurred_at: new Date().toISOString() },
        },
      }).eq('id', entitlementId).eq('venue_id', venueId)
        .select('id, status').single();
      if (error) throw new Error(error.message);
      return jsonResponse({ ...data, idempotent: false });
    }

    if (req.method === 'POST' && path === 'reconcile-attendance') {
      const body = await req.json();
      const venueId = String(body.venueId || '');
      const entitlementId = String(body.entitlementId || '');
      const registrationId = String(body.registrationId || '');
      const reason = String(body.reason || '').trim();
      const idempotencyKey = String(body.idempotencyKey || '').trim();
      if (!venueId || !entitlementId || !registrationId || !reason || !idempotencyKey) {
        return errorResponse('Missing reconciliation fields');
      }
      if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403);
      const [{ data: entitlement, error: entitlementError }, { data: registration, error: registrationError }] = await Promise.all([
        admin.from('access_entitlements')
          .select('id, venue_id, customer_id, entitlement_type, status, activity_session_id, service_date')
          .eq('id', entitlementId).maybeSingle(),
        admin.from('session_registrations')
          .select('id, venue_id, customer_id, activity_session_id, session_date, source_type, source_id, status')
          .eq('id', registrationId).maybeSingle(),
      ]);
      if (entitlementError || registrationError) throw new Error(entitlementError?.message || registrationError?.message);
      if (!entitlement || entitlement.venue_id !== venueId || entitlement.entitlement_type !== 'partner_access') {
        return errorResponse('Partner entitlement outside venue scope', 403);
      }
      if (!registration || registration.venue_id !== venueId
        || registration.customer_id !== entitlement.customer_id
        || registration.activity_session_id !== entitlement.activity_session_id
        || registration.session_date !== entitlement.service_date
        || registration.source_type !== 'partner_access'
        || registration.source_id !== entitlement.id
        || !['confirmed', 'checked_in', 'no_show'].includes(String(registration.status || ''))) {
        return errorResponse('Registration does not match the partner entitlement', 409);
      }
      const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : new Date();
      if (Number.isNaN(occurredAt.getTime())) return errorResponse('Invalid occurrence time');
      const { data, error } = await admin.rpc('consume_access_entitlement', {
        p_entitlement_id: entitlement.id,
        p_customer_id: entitlement.customer_id,
        p_venue_id: venueId,
        p_idempotency_key: idempotencyKey,
        p_quantity: 1,
        p_activity_session_id: registration.activity_session_id,
        p_session_date: registration.session_date,
        p_registration_id: registration.id,
        p_venue_checkin_id: null,
        p_commerce_order_id: null,
        p_occurred_at: occurredAt.toISOString(),
        p_access_context: { source: 'manual_reconciliation', reason, channel: 'admin' },
        p_created_by: userId,
      });
      if (error) throw new Error(error.message);
      return jsonResponse(data);
    }

    if (req.method === 'POST' && path === 'legacy-punch-card') {
      const body = await req.json();
      const venueId = String(body.venueId || '');
      const scopeType = String(body.scopeType || '');
      const funder = String(body.funder || '');
      if (!venueId || !PUNCH_SCOPES.has(scopeType) || !FUNDERS.has(funder) || !body.legacySourceRef || !body.operatorNote) {
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
        p_funder: funder,
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
