import {
  activitySeriesManagementProjection,
  activitySeriesOwnershipFromRelation,
  genericActivitySessionUpdates,
  isManagedActivitySeries,
} from './series_management.ts';

Deno.test('Format or managed product linkage owns the Series lifecycle independently of presentation/type', () => {
  const formatOwned = { format_id: 'format-id', access_product_id: null, series_type: 'club_night' };
  const productOwned = { format_id: null, access_product_id: 'product-id', series_type: 'program' };
  const scheduleGroup = { format_id: null, access_product_id: null, series_type: 'program' };

  if (!isManagedActivitySeries(formatOwned) || !isManagedActivitySeries(productOwned)) {
    throw new Error('managed Series ownership was not recognized');
  }
  if (isManagedActivitySeries(scheduleGroup)) throw new Error('schedule group was misclassified');
  if (activitySeriesManagementProjection(formatOwned).schedule_editable) {
    throw new Error('managed Series was projected as Schedule-editable');
  }
  if (!activitySeriesManagementProjection(scheduleGroup).schedule_editable) {
    throw new Error('schedule group lost generic Schedule editing');
  }
  if (!isManagedActivitySeries(activitySeriesOwnershipFromRelation([formatOwned]))) {
    throw new Error('PostgREST relationship arrays lost managed ownership');
  }
});

Deno.test('generic session updates are fail-closed around generated/commercial ownership fields', () => {
  const result = genericActivitySessionUpdates({
    name: 'Open Play',
    start_time: '18:00',
    capacity: 16,
    court_ids: ['court-id'],
    venue_id: 'other-venue',
    closed_to_public: false,
    series_occurrence_index: 99,
    id: 'other-session',
    created_at: '2026-01-01',
  });

  if (result.name !== 'Open Play' || result.capacity !== 16) {
    throw new Error('ordinary Schedule fields were removed');
  }
  for (const forbidden of ['venue_id', 'closed_to_public', 'series_occurrence_index', 'id', 'created_at']) {
    if (Object.prototype.hasOwnProperty.call(result, forbidden)) {
      throw new Error(`protected field ${forbidden} crossed the generic write boundary`);
    }
  }
});
