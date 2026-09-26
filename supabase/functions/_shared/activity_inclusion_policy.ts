function booleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  return String(value) === 'true';
}

export function activityInclusionPolicy(session: {
  product_key?: string | null;
  session_type?: string | null;
  access_policy?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}, pricingMode = 'standard') {
  if (pricingMode !== 'standard') return { dayPassIncluded: false, membershipIncluded: false };
  const policy = session.access_policy || {};
  const metadata = session.metadata || {};
  const legacyDefaultKey = session.session_type === 'group_training' ? 'group_training'
    : session.session_type === 'open_play' ? 'open_play_slot' : 'session_ticket';
  const legacyDefaultsApply = !session.product_key || session.product_key === legacyDefaultKey;
  return {
    dayPassIncluded: Object.prototype.hasOwnProperty.call(policy, 'allows_day_access')
      ? booleanSetting(policy.allows_day_access, false)
      : legacyDefaultsApply && booleanSetting(metadata.day_pass_included, true),
    membershipIncluded: Object.prototype.hasOwnProperty.call(policy, 'member_benefit_key')
      ? policy.member_benefit_key === 'open_play_unlimited'
      : legacyDefaultsApply && booleanSetting(metadata.membership_included, true),
  };
}
