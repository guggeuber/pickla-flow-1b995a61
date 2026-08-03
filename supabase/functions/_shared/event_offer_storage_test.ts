import {
  assertCanonicalEventOfferObjectPath,
  buildCanonicalEventOfferObjectPath,
  canonicalEventOfferObjectPath,
  EVENT_OFFER_SIGNED_URL_TTL_SECONDS,
} from './event_offer_storage.ts';

const ids = {
  organization: '10000000-0000-4000-8000-000000000001',
  venue: '20000000-0000-4000-8000-000000000002',
  lead: '30000000-0000-4000-8000-000000000003',
  offer: '40000000-0000-4000-8000-000000000004',
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function fakeAdmin(input: { leadVenueId?: string } = {}) {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      const chain = {
        select() { return chain; },
        eq(column: string, value: string) { filters[column] = value; return chain; },
        maybeSingle() {
          if (table === 'venues') {
            return Promise.resolve({ data: { id: ids.venue, organization_id: ids.organization }, error: null });
          }
          if (table === 'event_leads') {
            const leadVenueId = input.leadVenueId || ids.venue;
            const matches = filters.id === ids.lead && filters.venue_id === leadVenueId;
            return Promise.resolve({
              data: matches ? { id: ids.lead, venue_id: leadVenueId } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: new Error('Unexpected table') });
        },
      };
      return chain;
    },
  };
}

Deno.test('event offer paths include organization, venue, lead and offer', () => {
  const path = buildCanonicalEventOfferObjectPath({
    organizationId: ids.organization,
    venueId: ids.venue,
    leadId: ids.lead,
    offerId: ids.offer,
  });
  assert(
    path === `${ids.organization}/${ids.venue}/${ids.lead}/${ids.offer}.pdf`,
    'canonical hierarchy was not preserved',
  );
  assert(EVENT_OFFER_SIGNED_URL_TTL_SECONDS === 3600, 'signed URL must expire after one hour');
});
Deno.test('event offer path resolution denies a cross-venue lead', async () => {
  let denied = false;
  try {
    await canonicalEventOfferObjectPath(fakeAdmin({ leadVenueId: '50000000-0000-4000-8000-000000000005' }), {
      id: ids.offer,
      venue_id: ids.venue,
      event_lead_id: ids.lead,
    });
  } catch (error) {
    denied = String(error).includes('does not belong to venue');
  }
  assert(denied, 'cross-venue lead was not denied');
});

Deno.test('stored event offer paths must match the canonical object', async () => {
  const admin = fakeAdmin();
  const canonical = `${ids.organization}/${ids.venue}/${ids.lead}/${ids.offer}.pdf`;
  const accepted = await assertCanonicalEventOfferObjectPath(admin, {
    id: ids.offer,
    venue_id: ids.venue,
    event_lead_id: ids.lead,
    pdf_url: canonical,
  });
  assert(accepted === canonical, 'canonical path was rejected');

  let denied = false;
  try {
    await assertCanonicalEventOfferObjectPath(admin, {
      id: ids.offer,
      venue_id: ids.venue,
      event_lead_id: ids.lead,
      pdf_url: `${ids.venue}/${ids.lead}/${ids.offer}.pdf`,
    });
  } catch (error) {
    denied = String(error).includes('not canonical');
  }
  assert(denied, 'legacy or cross-tenant path was not denied');
});
