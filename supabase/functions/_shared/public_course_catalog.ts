export type PublicCourseCard = {
  id: string;
  name: string;
  description: string | null;
  image_urls: string[];
  start_date: string;
  registration_state: 'upcoming' | 'open' | 'closed';
  capacity: { available_count: number };
  format: {
    description: string | null;
    presentation_type: 'course';
  };
};

export type PublicCourseCatalog = {
  venue_found: boolean;
  items: PublicCourseCard[];
};

export type PublicCourseCatalogRpcClient = {
  rpc: (
    name: 'public_customer_course_cards',
    args: { p_venue_slug: string },
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableText(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function courseCard(value: unknown): PublicCourseCard {
  const row = objectValue(value);
  const capacity = objectValue(row?.capacity);
  const format = objectValue(row?.format);
  const state = row?.registration_state;
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string'
    || typeof row.start_date !== 'string'
    || !['upcoming', 'open', 'closed'].includes(String(state))
    || !capacity || !format || format.presentation_type !== 'course') {
    throw new Error('Course catalog projection unavailable');
  }

  const availableCount = Number(capacity.available_count);
  if (!Number.isFinite(availableCount) || availableCount < 0) {
    throw new Error('Course catalog projection unavailable');
  }

  return {
    id: row.id,
    name: row.name,
    description: nullableText(row.description),
    image_urls: Array.isArray(row.image_urls)
      ? row.image_urls.filter((url): url is string => typeof url === 'string' && url.length > 0).slice(0, 1)
      : [],
    start_date: row.start_date,
    registration_state: state as PublicCourseCard['registration_state'],
    capacity: { available_count: Math.floor(availableCount) },
    format: {
      description: nullableText(format.description),
      presentation_type: 'course',
    },
  };
}

export async function loadPublicCourseCatalog(
  client: PublicCourseCatalogRpcClient,
  venueSlug: string,
): Promise<PublicCourseCatalog> {
  const { data, error } = await client.rpc('public_customer_course_cards', {
    p_venue_slug: venueSlug,
  });
  if (error) throw new Error(error.message);

  const payload = objectValue(Array.isArray(data) ? data[0] : data);
  if (!payload || typeof payload.venue_found !== 'boolean' || !Array.isArray(payload.items)) {
    throw new Error('Course catalog projection unavailable');
  }
  return {
    venue_found: payload.venue_found,
    items: payload.items.map(courseCard),
  };
}
