export type PublicTodaySeriesOccurrence = {
  session_id: string;
  series_id: string;
  title: string;
  session_date: string;
  start_time: string;
  end_time: string;
  capacity: number | null;
  presentation_type: 'social_event';
  registration_state: 'upcoming' | 'open' | 'closed';
  image_urls: string[];
  route: string;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return objectValue(value[0]);
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function imageUrls(...values: unknown[]) {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const urls = value.filter((url): url is string => typeof url === 'string' && url.length > 0);
    if (urls.length) return urls.slice(0, 1);
  }
  return [];
}

function registrationState(series: Record<string, unknown>, asOf: Date) {
  const opensAt = Date.parse(textValue(series.registration_opens_at));
  const closesAt = Date.parse(textValue(series.registration_closes_at));
  const now = asOf.getTime();
  if (Number.isFinite(opensAt) && now < opensAt) return 'upcoming' as const;
  if (Number.isFinite(closesAt) && now >= closesAt) return 'closed' as const;
  return 'open' as const;
}

export function projectPublicTodaySocialEventOccurrence(
  value: unknown,
  input: { venueSlug: string; startDate: string; endDate: string; asOf?: Date },
): PublicTodaySeriesOccurrence | null {
  const row = objectValue(value);
  const series = objectValue(row?.activity_series);
  const format = objectValue(series?.activity_formats);
  const venue = objectValue(row?.venues);
  if (!row || !series || !format || !venue
    || row.is_active !== true
    || row.publish_status !== 'published'
    || series.series_type !== 'course'
    || series.status !== 'active'
    || format.presentation_type !== 'social_event'
    || venue.is_public !== true
    || venue.slug !== input.venueSlug) return null;

  const sessionId = textValue(row.id);
  const seriesId = textValue(series.id || row.series_id);
  const sessionDate = textValue(row.session_date);
  const startTime = textValue(row.start_time);
  const endTime = textValue(row.end_time);
  const title = textValue(format.name) || textValue(series.name) || textValue(row.name);
  if (!sessionId || !seriesId || !sessionDate || sessionDate < input.startDate || sessionDate > input.endDate
    || !startTime || !endTime || !title) return null;

  const capacityValue = row.capacity == null ? null : Number(row.capacity);
  const capacity = capacityValue !== null && Number.isFinite(capacityValue) && capacityValue >= 0
    ? Math.floor(capacityValue)
    : null;

  return {
    session_id: sessionId,
    series_id: seriesId,
    title,
    session_date: sessionDate,
    start_time: startTime,
    end_time: endTime,
    capacity,
    presentation_type: 'social_event',
    registration_state: registrationState(series, input.asOf || new Date()),
    image_urls: imageUrls(series.image_urls, format.image_urls),
    route: `/course/${encodeURIComponent(seriesId)}?v=${encodeURIComponent(input.venueSlug)}`,
  };
}
