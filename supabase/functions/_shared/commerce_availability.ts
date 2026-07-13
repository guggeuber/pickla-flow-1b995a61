export type CommerceAvailabilityChannel = 'participation' | 'standalone' | 'activity_addon';

export type CommerceProductLike = {
  status?: string | null;
  is_active?: boolean | null;
  standalone_enabled?: boolean | null;
  activity_addon_enabled?: boolean | null;
  commerce_kind?: string | null;
  fulfillment_type?: string | null;
  fulfillment_presentation?: string | null;
  base_price_sek?: number | string | null;
  vat_rate?: number | string | null;
};

export type CommerceAvailabilityOptions = {
  channel: CommerceAvailabilityChannel;
  venueCommerceEnabled: boolean;
  hasActiveRelationship?: boolean;
};

export type CommerceAvailability = {
  eligible: boolean;
  code:
    | 'available'
    | 'draft'
    | 'archived'
    | 'inactive_compatibility'
    | 'venue_disabled'
    | 'channel_disabled'
    | 'relationship_missing'
    | 'invalid_price'
    | 'invalid_vat'
    | 'invalid_classification'
    | 'invalid_fulfillment';
  message: string | null;
};

function unavailable(code: CommerceAvailability['code'], message: string): CommerceAvailability {
  return { eligible: false, code, message };
}

export function evaluateCommerceAvailability(
  product: CommerceProductLike,
  options: CommerceAvailabilityOptions,
): CommerceAvailability {
  if (product.status === 'draft') return unavailable('draft', 'Produkten är ett utkast.');
  if (product.status === 'archived') return unavailable('archived', 'Produkten är arkiverad.');
  if (product.status !== 'active') return unavailable('draft', 'Produkten saknar en giltig status.');
  if (product.is_active !== true) {
    return unavailable('inactive_compatibility', 'Produktstatusen behöver synkroniseras.');
  }

  const price = Number(product.base_price_sek);
  if (!Number.isFinite(price) || price < 0) return unavailable('invalid_price', 'Lägg in ett giltigt pris.');
  const vatRate = Number(product.vat_rate);
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    return unavailable('invalid_vat', 'Lägg in en giltig momssats.');
  }

  if (!options.venueCommerceEnabled) {
    return unavailable('venue_disabled', 'Pickla Store är inte aktiverad för denna anläggning.');
  }

  if (options.channel === 'participation') {
    if (product.commerce_kind !== 'participation') {
      return unavailable('invalid_classification', 'Produkten är inte konfigurerad för deltagande.');
    }
    if (product.fulfillment_type !== 'participation') {
      return unavailable('invalid_fulfillment', 'Produkten saknar giltig leverans för deltagande.');
    }
    return { eligible: true, code: 'available', message: null };
  }

  if (!['rental', 'merchandise'].includes(String(product.commerce_kind || ''))) {
    return unavailable('invalid_classification', 'Produkten saknar giltig produktkategori för försäljning.');
  }
  if (product.fulfillment_presentation !== 'desk_pickup' || product.fulfillment_type !== 'desk_pickup') {
    return unavailable('invalid_fulfillment', 'Välj Hämtas vid disken för försäljning i denna release.');
  }

  if (options.channel === 'standalone') {
    if (product.standalone_enabled !== true) {
      return unavailable('channel_disabled', 'Produkten säljs inte fristående i butiken.');
    }
    return { eligible: true, code: 'available', message: null };
  }

  if (product.activity_addon_enabled !== true) {
    return unavailable('channel_disabled', 'Produkten är inte aktiverad som aktivitetstillval.');
  }
  if (options.hasActiveRelationship !== true) {
    return unavailable('relationship_missing', 'Välj minst en aktivitet som produkten kan köpas tillsammans med.');
  }
  return { eligible: true, code: 'available', message: null };
}

export function deriveCommerceCompatibilityFields(
  input: CommerceProductLike & { category?: string | null },
  existing?: CommerceProductLike & { product_kind?: string | null; category?: string | null },
) {
  const status = ['draft', 'active', 'archived'].includes(String(input.status))
    ? String(input.status)
    : String(existing?.status || 'draft');
  const fulfillmentPresentation = String(
    input.fulfillment_presentation || existing?.fulfillment_presentation || 'desk_pickup',
  );
  const category = String(input.category ?? existing?.category ?? '').trim();
  const participation = fulfillmentPresentation === 'participation' || existing?.commerce_kind === 'participation';
  const rental = !participation && (
    /^(hyra|uthyrning|rental)$/i.test(category)
    || (existing?.commerce_kind === 'rental' && !category)
  );
  const commerceKind = participation ? 'participation' : rental ? 'rental' : 'merchandise';
  const fulfillmentType = fulfillmentPresentation === 'desk_pickup'
    ? 'desk_pickup'
    : fulfillmentPresentation === 'participation'
      ? 'participation'
      : null;
  const standaloneEnabled = participation ? false : input.standalone_enabled === true;
  const activityAddonEnabled = participation ? false : input.activity_addon_enabled === true;
  const isActive = status === 'active';
  const compatibilityEnabled = isActive
    && Boolean(fulfillmentType)
    && (participation || standaloneEnabled || activityAddonEnabled);

  return {
    status,
    is_active: isActive,
    product_kind: participation ? existing?.product_kind || 'day_access' : commerceKind,
    commerce_kind: commerceKind,
    fulfillment_type: fulfillmentType,
    commerce_enabled: compatibilityEnabled,
    standalone_enabled: standaloneEnabled,
    activity_addon_enabled: activityAddonEnabled,
    fulfillment_presentation: fulfillmentPresentation,
  };
}
