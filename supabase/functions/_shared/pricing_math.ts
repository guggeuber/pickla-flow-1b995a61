export type MembershipProductPriceRow = {
  fixed_price?: number | string | null;
  discount_percent?: number | string | null;
};

export type MembershipProductPriceMode = 'fixed' | 'percent';

export function roundSek(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function applyPercentDiscount(baseAmountSek: number, percent: number) {
  const boundedPercent = Math.min(100, Math.max(0, Number(percent || 0)));
  return Math.max(0, roundSek(baseAmountSek * (1 - (boundedPercent / 100))));
}

export function membershipProductPriceMode(row: MembershipProductPriceRow): MembershipProductPriceMode | null {
  const hasFixed = row.fixed_price !== null && row.fixed_price !== undefined;
  const hasPercent = row.discount_percent !== null && row.discount_percent !== undefined;
  if (hasFixed === hasPercent) return null;
  return hasFixed ? 'fixed' : 'percent';
}

export function membershipProductPricePreview(
  baseAmountSek: number,
  row: MembershipProductPriceRow,
) {
  const mode = membershipProductPriceMode(row);
  if (!mode) return null;
  const value = Number(mode === 'fixed' ? row.fixed_price : row.discount_percent);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (mode === 'fixed') {
    const amount = roundSek(value);
    return amount <= roundSek(baseAmountSek) ? { mode, value: amount, finalAmountSek: amount } : null;
  }
  if (value > 100) return null;
  const amount = applyPercentDiscount(baseAmountSek, value);
  return amount > 0 ? { mode, value, finalAmountSek: amount } : null;
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
    .map((row) => membershipProductPricePreview(baseAmountSek, row)?.finalAmountSek ?? null)
    .filter((amount): amount is number => amount != null);

  return candidates.length > 0 ? Math.min(...candidates) : null;
}
