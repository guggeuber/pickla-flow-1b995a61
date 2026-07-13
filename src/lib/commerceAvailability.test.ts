import { describe, expect, it } from "vitest";
import {
  deriveCommerceCompatibilityFields,
  evaluateCommerceAvailability,
} from "../../supabase/functions/_shared/commerce_availability";

const retailProduct = {
  status: "active",
  is_active: true,
  standalone_enabled: true,
  activity_addon_enabled: false,
  commerce_kind: "merchandise",
  fulfillment_type: "desk_pickup",
  fulfillment_presentation: "desk_pickup",
  base_price_sek: 200,
  vat_rate: 25,
};

describe("Commerce product activation contract", () => {
  it("keeps draft, archived, and channel-disabled products out of the Store", () => {
    expect(evaluateCommerceAvailability({ ...retailProduct, status: "draft", is_active: false }, {
      channel: "standalone",
      venueCommerceEnabled: true,
    }).eligible).toBe(false);
    expect(evaluateCommerceAvailability({ ...retailProduct, status: "archived", is_active: false }, {
      channel: "standalone",
      venueCommerceEnabled: true,
    }).eligible).toBe(false);
    expect(evaluateCommerceAvailability({ ...retailProduct, standalone_enabled: false }, {
      channel: "standalone",
      venueCommerceEnabled: true,
    }).code).toBe("channel_disabled");
  });

  it("allows a valid active standalone product only when the venue rollout is enabled", () => {
    expect(evaluateCommerceAvailability(retailProduct, {
      channel: "standalone",
      venueCommerceEnabled: true,
    })).toMatchObject({ eligible: true, code: "available" });
    expect(evaluateCommerceAvailability(retailProduct, {
      channel: "standalone",
      venueCommerceEnabled: false,
    })).toMatchObject({ eligible: false, code: "venue_disabled" });
  });

  it("requires an explicit relationship for activity add-ons", () => {
    const addon = { ...retailProduct, standalone_enabled: false, activity_addon_enabled: true };
    expect(evaluateCommerceAvailability(addon, {
      channel: "activity_addon",
      venueCommerceEnabled: true,
      hasActiveRelationship: false,
    }).code).toBe("relationship_missing");
    expect(evaluateCommerceAvailability(addon, {
      channel: "activity_addon",
      venueCommerceEnabled: true,
      hasActiveRelationship: true,
    }).eligible).toBe(true);
  });

  it("derives legacy fields from operator status, channel, and fulfillment", () => {
    expect(deriveCommerceCompatibilityFields({
      status: "active",
      standalone_enabled: true,
      activity_addon_enabled: false,
      fulfillment_presentation: "desk_pickup",
      category: "Merch",
    })).toMatchObject({
      is_active: true,
      commerce_enabled: true,
      commerce_kind: "merchandise",
      fulfillment_type: "desk_pickup",
    });
    expect(deriveCommerceCompatibilityFields({
      status: "draft",
      standalone_enabled: true,
      activity_addon_enabled: false,
      fulfillment_presentation: "desk_pickup",
      category: "Merch",
    })).toMatchObject({ is_active: false, commerce_enabled: false });
  });

  it("restores archived products without recreating them and archives them again cleanly", () => {
    const archived = { ...retailProduct, status: "archived", is_active: false, commerce_enabled: false };
    expect(deriveCommerceCompatibilityFields({
      ...archived,
      status: "active",
    }, archived)).toMatchObject({
      status: "active",
      is_active: true,
      commerce_enabled: true,
    });
    expect(deriveCommerceCompatibilityFields({
      ...retailProduct,
      status: "archived",
    }, retailProduct)).toMatchObject({
      status: "archived",
      is_active: false,
      commerce_enabled: false,
    });
  });
});
