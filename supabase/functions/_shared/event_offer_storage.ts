export const EVENT_OFFER_SIGNED_URL_TTL_SECONDS = 60 * 60;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EventOfferStorageIdentity = {
  id: string;
  venue_id: string;
  event_lead_id: string;
};

function requireUuid(label: string, value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_V4.test(normalized)) throw new Error(`Invalid ${label} for event-offer storage`);
  return normalized;
}
export function buildCanonicalEventOfferObjectPath(input: {
  organizationId: string;
  venueId: string;
  leadId: string;
  offerId: string;
}) {
  return [
    requireUuid('organization id', input.organizationId),
    requireUuid('venue id', input.venueId),
    requireUuid('lead id', input.leadId),
    `${requireUuid('offer id', input.offerId)}.pdf`,
  ].join('/');
}

export async function canonicalEventOfferObjectPath(admin: any, offer: EventOfferStorageIdentity) {
  const venueId = requireUuid('venue id', offer.venue_id);
  const leadId = requireUuid('lead id', offer.event_lead_id);
  const offerId = requireUuid('offer id', offer.id);

  const { data: venue, error: venueError } = await admin
    .from('venues')
    .select('id, organization_id')
    .eq('id', venueId)
    .maybeSingle();
  if (venueError || !venue?.organization_id) {
    throw new Error(venueError?.message || 'Event-offer venue has no organization');
  }

  const { data: lead, error: leadError } = await admin
    .from('event_leads')
    .select('id, venue_id')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (leadError || !lead) {
    throw new Error(leadError?.message || 'Event-offer lead does not belong to venue');
  }

  return buildCanonicalEventOfferObjectPath({
    organizationId: venue.organization_id,
    venueId,
    leadId,
    offerId,
  });
}

export async function assertCanonicalEventOfferObjectPath(
  admin: any,
  offer: EventOfferStorageIdentity & { pdf_url?: string | null },
) {
  if (!offer.pdf_url) throw new Error('Offer has no PDF');
  const expected = await canonicalEventOfferObjectPath(admin, offer);
  if (offer.pdf_url !== expected) throw new Error('Offer PDF path is not canonical');
  return expected;
}
