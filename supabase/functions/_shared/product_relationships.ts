import {
  evaluateCommerceAvailability,
  type CommerceProductLike,
} from './commerce_availability.ts';

export type OfferedWithProduct = CommerceProductLike & {
  id: string;
  venue_id: string;
};

export type OfferedWithRelationship = {
  id: string;
  venue_id: string;
  source_product_id: string;
  target_product_id: string;
  relationship_type: string;
  is_active: boolean;
  sort_order: number | string | null;
  created_at?: string | null;
};

function relationshipOrder(left: OfferedWithRelationship, right: OfferedWithRelationship) {
  return left.source_product_id.localeCompare(right.source_product_id)
    || Number(left.sort_order || 0) - Number(right.sort_order || 0)
    || String(left.created_at || '').localeCompare(String(right.created_at || ''))
    || left.id.localeCompare(right.id);
}

export function visibleOfferedWithRelationships({
  products,
  relationships,
  venueId,
  venueCommerceEnabled,
}: {
  products: OfferedWithProduct[];
  relationships: OfferedWithRelationship[];
  venueId: string;
  venueCommerceEnabled: boolean;
}) {
  const productById = new Map(products.map((product) => [product.id, product]));

  return relationships.filter((relationship) => {
    if (relationship.relationship_type !== 'offered_with' || relationship.is_active !== true) return false;
    const source = productById.get(relationship.source_product_id);
    const target = productById.get(relationship.target_product_id);
    if (!source || !target || source.id === target.id) return false;
    if (source.venue_id !== venueId || target.venue_id !== venueId) return false;

    const sourceAvailability = evaluateCommerceAvailability(source, {
      channel: 'participation',
      venueCommerceEnabled,
    });
    if (!sourceAvailability.eligible) return false;

    return evaluateCommerceAvailability(target, {
      channel: 'activity_addon',
      venueCommerceEnabled,
      hasActiveRelationship: true,
    }).eligible;
  }).sort(relationshipOrder);
}
