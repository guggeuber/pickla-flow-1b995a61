export const COURSE_PARTICIPANT_POLICIES = [
  'self_only',
  'self_or_adult',
  'self_adult_or_dependent',
] as const;

export type CourseParticipantPolicy = typeof COURSE_PARTICIPANT_POLICIES[number];
export type CourseParticipantType = 'self' | 'adult' | 'dependent';

export const DEFAULT_COURSE_PARTICIPANT_POLICY: CourseParticipantPolicy = 'self_adult_or_dependent';

export function isCourseParticipantPolicy(value: unknown): value is CourseParticipantPolicy {
  return COURSE_PARTICIPANT_POLICIES.includes(String(value || '') as CourseParticipantPolicy);
}

export function resolveCourseParticipantPolicy(resolverRules: unknown): CourseParticipantPolicy {
  if (!resolverRules || typeof resolverRules !== 'object' || Array.isArray(resolverRules)) {
    return DEFAULT_COURSE_PARTICIPANT_POLICY;
  }
  const configured = (resolverRules as Record<string, unknown>).participant_policy;
  return isCourseParticipantPolicy(configured) ? configured : DEFAULT_COURSE_PARTICIPANT_POLICY;
}

export function courseParticipantTypeAllowed(policy: CourseParticipantPolicy, participantType: CourseParticipantType) {
  if (participantType === 'self') return true;
  if (participantType === 'adult') return policy !== 'self_only';
  return policy === 'self_adult_or_dependent';
}

export function assertCourseParticipantRequest(input: {
  policy: CourseParticipantPolicy;
  participantType: string;
  userId: string | null;
  hasDelegatedInput?: boolean;
}): CourseParticipantType {
  const participantType = input.participantType as CourseParticipantType;
  if (!['self', 'adult', 'dependent'].includes(participantType)
    || !courseParticipantTypeAllowed(input.policy, participantType)) {
    throw new Error('course_participant_policy_violation');
  }
  if (input.policy === 'self_only') {
    if (!input.userId) throw new Error('course_self_only_requires_verified_purchaser');
    if (input.hasDelegatedInput) throw new Error('course_participant_policy_violation');
  }
  return participantType;
}

export function assertCourseParticipantIdentity(input: {
  policy: CourseParticipantPolicy;
  participantType: CourseParticipantType;
  userId: string | null;
  payerCustomerId: string | null;
  participantCustomerId: string | null;
  dependentParticipantId: string | null;
  beneficiaryUserId?: string | null;
}) {
  if (!courseParticipantTypeAllowed(input.policy, input.participantType)) {
    throw new Error('course_participant_policy_violation');
  }
  if (input.participantType === 'self'
    && (!input.participantCustomerId || input.participantCustomerId !== input.payerCustomerId || input.dependentParticipantId)) {
    throw new Error('course_participant_identity_mismatch');
  }
  if (input.participantType === 'adult' && (!input.participantCustomerId || input.dependentParticipantId)) {
    throw new Error('course_participant_identity_mismatch');
  }
  if (input.participantType === 'dependent' && (!input.dependentParticipantId || input.participantCustomerId)) {
    throw new Error('course_participant_identity_mismatch');
  }
  if (input.policy === 'self_only') {
    if (!input.userId || !input.payerCustomerId) throw new Error('course_self_only_requires_verified_purchaser');
    if (input.participantType !== 'self'
      || input.participantCustomerId !== input.payerCustomerId
      || input.dependentParticipantId
      || input.beneficiaryUserId !== input.userId) {
      throw new Error('course_participant_identity_mismatch');
    }
  }
}

type CourseParticipantPolicyClient = {
  from: (table: string) => any;
};

export async function loadCourseParticipantPolicy(
  client: CourseParticipantPolicyClient,
  input: { activitySeriesId: string; venueId: string },
) {
  const { data: series, error: seriesError } = await client.from('activity_series')
    .select('id, venue_id, access_product_id')
    .eq('id', input.activitySeriesId)
    .eq('venue_id', input.venueId)
    .eq('series_type', 'course')
    .maybeSingle();
  if (seriesError || !series?.access_product_id) {
    throw new Error(seriesError?.message || 'course_participant_policy_series_not_found');
  }
  const { data: product, error: productError } = await client.from('access_products')
    .select('id, resolver_rules')
    .eq('id', series.access_product_id)
    .eq('venue_id', input.venueId)
    .eq('product_kind', 'series_access')
    .maybeSingle();
  if (productError || !product) throw new Error(productError?.message || 'course_participant_policy_product_not_found');
  return resolveCourseParticipantPolicy(product.resolver_rules);
}

export async function assertCurrentCourseParticipantIdentity(
  client: CourseParticipantPolicyClient,
  input: {
    activitySeriesId: string;
    venueId: string;
    participantType: CourseParticipantType;
    userId: string | null;
    payerCustomerId: string | null;
    participantCustomerId: string | null;
    dependentParticipantId: string | null;
    beneficiaryUserId?: string | null;
  },
) {
  const policy = await loadCourseParticipantPolicy(client, input);
  assertCourseParticipantIdentity({ policy, ...input });
  if (policy === 'self_only') {
    const { data: customer, error } = await client.from('customers')
      .select('id')
      .eq('id', input.payerCustomerId)
      .eq('auth_user_id', input.userId)
      .eq('status', 'active')
      .is('merged_into_id', null)
      .maybeSingle();
    if (error || !customer) throw new Error(error?.message || 'course_participant_identity_mismatch');
  }
  return policy;
}
