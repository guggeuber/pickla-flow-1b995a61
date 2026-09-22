import {
  assertTrackedRefundContract,
  createOrRecoverTrackedRefund,
  trackedRefundProviderStatus,
  type StripeRefundPayload,
  type TrackedRefundCommand,
} from './commerce_refunds.ts';
import { getServiceClient } from './auth.ts';

type CancellationConfirmation = {
  admin: ReturnType<typeof getServiceClient>;
  subjectType: string;
  subjectId: string;
  actorUserId: string;
  expectedRevision: string;
  requestId: string;
  staffOverride?: boolean;
  staffReason?: string | null;
  staffRefundChoice?: 'policy' | 'full' | 'none';
  staffRestoreChoice?: 'policy' | 'restore' | 'none';
  stripeKey: string;
  stripeMode: string;
};

async function reconcileProviderRefund(
  admin: ReturnType<typeof getServiceClient>,
  command: TrackedRefundCommand,
  providerRefund: StripeRefundPayload,
) {
  assertTrackedRefundContract(command, providerRefund);
  const providerStatus = trackedRefundProviderStatus(providerRefund);
  const { error } = await admin.rpc('commerce_r2a_reconcile_refund', {
    p_refund_id: command.id,
    p_provider_refund_id: providerRefund.id,
    p_provider_status: providerStatus,
    p_provider_response: providerRefund,
    p_error: providerStatus === 'failed'
      ? `Stripe refund ${providerRefund.status}${providerRefund.failure_reason ? `: ${providerRefund.failure_reason}` : ''}`
      : null,
  });
  if (error) throw new Error(error.message);
  return providerStatus;
}

/**
 * Executes the one canonical cancellation command, then delivers its durable
 * refund command outside the database transaction. Capacity truth is already
 * committed if provider delivery fails; R2A recovery owns convergence.
 */
export async function confirmCancellationAndDispatchRefund(input: CancellationConfirmation) {
  const { data: decision, error } = await input.admin.rpc('confirm_cancellation_policy_v1', {
    p_subject_type: input.subjectType,
    p_subject_id: input.subjectId,
    p_actor_user_id: input.actorUserId,
    p_expected_state_revision: input.expectedRevision,
    p_request_id: input.requestId,
    p_staff_override: input.staffOverride === true,
    p_staff_reason: input.staffReason || null,
    p_provider_environment: input.stripeMode,
    p_provider_account_key: 'platform',
    p_staff_refund_choice: input.staffRefundChoice || 'policy',
    p_staff_restore_choice: input.staffRestoreChoice || 'policy',
  });
  if (error) throw new Error(error.message);

  let refundStatus = decision?.refund_status || null;
  let refundProcessing = Boolean(decision?.refund_id);
  if (decision?.refund_id) {
    const { data: command, error: commandError } = await input.admin.from('commerce_refunds')
      .select('*').eq('id', decision.refund_id).maybeSingle();
    if (commandError || !command) throw new Error(commandError?.message || 'Durable refund command missing');
    if (!input.stripeKey) {
      return { decision, refundStatus, refundProcessing: true };
    }
    try {
      const providerRefund = await createOrRecoverTrackedRefund(
        input.stripeKey,
        command as TrackedRefundCommand,
      );
      refundStatus = await reconcileProviderRefund(input.admin, command, providerRefund);
      refundProcessing = refundStatus === 'pending';
    } catch (providerError) {
      console.error('Cancellation refund queued for R2A recovery:', providerError);
      refundStatus = 'preparing';
      refundProcessing = true;
    }
  }
  return { decision, refundStatus, refundProcessing };
}
