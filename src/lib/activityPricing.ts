export type MembershipPricingRow = {
  product_type?: string | null;
  fixed_price?: number | null;
  discount_percent?: number | null;
  label?: string | null;
};

export type MembershipEntitlementRow = {
  entitlement_type?: string | null;
  value?: number | string | null;
  sport_type?: string | null;
  period?: string | null;
};

export type MembershipLike = {
  id?: string | null;
  tier_id?: string | null;
  tier_pricing?: MembershipPricingRow[] | null;
  tier_entitlements?: MembershipEntitlementRow[] | null;
  membership_tiers?: {
    name?: string | null;
    monthly_price?: number | null;
    membership_entitlements?: MembershipEntitlementRow[] | null;
  } | null;
} | null | undefined;

export const PICKLA_ACCESS_MONTHLY_SEK = 199;
export const PICKLA_UNLIMITED_MONTHLY_SEK = 699;
export const DAY_MEMBERSHIP_SEK = 199;
export const ACCESS_ACTIVITY_DISCOUNT_PERCENT = 40;

export function formatSek(amount: number) {
  return `${amount.toLocaleString("sv-SE", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`;
}

export function isUnlimitedMembership(membership: MembershipLike) {
  if (!membership?.id && !membership?.tier_id) return false;
  const name = membership?.membership_tiers?.name || "";
  return /unlimited/i.test(name);
}

function tierEntitlements(membership: MembershipLike) {
  return [
    ...(membership?.tier_entitlements || []),
    ...(membership?.membership_tiers?.membership_entitlements || []),
  ];
}

function hasPositiveEntitlement(membership: MembershipLike, entitlementType: string) {
  return tierEntitlements(membership).some((row) => {
    if (row.entitlement_type !== entitlementType) return false;
    return Number(row.value ?? 1) > 0;
  });
}

function isOpenPlayActivity(productKey?: string | null, sessionType?: string | null) {
  return productKey === "open_play_slot" || sessionType === "open_play";
}

export function hasIncludedActivityAccess(
  membership: MembershipLike,
  productKey?: string | null,
  sessionType?: string | null
) {
  if (isUnlimitedMembership(membership)) return true;
  if (isOpenPlayActivity(productKey, sessionType)) {
    return hasPositiveEntitlement(membership, "open_play_unlimited");
  }
  return false;
}

export function hasActiveMembership(membership: MembershipLike) {
  return Boolean(membership?.id || membership?.tier_id);
}

export function accessPriceForActivity(basePrice: number, productKey?: string | null, membership?: MembershipLike) {
  const pricing = (membership?.tier_pricing || []).find((row) => row.product_type === productKey);
  if (pricing?.fixed_price != null) return Math.round(Number(pricing.fixed_price));
  if (pricing?.discount_percent) {
    return Math.round(basePrice * (1 - Number(pricing.discount_percent) / 100));
  }
  return Math.round(basePrice * (1 - ACCESS_ACTIVITY_DISCOUNT_PERCENT / 100));
}

export function activityPriceLabels({
  basePrice,
  productKey,
  sessionType,
  membership,
  hasDayAccess,
}: {
  basePrice: number;
  productKey?: string | null;
  sessionType?: string | null;
  membership?: MembershipLike;
  hasDayAccess?: boolean;
}) {
  const safeBasePrice = Math.max(0, Math.round(Number(basePrice || 0)));
  const activeMembership = hasActiveMembership(membership);
  const accessPrice = accessPriceForActivity(safeBasePrice, productKey, membership);
  const includedByMembership = hasIncludedActivityAccess(membership, productKey, sessionType);
  const finalPrice = hasDayAccess || includedByMembership ? 0 : activeMembership ? Math.min(safeBasePrice, accessPrice) : safeBasePrice;
  const includedLabel = hasDayAccess ? "Ingår idag" : includedByMembership ? "Ingår" : null;

  return {
    basePrice: safeBasePrice,
    accessPrice,
    finalPrice,
    includedLabel,
    hasDiscount: finalPrice > 0 && finalPrice < safeBasePrice,
    publicChips: [
      formatSek(safeBasePrice),
      `Access ${formatSek(accessPrice)}`,
      "Unlimited ingår",
      "Dag ingår",
    ],
    detailRows: [
      { label: "Aktivitetsbiljett", value: formatSek(safeBasePrice) },
      { label: `Pickla Access ${PICKLA_ACCESS_MONTHLY_SEK} kr/mån`, value: formatSek(accessPrice) },
      { label: `Pickla Unlimited ${PICKLA_UNLIMITED_MONTHLY_SEK} kr/mån`, value: "Ingår" },
      { label: `Dagsmedlemskap ${DAY_MEMBERSHIP_SEK} kr`, value: "Ingår idag" },
    ],
    checkoutLabel: includedLabel || formatSek(finalPrice),
  };
}
