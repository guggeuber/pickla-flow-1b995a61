export type MembershipPricingRow = {
  tier_id?: string | null;
  product_type?: string | null;
  fixed_price?: number | null;
  discount_percent?: number | null;
  label?: string | null;
};

export type ProductPricingInput = {
  product?: {
    id?: string | null;
    product_key?: string | null;
    name?: string | null;
    product_kind?: string | null;
    base_price_sek?: number | string | null;
  } | null;
  membership?: {
    id?: string | null;
    name?: string | null;
    isGuest?: boolean;
  } | null;
  tierPricing?: MembershipPricingRow[] | null;
  channel?: string | null;
  channelPrices?: Record<string, number | string | null | undefined> | null;
  promotion?: {
    label?: string | null;
    fixed_discount_sek?: number | string | null;
    discount_percent?: number | string | null;
  } | null;
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
export const PICKLA_ACCESS_LABEL = "Play";
export const PICKLA_UNLIMITED_LABEL = "Play+";

export function formatSek(amount: number) {
  const rounded = Math.round(Number(amount || 0) * 100) / 100;
  return `${rounded.toLocaleString("sv-SE", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`;
}

function roundSek(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizePrice(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, roundSek(parsed)) : 0;
}

function normalizeChannel(channel?: string | null) {
  return String(channel || "online").toLowerCase();
}

export function resolveProductPricingPreview({
  product,
  membership,
  tierPricing,
  channel = "online",
  channelPrices,
  promotion,
}: ProductPricingInput) {
  const productKey = product?.product_key || "";
  const normalizedChannel = normalizeChannel(channel);
  const basePrice = normalizePrice(product?.base_price_sek);
  const channelOverride = channelPrices ? channelPrices[normalizedChannel] : null;
  const channelPrice = channelOverride == null || channelOverride === "" ? basePrice : normalizePrice(channelOverride);
  const channelAdjustment = roundSek(channelPrice - basePrice);

  const membershipRule = membership?.id
    ? (tierPricing || []).find((row) => row.tier_id === membership.id && row.product_type === productKey)
    : null;
  const membershipPrice = membershipRule?.fixed_price != null
    ? normalizePrice(membershipRule.fixed_price)
    : membershipRule?.discount_percent != null
    ? roundSek(channelPrice * (1 - Number(membershipRule.discount_percent || 0) / 100))
    : channelPrice;
  const membershipAdjustment = roundSek(membershipPrice - channelPrice);

  const promotionPercent = Number(promotion?.discount_percent || 0);
  const promotionFixed = normalizePrice(promotion?.fixed_discount_sek);
  const promotionAdjustment = promotionPercent > 0
    ? -roundSek(membershipPrice * (promotionPercent / 100))
    : promotionFixed > 0
    ? -Math.min(membershipPrice, promotionFixed)
    : 0;
  const finalPrice = Math.max(0, roundSek(membershipPrice + promotionAdjustment));

  return {
    productKey,
    productName: product?.name || productKey || "Produkt",
    channel: normalizedChannel,
    membershipName: membership?.name || "Gäst",
    basePrice,
    channelPrice,
    channelAdjustment,
    membershipPrice,
    membershipAdjustment,
    promotionLabel: promotion?.label || "Ingen promotion",
    promotionAdjustment,
    finalPrice,
    included: finalPrice <= 0,
    rows: [
      { label: "Baspris", value: basePrice, adjustment: 0 },
      { label: `Kanal: ${normalizedChannel}`, value: channelPrice, adjustment: channelAdjustment },
      { label: `Medlemskap: ${membership?.name || "Gäst"}`, value: membershipPrice, adjustment: membershipAdjustment },
      { label: promotion?.label || "Promotion", value: finalPrice, adjustment: promotionAdjustment },
    ],
  };
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
      `Ordinarie ${formatSek(safeBasePrice)}`,
      includedLabel ? includedLabel : finalPrice < safeBasePrice ? `Du sparar ${formatSek(safeBasePrice - finalPrice)}` : `${PICKLA_ACCESS_LABEL} ${formatSek(accessPrice)}`,
      includedLabel ? "Ditt pris 0 kr" : `Ditt pris ${formatSek(finalPrice)}`,
      `${PICKLA_UNLIMITED_LABEL} ingår`,
    ],
    detailRows: [
      { label: "Ordinarie pris", value: formatSek(safeBasePrice) },
      { label: "Du sparar", value: finalPrice < safeBasePrice ? formatSek(safeBasePrice - finalPrice) : formatSek(0) },
      { label: "Ditt pris", value: includedLabel || formatSek(finalPrice) },
      { label: `Ingår i ${PICKLA_UNLIMITED_LABEL}`, value: hasIncludedActivityAccess(membership, productKey, sessionType) ? "Ja" : "Nej" },
    ],
    checkoutLabel: includedLabel || formatSek(finalPrice),
  };
}

