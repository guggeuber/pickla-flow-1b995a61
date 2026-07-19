export type CommerceParticipationCommitResult = {
  ok: boolean;
  registration_id?: string | null;
  reason?: string | null;
};

export type PaidFulfillmentFailure = {
  kind: 'commit_rejected' | 'rpc_error';
  category: string;
  message: string;
};

export type CommerceParticipationDependencies = {
  commitRegistration: (args: Record<string, unknown>) => Promise<CommerceParticipationCommitResult>;
  markOrderAttention: () => Promise<void>;
  markLineAttention: () => Promise<void>;
  recordIncident: (failure: PaidFulfillmentFailure) => Promise<void>;
  linkRegistration: (registrationId: string) => Promise<void>;
  upsertEntitlement: (registrationId: string) => Promise<void>;
  announceRegistration?: (registrationId: string) => Promise<void>;
  onFailureHandlingError?: (error: unknown) => void;
};

export type CommerceParticipationInput = {
  lineTotalIncVatMinor: number;
  commitArgs: Record<string, unknown>;
};

const MAX_SAFE_ERROR_MESSAGE_LENGTH = 240;

export function legacyWholeSekFromMinor(minorUnits: number) {
  const amount = Number(minorUnits);
  if (!Number.isFinite(amount)) {
    throw new Error('Invalid participation line total minor units');
  }
  return Math.max(0, Math.round(amount / 100));
}

function sanitizeErrorMessage(value: unknown) {
  const raw = String(value || 'Registration RPC failed')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\+\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
    .replace(/\b(?:Bearer\s+)?(?:sk|rk|whsec)_(?:live|test)?_?[A-Za-z0-9._-]+\b/gi, '[redacted-secret]')
    .replace(/\s+/g, ' ')
    .trim();
  return (raw || 'Registration RPC failed').slice(0, MAX_SAFE_ERROR_MESSAGE_LENGTH);
}

export function safePaidFulfillmentError(error: unknown): PaidFulfillmentFailure {
  const sanitized = sanitizeErrorMessage(error instanceof Error ? error.message : error);
  if (/invalid participation line total minor units/i.test(sanitized)) {
    return {
      kind: 'rpc_error',
      category: 'registration_amount_invalid',
      message: 'Participation line total was not a valid minor-unit amount',
    };
  }
  if (/invalid input syntax.*integer/i.test(sanitized)) {
    const rejectedValue = sanitized.match(/invalid input syntax.*integer:\s*"([0-9.+-]{1,32})"/i)?.[1];
    return {
      kind: 'rpc_error',
      category: 'registration_rpc_invalid_integer',
      message: rejectedValue
        ? `Registration RPC rejected non-integer value "${rejectedValue}"`
        : 'Registration RPC rejected a non-integer value',
    };
  }
  if (/row-level security|permission denied|not authorized/i.test(sanitized)) {
    return {
      kind: 'rpc_error',
      category: 'registration_rpc_authorization',
      message: 'Registration RPC authorization failed',
    };
  }
  if (/duplicate|unique constraint|23505/i.test(sanitized)) {
    return {
      kind: 'rpc_error',
      category: 'registration_rpc_conflict',
      message: 'Registration RPC reported a uniqueness conflict',
    };
  }
  if (/timeout|timed out|deadline exceeded/i.test(sanitized)) {
    return {
      kind: 'rpc_error',
      category: 'registration_rpc_timeout',
      message: 'Registration RPC timed out',
    };
  }
  return {
    kind: 'rpc_error',
    category: 'registration_rpc_error',
    message: 'Registration RPC failed',
  };
}

function safeCommitReason(reason: unknown) {
  const normalized = String(reason || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_')
    .slice(0, 80);
  return normalized || 'unknown';
}

async function handleFailure(
  dependencies: CommerceParticipationDependencies,
  failure: PaidFulfillmentFailure,
) {
  const results = await Promise.allSettled([
    dependencies.markOrderAttention(),
    dependencies.markLineAttention(),
    dependencies.recordIncident(failure),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      dependencies.onFailureHandlingError?.(result.reason);
    }
  }
}

export async function paidFulfillmentIncidentIdentity(orderId: string, orderLineId: string) {
  const agentKey = `paid_fulfillment_failure:${orderId}:${orderLineId}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(agentKey));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const incidentId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { agentKey, incidentId };
}

export async function fulfillCommerceParticipation(
  input: CommerceParticipationInput,
  dependencies: CommerceParticipationDependencies,
) {
  let commit: CommerceParticipationCommitResult;
  try {
    commit = await dependencies.commitRegistration({
      ...input.commitArgs,
      p_price_paid_sek: legacyWholeSekFromMinor(input.lineTotalIncVatMinor),
    });
  } catch (error) {
    await handleFailure(dependencies, safePaidFulfillmentError(error));
    throw error;
  }

  if (!commit.ok || !commit.registration_id) {
    const reason = safeCommitReason(commit.reason);
    await handleFailure(dependencies, {
      kind: 'commit_rejected',
      category: `registration_commit_${reason}`,
      message: `Registration commit rejected: ${reason}`,
    });
    return { ok: false, registrationId: null };
  }

  await dependencies.linkRegistration(commit.registration_id);
  await dependencies.upsertEntitlement(commit.registration_id);
  await dependencies.announceRegistration?.(commit.registration_id);
  return { ok: true, registrationId: commit.registration_id };
}
