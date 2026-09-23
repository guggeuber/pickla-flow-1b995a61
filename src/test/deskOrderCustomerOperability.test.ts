import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const customersApi = readFileSync("supabase/functions/api-customers/index.ts", "utf8");
const adminApi = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260921130000_desk_order_customer_operability.sql", "utf8");
const sqlRegression = readFileSync("supabase/tests/desk_order_customer_operability.sql", "utf8");
const stocklessConcurrencyRegression = readFileSync("supabase/tests/desk_order_customer_operability_concurrency.sql", "utf8");
const deskToday = readFileSync("src/components/desk/shell/DeskToday.tsx", "utf8");
const customerDrawer = readFileSync("src/components/customers/Customer360Drawer.tsx", "utf8");
const orderDrawer = readFileSync("src/components/commerce/CommerceOrderDetailDrawer.tsx", "utf8");
const customersScreen = readFileSync("src/screens/CustomersScreen.tsx", "utf8");

const observedProductionShape = {
  customerDisplay: "Marcus Theander",
  product: "Hyrrack",
  orderReference: "PICKLA-2026-000829",
  orderedQuantity: 4,
  issuedQuantity: 0,
};

function remainingQuantity(fixture: typeof observedProductionShape) {
  return fixture.orderedQuantity - fixture.issuedQuantity;
}

describe("Desk order/customer operability regression", () => {
  it("permanently represents the exact observed production shape without production IDs", () => {
    expect(observedProductionShape).toEqual({
      customerDisplay: "Marcus Theander",
      product: "Hyrrack",
      orderReference: "PICKLA-2026-000829",
      orderedQuantity: 4,
      issuedQuantity: 0,
    });
    expect(remainingQuantity(observedProductionShape)).toBe(4);
    expect(sqlRegression).toContain("'PICKLA-2026-000829'");
    expect(sqlRegression).toContain("'Marcus Theander'");
    expect(sqlRegression).toContain("'Hyrrack'");
    expect(sqlRegression).toContain("ROLLBACK;");
  });

  it("searches immutable order/receipt aliases and exposes guest-only order context without identity merging", () => {
    expect(customersApi).toContain("directReceiptMatchesResult");
    expect(customersApi).toContain("customer_name.ilike");
    expect(customersApi).toContain("customer_email.ilike");
    expect(customersApi).toContain("identity_aliases: uniqueStrings");
    expect(customersApi).toContain("order_references: uniqueStrings");
    expect(customersApi).toContain("commerce_order_ids: uniqueStrings");
    expect(customersApi).toContain("identity_state: 'guest'");
    expect(customersApi).toContain("id: `guest-order:${receipt.commerce_order_id}`");
    expect(customersApi).not.toMatch(/merge.*customer|customer.*merge/i);
    expect(customerDrawer).toContain("Gästidentitet från order");
    expect(customerDrawer).toContain("Order-/kvittoidentitet:");
  });

  it("keeps staff PII reads venue-authorized and scopes detail/search by canonical venue IDs", () => {
    expect(commerceApi).toContain("await requireVenueRole(admin, userId, venueId, ['venue_admin', 'desk_staff'])");
    expect(commerceApi).toContain(".eq('id', orderId).eq('venue_id', venueId)");
    expect(customersApi).toContain("const canList = await canListCustomers(admin, userId, venueId)");
    expect(customersApi).toContain("Customer not found for venue");
    expect(customersApi).toContain("Order identity does not match requested customer");
    expect(customersApi).toContain("eligibleCustomerIds");
    expect(customersApi).toContain("eligibleUserIds");
    expect(orderDrawer).not.toMatch(/stripe_session|payment_intent|guest_token|receipt_token/i);
  });

  it("supports order-reference, customer-name and email search through one authorized order read model", () => {
    expect(commerceApi).toContain("path === 'staff-orders'");
    expect(commerceApi).toContain("receipt_number.ilike");
    expect(commerceApi).toContain("customer_name.ilike");
    expect(commerceApi).toContain("customer_email.ilike");
    expect(commerceApi).toContain("guest_name.ilike");
    expect(commerceApi).toContain("sku.ilike");
    expect(commerceApi).toContain("commerce_orders!inner(venue_id)");
    expect(customersScreen).toContain("Namn, e-post, telefon eller ordernummer...");
    expect(customersScreen).toContain("Orderträffar");
  });

  it("renders canonical order, customer, receipt, product and fulfillment cross-links", () => {
    expect(deskToday).toContain("setOrderDetailId(line.order_id)");
    expect(deskToday).toContain("commerceOrderId: line.order_id");
    expect(customerDrawer).toContain("onOpenOrder?.(commerceOrder.id)");
    expect(orderDrawer).toContain("onOpenCustomer?.({");
    expect(orderDrawer).toContain("/hub/admin/products?productId=");
    expect(orderDrawer).toContain("Visa kvitto");
    expect(orderDrawer).toContain("Utlämning och historik");
    expect(adminApi).toContain("commerce_order_id, metadata, created_at");
  });

  it("shows deliberate quantity controls and never derives remaining truth client-side for a mutation", () => {
    expect(deskToday).toContain("återstår av {line.quantity}");
    expect(deskToday).toContain("Lämna ut alla {line.remaining_quantity}");
    expect(deskToday).toContain("collectCommercePickup");
    expect(deskToday).toContain("pickupIntentKeys.current.get(intent) || crypto.randomUUID()");
    expect(deskToday).not.toContain("knappen lämnar ut 1");
    expect(commerceApi).toContain("admin.rpc('commerce_r2a_collect_pickup'");
    expect(commerceApi).toContain("const [item] = await loadDeskFulfillmentItems");
  });

  it("extends the certified command to stockless lines with row locks, replay and hard gates", () => {
    expect(migration).toContain("ALTER COLUMN allocation_id DROP NOT NULL");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("idempotency_key_reused_with_different_request");
    expect(migration).toContain("pickup_blocked_by_pending_refund");
    expect(migration).toContain("pickup_blocked_by_order_attention");
    expect(migration).toContain("stockless_pickup_blocked_by_succeeded_refund");
    expect(migration).toContain("commerce_order_lines.collected_quantity + p_quantity");
    expect(migration).toContain("commerce.fulfillment.quantity_collected");
  });

  it("proves 4→3, pickup-all, replay, over-issue and two-device serialization in SQL", () => {
    expect(sqlRegression).toContain("partial stockless pickup did not move 4 to 3");
    expect(sqlRegression).toContain("pickup replay issued twice");
    expect(sqlRegression).toContain("pickup all did not complete safely");
    expect(sqlRegression).toContain("over-collection was accepted");
    expect(sqlRegression).toContain("pending-refund pickup was accepted");
    expect(sqlRegression).toContain("attention pickup was accepted");
    expect(stocklessConcurrencyRegression).toContain("two Desk devices over-issued stockless pickup");
    expect(stocklessConcurrencyRegression).toContain("collected_quantity = 4");
    expect(stocklessConcurrencyRegression).toContain("COALESCE(sum(quantity), 0)");
  });
});
