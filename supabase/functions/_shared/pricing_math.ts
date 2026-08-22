export type MembershipProductPriceRow = {
  fixed_price?: number | string | null;
  discount_percent?: number | string | null;
};

export function roundSek(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function applyPercentDiscount(baseAmountSek: number, percent: number) {
  const boundedPercent = Math.min(100, Math.max(0, Number(percent || 0)));
  return Math.max(0, roundSek(baseAmountSek * (1 - (boundedPercent / 100))));
}

/**
 * Product-specific membership pricing is the only membership price contract
 * shared with Series in V1. Zero-price rows are deliberately ignored because
 * the current Series commitment RPC cannot freeze subscription funding
 * provenance for an included purchase without a schema/contract change.
 */
export function selectPositiveMembershipProductPrice(
  baseAmountSek: number,
  rows: MembershipProductPriceRow[],
) {
  const candidates = rows
    .filter((row) => row.fixed_price != null || row.discount_percent != null)
    .map((row) => row.fixed_price != null
      ? roundSek(Number(row.fixed_price))
      : applyPercentDiscount(baseAmountSek, Number(row.discount_percent || 0)))
    .filter((amount) => Number.isFinite(amount) && amount > 0);

  return candidates.length > 0 ? Math.min(...candidates) : null;
}
