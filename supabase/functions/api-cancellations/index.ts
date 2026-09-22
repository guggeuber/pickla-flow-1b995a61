import { corsHeaders, privateErrorResponse, privateJsonResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { canOperateVenue, requireVenueRole } from '../_shared/authorization.ts';
import { requireStripeRuntimeEnvironment } from '../_shared/stripe_environment.ts';
import { confirmCancellationAndDispatchRefund } from '../_shared/cancellation_execution.ts';

const SUBJECT_TYPES = new Set([
  'activity_registration', 'booking_participant', 'court_booking',
  'series_commitment', 'league_team_entry',
]);
const POLICY_FAMILIES = new Set([
  'occurrence_ticket', 'booking_participant', 'court_booking',
  'managed_course', 'league_team', 'event',
]);
const PRESET_KEYS = new Set([
  'standard_12h', 'court_24h', 'course_48h', 'league_registration_close',
  'event_24h', 'event_non_refundable',
]);
const BINDING_SUBJECT_TYPES = new Set(['family_default', 'access_product', 'activity_series', 'event']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type JsonRecord = Record<string, unknown>;

function pathFor(req: Request) {
  const pathname = new URL(req.url).pathname;
  const functionPrefix = '/api-cancellations';
  const prefixIndex = pathname.indexOf(functionPrefix);
  const path = prefixIndex >= 0
    ? pathname.slice(prefixIndex + functionPrefix.length)
    : pathname;
  return path.replace(/^\/+|\/+$/g, '');
}

function safeDecision(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const {
    payer_user_id: _payerUserId,
    payer_customer_id: _payerCustomerId,
    stripe_payment_intent_id: _paymentIntentId,
    provider_request: _providerRequest,
    ...safe
  } = value as JsonRecord;
  return safe;
}

function rpcErrorStatus(message: string) {
  if (message.includes('stale_cancellation_preview')) return 409;
  if (message.includes('cancellation_not_allowed') || message.includes('already_cancelled')) return 409;
  if (message.includes('owner_mismatch') || message.includes('Forbidden')) return 403;
  if (message.includes('not_found')) return 404;
  if (message.includes('snapshot_missing') || message.includes('snapshot_required_after_cutover')
    || message.includes('payment_intent_missing')) return 409;
  return 400;
}

async function requireStaffForDecision(
  admin: ReturnType<typeof getServiceClient>,
  userId: string,
  decision: unknown,
) {
  const venueId = String(
    decision && typeof decision === 'object'
      ? (decision as JsonRecord).venue_id || ''
      : '',
  );
  if (!UUID_PATTERN.test(venueId) || !await canOperateVenue(admin, userId, venueId)) {
    throw new Error('Forbidden');
  }
  return venueId;
}

export const cancellationsHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const path = pathFor(req);
  const url = new URL(req.url);
  const admin = getServiceClient();

  try {
    if (req.method === 'GET' && path === 'public-policy') {
      const venueId = String(url.searchParams.get('venueId') || '');
      const family = String(url.searchParams.get('family') || '');
      if (!UUID_PATTERN.test(venueId) || !POLICY_FAMILIES.has(family)) {
        return privateErrorResponse('Invalid cancellation policy lookup', 400);
      }
      const { data, error } = await admin.rpc('cancellation_policy_public_projection', {
        p_venue_id: venueId,
        p_policy_family: family,
        p_access_product_id: url.searchParams.get('productId') || null,
        p_activity_series_id: url.searchParams.get('seriesId') || null,
        p_event_id: url.searchParams.get('eventId') || null,
      });
      if (error) return privateErrorResponse(error.message, 400);
      if (!data) return privateErrorResponse('Cancellation policy not configured', 404);
      return jsonResponse(data, 200, 60);
    }

    const auth = await getAuthenticatedClient(req);
    if (auth.error || !auth.userId) return privateErrorResponse('Unauthorized', 401);
    const userId = auth.userId;

    if (req.method === 'POST' && ['preview', 'staff-preview'].includes(path)) {
      const body = await req.json();
      const subjectType = String(body.subject_type || body.subjectType || '');
      const subjectId = String(body.subject_id || body.subjectId || '');
      const staffOverride = path === 'staff-preview';
      const staffRefundChoice = staffOverride ? String(body.refund_choice || 'policy') : 'policy';
      const staffRestoreChoice = staffOverride ? String(body.restore_choice || 'policy') : 'policy';
      if (!SUBJECT_TYPES.has(subjectType) || !UUID_PATTERN.test(subjectId)) {
        return privateErrorResponse('Invalid cancellation subject', 400);
      }
      const { data, error } = await admin.rpc('cancellation_subject_state', {
        p_subject_type: subjectType,
        p_subject_id: subjectId,
        p_actor_user_id: userId,
        p_staff_override: staffOverride,
        p_now: new Date().toISOString(),
        p_staff_refund_choice: staffRefundChoice,
        p_staff_restore_choice: staffRestoreChoice,
      });
      if (error) return privateErrorResponse(error.message, rpcErrorStatus(error.message));
      if (staffOverride) await requireStaffForDecision(admin, userId, data);
      return privateJsonResponse(safeDecision(data), 200);
    }

    if (req.method === 'POST' && ['confirm', 'staff-confirm'].includes(path)) {
      const body = await req.json();
      const subjectType = String(body.subject_type || body.subjectType || '');
      const subjectId = String(body.subject_id || body.subjectId || '');
      const expectedRevision = String(body.state_revision || body.stateRevision || '');
      const requestId = String(body.request_id || body.requestId || req.headers.get('x-pickla-request-id') || crypto.randomUUID());
      const staffOverride = path === 'staff-confirm';
      const staffReason = staffOverride ? String(body.reason || '').trim() : null;
      const staffRefundChoice = staffOverride ? String(body.refund_choice || 'policy') : 'policy';
      const staffRestoreChoice = staffOverride ? String(body.restore_choice || 'policy') : 'policy';
      if (!SUBJECT_TYPES.has(subjectType) || !UUID_PATTERN.test(subjectId) || !expectedRevision) {
        return privateErrorResponse('Invalid cancellation confirmation', 400);
      }
      if (staffOverride) {
        const { data: staffPreview, error: staffPreviewError } = await admin.rpc('cancellation_subject_state', {
          p_subject_type: subjectType,
          p_subject_id: subjectId,
          p_actor_user_id: userId,
          p_staff_override: true,
          p_now: new Date().toISOString(),
          p_staff_refund_choice: staffRefundChoice,
          p_staff_restore_choice: staffRestoreChoice,
        });
        if (staffPreviewError) return privateErrorResponse(staffPreviewError.message, rpcErrorStatus(staffPreviewError.message));
        await requireStaffForDecision(admin, userId, staffPreview);
      }
      let runtime;
      try {
        runtime = requireStripeRuntimeEnvironment();
      } catch (error) {
        // A no-refund cancellation can still complete without Stripe. The RPC
        // will fail closed if a refund is required but payment data is missing.
        runtime = {
          stripeKey: '',
          stripeMode: Deno.env.get('PICKLA_ENVIRONMENT') === 'production' ? 'live' : 'test',
        };
      }
      let result;
      try {
        result = await confirmCancellationAndDispatchRefund({
          admin,
          subjectType,
          subjectId,
          actorUserId: userId,
          expectedRevision,
          requestId,
          staffOverride,
          staffReason,
          staffRefundChoice: staffRefundChoice as 'policy' | 'full' | 'none',
          staffRestoreChoice: staffRestoreChoice as 'policy' | 'restore' | 'none',
          stripeKey: runtime.stripeKey,
          stripeMode: runtime.stripeMode,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cancellation confirmation failed';
        return privateErrorResponse(message, rpcErrorStatus(message));
      }
      return privateJsonResponse({
        ...safeDecision(result.decision),
        refund_status: result.refundStatus,
        refund_processing: result.refundProcessing,
      }, result.refundProcessing ? 202 : 200);
    }

    if (req.method === 'GET' && path === 'admin') {
      const venueId = String(url.searchParams.get('venueId') || '');
      if (!UUID_PATTERN.test(venueId)) return privateErrorResponse('Invalid venue', 400);
      await requireVenueRole(admin, userId, venueId, ['venue_admin']);
      const [
        { data: policies, error: policyError },
        { data: bindings, error: bindingError },
        { data: decisions, error: decisionError },
        { data: cutovers, error: cutoverError },
        { data: rolloutPreflight, error: preflightError },
      ] = await Promise.all([
        admin.from('cancellation_policies').select('id,policy_key,policy_family,name,cancellation_policy_versions(*)')
          .eq('venue_id', venueId).order('policy_family'),
        admin.from('cancellation_policy_bindings').select('*,cancellation_policy_versions(id,version,preset_key,copy_sv,copy_en,rules)')
          .eq('venue_id', venueId).eq('is_active', true).order('policy_family'),
        admin.from('cancellation_decisions').select('*').eq('venue_id', venueId)
          .order('created_at', { ascending: false }).limit(100),
        admin.from('cancellation_policy_cutovers').select('*').eq('venue_id', venueId)
          .order('authority_key'),
        admin.rpc('cancellation_policy_rollout_preflight', { p_venue_id: venueId }),
      ]);
      if (policyError || bindingError || decisionError || cutoverError || preflightError) {
        throw new Error(policyError?.message || bindingError?.message || decisionError?.message
          || cutoverError?.message || preflightError?.message);
      }
      const decisionRows = (decisions || []) as JsonRecord[];
      const snapshotIds = [...new Set(decisionRows.map((decision) => decision.snapshot_id).filter(Boolean))];
      const decisionIds = decisionRows.map((decision) => decision.id);
      const [{ data: snapshots, error: snapshotError }, { data: refunds, error: refundError }] = await Promise.all([
        snapshotIds.length
          ? admin.from('cancellation_policy_snapshots').select('*').in('id', snapshotIds)
          : Promise.resolve({ data: [], error: null }),
        decisionIds.length
          ? admin.from('commerce_refunds').select('id,cancellation_decision_id,status,amount_inc_vat_minor,currency,last_error,created_at,completed_at').in('cancellation_decision_id', decisionIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (snapshotError || refundError) throw new Error(snapshotError?.message || refundError?.message);
      return privateJsonResponse({
        policies: policies || [],
        bindings: bindings || [],
        cutovers: cutovers || [],
        rollout_preflight: rolloutPreflight || null,
        decisions: decisions || [],
        snapshots: snapshots || [],
        refunds: refunds || [],
      }, 200);
    }

    if (req.method === 'POST' && path === 'admin/binding') {
      const body = await req.json();
      const venueId = String(body.venue_id || body.venueId || '');
      const family = String(body.policy_family || body.family || '');
      const presetKey = String(body.preset_key || body.presetKey || '');
      const subjectType = String(body.subject_type || body.subjectType || 'family_default');
      const subjectId = body.subject_id || body.subjectId || null;
      const reason = String(body.reason || 'Admin preset selection').trim();
      if (!UUID_PATTERN.test(venueId) || !POLICY_FAMILIES.has(family)
        || !PRESET_KEYS.has(presetKey) || !BINDING_SUBJECT_TYPES.has(subjectType)
        || (subjectType === 'family_default' ? subjectId != null : !UUID_PATTERN.test(String(subjectId || '')))) {
        return privateErrorResponse('Invalid cancellation policy binding', 400);
      }
      await requireVenueRole(admin, userId, venueId, ['venue_admin']);
      const { data, error } = await admin.rpc('set_cancellation_policy_binding', {
        p_venue_id: venueId,
        p_policy_family: family,
        p_preset_key: presetKey,
        p_subject_type: subjectType,
        p_subject_id: subjectId,
        p_actor_user_id: userId,
        p_reason: reason,
      });
      if (error) return privateErrorResponse(error.message, rpcErrorStatus(error.message));
      return privateJsonResponse({ binding: data, applies_to: 'new_purchases_only' }, 200);
    }

    return privateErrorResponse('Not found', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cancellation request failed';
    return privateErrorResponse(message, rpcErrorStatus(message));
  }
};

Deno.serve(cancellationsHandler);