export type BackendActivityPricingDecision = {
  baseAmountSek?: number | null;
  finalAmountSek?: number | null;
  effectivePriceSek?: number | null;
  requiresCheckout?: boolean | null;
  accessDecision?: "paid" | "membership_included" | "day_access_included" | "free_day_pass" | string | null;
  productKey?: string | null;
  debug?: {
    pricing_mode?: string | null;
    member_discount_percent?: number | null;
    online_price_sek?: number | null;
    desk_price_sek?: number | null;
    day_pass_included?: boolean | null;
    membership_included?: boolean | null;
  } | null;
};

export function mergeBackendActivityPricing(
  labels: ReturnType<typeof activityPriceLabels>,
  decision?: BackendActivityPricingDecision | null
) {
  if (!decision) return labels;

  const backendBase = Number(decision.baseAmountSek ?? labels.basePrice);
  const backendFinal = Number(decision.effectivePriceSek ?? decision.finalAmountSek ?? labels.finalPrice);
  const basePrice = Number.isFinite(backendBase) ? Math.round(backendBase * 100) / 100 : labels.basePrice;
  const finalPrice = Number.isFinite(backendFinal) ? Math.round(backendFinal * 100) / 100 : labels.finalPrice;
  const pricingMode = decision.debug?.pricing_mode || "standard";
  const specialPricing = pricingMode === "fixed_ticket" || pricingMode === "member_discount";
  const onlinePrice = Number(decision.debug?.online_price_sek ?? basePrice);
  const deskPrice = Number(decision.debug?.desk_price_sek ?? onlinePrice);
  const memberDiscountPercent = Number(decision.debug?.member_discount_percent || 0);
  const memberPrice = Math.max(0, Math.round(onlinePrice * (1 - memberDiscountPercent / 100) * 100) / 100);
  const includedLabel = decision.requiresCheckout === false
    ? decision.accessDecision === "day_access_included"
      ? "Ingår idag"
      : "Ingår"
    : null;

  if (specialPricing) {
    return {
      ...labels,
      basePrice,
      finalPrice,
      includedLabel,
      hasDiscount: finalPrice > 0 && finalPrice < basePrice,
      checkoutLabel: includedLabel || formatSek(finalPrice),
      publicChips: pricingMode === "fixed_ticket"
        ? [`Playpickla.com ${formatSek(onlinePrice)}`, `Drop-in ${formatSek(deskPrice)}`, `Alla ${formatSek(onlinePrice)}`]
        : [`Playpickla.com ${formatSek(onlinePrice)}`, `Drop-in ${formatSek(deskPrice)}`, `Medlem ${formatSek(memberPrice)}`],
      detailRows: pricingMode === "fixed_ticket"
        ? [
          { label: "Playpickla.com", value: formatSek(onlinePrice) },
          { label: "Drop-in på plats", value: formatSek(deskPrice) },
          { label: "Medlemspris", value: formatSek(onlinePrice) },
        ]
        : [
          { label: "Playpickla.com", value: formatSek(onlinePrice) },
          { label: "Drop-in på plats", value: formatSek(deskPrice) },
          { label: "Medlemmar", value: formatSek(memberPrice) },
        ],
    };
  }

  return {
    ...labels,
    basePrice,
    finalPrice,
    includedLabel,
    hasDiscount: finalPrice > 0 && finalPrice < basePrice,
    checkoutLabel: includedLabel || formatSek(finalPrice),
  };
}
