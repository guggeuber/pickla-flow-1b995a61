export type ActivitySeriesOwnershipShape = {
  id?: string | null;
  name?: string | null;
  format_id?: string | null;
  access_product_id?: string | null;
};

export const MANAGED_SERIES_MESSAGE = 'Hanteras i Program & event';

export function isManagedActivitySeries(series: ActivitySeriesOwnershipShape | null | undefined) {
  return Boolean(series?.format_id || series?.access_product_id);
}

export function activitySeriesOwnershipFromRelation(
  relation: ActivitySeriesOwnershipShape | ActivitySeriesOwnershipShape[] | null | undefined,
) {
  return Array.isArray(relation) ? relation[0] || null : relation || null;
}

export function activitySeriesManagementProjection(series: ActivitySeriesOwnershipShape) {
  const managed = isManagedActivitySeries(series);
  return {
    management_mode: managed ? 'managed_series' : 'schedule_group',
    schedule_editable: !managed,
  } as const;
}

const GENERIC_ACTIVITY_SESSION_UPDATE_FIELDS = new Set([
  'name',
  'session_type',
  'sport_type',
  'series_id',
  'product_key',
  'recurrence_days',
  'session_date',
  'start_time',
  'end_time',
  'price_sek',
  'capacity',
  'court_ids',
  'access_policy',
  'is_active',
  'publish_status',
  'sort_order',
  'metadata',
  'early_bird_price_minor',
  'early_bird_slots',
  'scarcity_mode',
  'first_visit_offer_enabled',
  'first_visit_price_minor',
  'first_visit_only',
  'requires_staffing',
]);

export function genericActivitySessionUpdates(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => GENERIC_ACTIVITY_SESSION_UPDATE_FIELDS.has(key)),
  );
}
