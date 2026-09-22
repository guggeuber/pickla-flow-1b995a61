import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminProducts from "@/components/admin/AdminProducts";
import { ProductMediaEditor } from "@/components/admin/commerce/ProductMediaEditor";
import { activityTicketProductFields, buildVariantMatrix, productInventoryState, skuBaseFromName } from "@/lib/adminCommerce";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), postForm: vi.fn(), patch: vi.fn(), remove: vi.fn() }));

vi.mock("@/lib/api", () => ({ apiGet: api.get, apiPost: api.post, apiPostForm: api.postForm, apiPatch: api.patch, apiDelete: api.remove }));

const venueId = "7ff6e5dc-f27a-473b-af4e-2b358340ab81";
const savedProduct = {
  id: "11111111-1111-4111-8111-111111111111",
  product_key: "pickla_classic_tee",
  name: "Pickla Classic Tee",
  description: "Test",
  product_kind: "merchandise",
  session_type: null,
  base_price_sek: 299,
  vat_rate: 25,
  is_active: false,
  sort_order: 0,
  commerce_kind: "merchandise",
  fulfillment_type: "desk_pickup",
  commerce_enabled: false,
  status: "draft",
  standalone_enabled: true,
  activity_addon_enabled: false,
  fulfillment_presentation: "desk_pickup",
  category: "Kläder",
  sport: "Pickleball",
  image_url: null,
  inventory_policy: "tracked",
  store_eligible: false,
  sales_state_label: "Utkast",
  sales_block_reason: null,
  variant_count: 8,
  inventory_summary: { on_hand: 0, reserved: 0, allocated: 0, available_to_sell: 0, incident_blocked: false, configured: false, sold_out: true, low_stock: false },
};

function wrapper(initialEntries: string[] = ["/"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter></QueryClientProvider>;
}

describe("Admin OS Commerce experience", () => {
  let products: typeof savedProduct[];

  beforeEach(() => {
    products = [];
    api.get.mockReset(); api.post.mockReset(); api.postForm.mockReset(); api.patch.mockReset(); api.remove.mockReset();
    api.postForm.mockResolvedValue({ media: [], image_url: null });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: vi.fn() });
    api.get.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "products") return Promise.resolve(products.map((product) => ({ ...product })));
      if (endpoint === "product-relationships") return Promise.resolve([]);
      if (endpoint === "inventory-operations") return Promise.resolve({ locations: [], levels: [], movements: [], incidents: [], attempts: [], refunds: [], allocations: [], dispositions: [], orders: [], orders_page: { has_more: false, next_before: null }, movements_page: { has_more: false, next_before: null } });
      if (endpoint === "product-variants") return Promise.resolve({
        product: { id: savedProduct.id, inventory_policy: "tracked" },
        venue: { franchisee_id: "seller-1", tracked_merch_sales_enabled: false, franchisees: { id: "seller-1", legal_name: "Pickla Solna AB" } },
        listing: products.length ? { id: "listing-1", tracked_sales_enabled: false, default_inventory_location_id: "location-1", inventory_locations: { name: "Butik / reception" } } : null,
        options: products.length ? [
          { id: "color", code: "color", label: "Färg", product_option_values: [
            { id: "black", code: "black", label: "Black", status: "active", swatch: null },
            { id: "off-white", code: "off-white", label: "Off-white", status: "active", swatch: null },
          ] },
          { id: "size", code: "size", label: "Storlek", product_option_values: ["S", "M", "L", "XL"].map((label) => ({ id: `size-${label}`, code: label.toLowerCase(), label, status: "active", swatch: null })) },
        ] : [],
        variants: [],
      });
      return Promise.resolve([]);
    });
    api.post.mockImplementation((_fn: string, endpoint: string, body: Record<string, unknown>) => {
      if (endpoint === "products") { products = [{ ...savedProduct }]; return Promise.resolve({ ...savedProduct }); }
      if (endpoint === "tracked-product-setup") return Promise.resolve({ listing: { id: "listing-1", tracked_sales_enabled: body.tracked_sales_enabled } });
      if (endpoint === "product-variants") return Promise.resolve({ id: crypto.randomUUID() });
      return Promise.resolve({});
    });
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("uses a multi-file picker instead of a raw image URL and uploads the chosen cover order after draft creation", async () => {
    render(<AdminProducts venueId={venueId} />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByRole("button", { name: "Ny produkt" }));
    fireEvent.click(screen.getByRole("button", { name: /Fysisk vara/ }));
    fireEvent.click(screen.getByRole("button", { name: "Fortsätt" }));
    expect(screen.queryByLabelText(/Bildlänk|Image URL/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Namn"), { target: { value: "Pickla Classic Tee TEST" } });
    fireEvent.change(screen.getByLabelText("Pris SEK"), { target: { value: "299" } });
    const files = [
      new File(["one"], "tee-front.png", { type: "image/png" }),
      new File(["two"], "tee-back.png", { type: "image/png" }),
      new File(["three"], "tee-detail.webp", { type: "image/webp" }),
    ];
    fireEvent.change(screen.getByTestId("product-image-input"), { target: { files } });
    expect(screen.getByTestId("pending-product-media").querySelectorAll("article")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Välj bild 3 som omslag" }));
    expect(screen.getByAltText("Pickla Classic Tee TEST 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fortsätt" }));
    fireEvent.click(screen.getByRole("button", { name: "Fortsätt" }));
    fireEvent.click(screen.getByRole("button", { name: "Skapa säkert utkast" }));

    await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1));
    const form = api.postForm.mock.calls[0][2] as FormData;
    expect(form.getAll("files").map((value) => (value as File).name)).toEqual(["tee-detail.webp", "tee-front.png", "tee-back.png"]);
    expect(form.get("productId")).toBe(savedProduct.id);
  });

  it("removes an archived media thumbnail immediately from the server response", async () => {
    const media = [
      { id: "media-1", product_id: savedProduct.id, venue_id: venueId, url: "https://example.com/front.jpg", public_url: "https://example.com/front.jpg", storage_bucket: "product-media", storage_path: "front.jpg", alt_text: "Front", sort_order: 0, is_cover: true, status: "active" as const, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" },
      { id: "media-2", product_id: savedProduct.id, venue_id: venueId, url: "https://example.com/back.jpg", public_url: "https://example.com/back.jpg", storage_bucket: "product-media", storage_path: "back.jpg", alt_text: "Back", sort_order: 1, is_cover: false, status: "active" as const, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" },
    ];
    api.patch.mockResolvedValue({ media: [media[1]], image_url: media[1].public_url });
    const onChanged = vi.fn().mockResolvedValue(undefined);

    render(<ProductMediaEditor venueId={venueId} productId={savedProduct.id} productName={savedProduct.name} media={media} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Ta bort bild 1" }));

    await waitFor(() => expect(screen.queryByAltText("Front")).not.toBeInTheDocument());
    expect(screen.getByAltText("Back")).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith("api-admin", "product-media", expect.objectContaining({ action: "archive", media_id: "media-1" }));
  });

  it("generates the eight canonical Tee combinations with unique editable SKU suggestions", () => {
    const matrix = buildVariantMatrix("Pickla Classic Tee", ["Black", "Off-white"], ["S", "M", "L", "XL"]);
    expect(skuBaseFromName("Pickla Classic Tee")).toBe("PCL-TEE");
    expect(matrix).toHaveLength(8);
    expect(new Set(matrix.map((row) => row.sku)).size).toBe(8);
    expect(matrix.map((row) => row.sku)).toContain("PCL-TEE-BLK-M");
    expect(matrix.every((row) => row.priceOverride === "")).toBe(true);
  });

  it("expresses inventory states without hiding canonical availability", () => {
    expect(productInventoryState({ ...savedProduct, listing: null, variant_count: 0 })).toBe("Ej konfigurerad");
    expect(productInventoryState({ ...savedProduct, listing: { id: "l", status: "active", tracked_sales_enabled: false, default_inventory_location_id: "x", location_name: "Reception" }, inventory_summary: { ...savedProduct.inventory_summary, configured: true, sold_out: false, low_stock: true, available_to_sell: 3 } })).toBe("Lågt lager");
    expect(productInventoryState({ ...savedProduct, inventory_policy: "stockless" })).toBe("Lager ej spårat");
  });

  it("creates a tracked Tee only through canonical product, setup and variant APIs while keeping sales disabled", async () => {
    render(<AdminProducts venueId={venueId} />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByRole("button", { name: "Ny produkt" }));
    fireEvent.click(screen.getByRole("button", { name: /Fysisk vara/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Spåra lagersaldo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Fortsätt" }));

    fireEvent.change(screen.getByLabelText("Namn"), { target: { value: "Pickla Classic Tee" } });
    fireEvent.change(screen.getByLabelText("Pris SEK"), { target: { value: "299" } });
    fireEvent.change(screen.getByLabelText("Kategori"), { target: { value: "Kläder" } });
    fireEvent.change(screen.getByLabelText("Sport"), { target: { value: "Pickleball" } });
    fireEvent.click(screen.getByRole("button", { name: "Fortsätt" }));

    expect(screen.getByText("Genererad variantmatris · 8")).toBeInTheDocument();
    expect(screen.getByLabelText("SKU Black M")).toHaveValue("PCL-TEE-BLK-M");
    fireEvent.click(screen.getByRole("button", { name: "Fortsätt" }));
    fireEvent.click(screen.getByRole("button", { name: "Skapa säkert utkast" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("api-admin", "products", expect.objectContaining({ status: "draft", inventory_policy: "tracked", activity_addon_enabled: false })));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("api-admin", "tracked-product-setup", expect.objectContaining({ tracked_sales_enabled: false })));
    await waitFor(() => expect(api.post.mock.calls.filter((call) => call[1] === "product-variants")).toHaveLength(8));
    expect(api.patch.mock.calls.some((call) => call[1] === "tracked-sales")).toBe(false);
  });

  it("creates Singelträning as the existing canonical session-ticket model and activates it after Founder pricing", async () => {
    const baseGet = api.get.getMockImplementation();
    api.get.mockImplementation((fn: string, endpoint: string, params?: Record<string, unknown>) => {
      if (fn === "api-memberships" && endpoint === "tiers") {
        return Promise.resolve([{ id: "founder-tier", name: "Founder", is_active: true }]);
      }
      return baseGet?.(fn, endpoint, params);
    });
    const participationProduct = {
      ...savedProduct,
      id: "22222222-2222-4222-8222-222222222222",
      product_key: "singeltraning",
      name: "Singelträning",
      product_kind: "session_ticket",
      session_type: "group_training",
      base_price_sek: 199,
      vat_rate: 6,
      commerce_kind: "participation",
      fulfillment_type: "participation",
      fulfillment_presentation: "participation",
      inventory_policy: "stockless",
      standalone_enabled: false,
      status: "draft",
      is_active: false,
    };
    api.post.mockImplementation((fn: string, endpoint: string) => {
      if (fn === "api-admin" && endpoint === "products") {
        products = [participationProduct];
        return Promise.resolve({ ...participationProduct });
      }
      if (fn === "api-memberships" && endpoint === "tier-pricing") return Promise.resolve({ id: "founder-price" });
      return Promise.resolve({});
    });
    api.patch.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "products") {
        const active = { ...participationProduct, status: "active", is_active: true, commerce_enabled: true };
        products = [active];
        return Promise.resolve(active);
      }
      return Promise.resolve({});
    });

    render(<AdminProducts venueId={venueId} />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByRole("button", { name: "Ny produkt" }));
    fireEvent.click(screen.getByRole("button", { name: /Aktivitetsbiljett \/ tjänst/ }));
    fireEvent.click(screen.getByRole("button", { name: "Fortsätt" }));

    fireEvent.change(screen.getByLabelText("Namn"), { target: { value: "Singelträning" } });
    fireEvent.change(screen.getByLabelText("Pris SEK"), { target: { value: "199" } });
    expect(screen.getByLabelText("Moms %")).toHaveValue(6);
    expect(screen.getByLabelText(/Founder-rabatt %/)).toHaveValue(20);
    expect(screen.getByText(/Ingår inte automatiskt i Day, Play eller Play\+/)).toBeInTheDocument();
    expect(screen.getByText(/Standard 12h via Policy V1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fortsätt" }));
    fireEvent.click(screen.getByRole("button", { name: "Fortsätt" }));
    const createButton = screen.getByRole("button", { name: "Skapa aktivitetsprodukt" });
    await waitFor(() => expect(createButton).toBeEnabled());
    fireEvent.click(createButton);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("api-admin", "products", expect.objectContaining({
      name: "Singelträning",
      base_price_sek: 199,
      vat_rate: 6,
      status: "draft",
      ...activityTicketProductFields("group_training"),
    })));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("api-memberships", "tier-pricing", {
      tierId: "founder-tier",
      product_type: "singeltraning",
      fixed_price: null,
      discount_percent: 20,
      vat_rate: 6,
      label: "Singelträning",
      allow_draft_product: true,
    }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("api-admin", "products", expect.objectContaining({
      productId: participationProduct.id,
      status: "active",
    })));
  });

  it("shows Products, Inventory and Orders as one Admin OS workspace", async () => {
    products = [{ ...savedProduct }];
    render(<AdminProducts venueId={venueId} />, { wrapper: wrapper() });
    const tabs = await screen.findByRole("tablist", { name: "Commerce" });
    expect(within(tabs).getByRole("tab", { name: "Produkter" })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: "Lager" })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: "Ordrar" })).toBeInTheDocument();
  });

  it("opens the canonical product workspace from an operability deep link without restoring the legacy editor", async () => {
    products = [{ ...savedProduct }];
    render(<AdminProducts venueId={venueId} />, { wrapper: wrapper([`/hub/admin/products?productId=${savedProduct.id}`]) });
    expect(await screen.findByTestId("commerce-product-detail")).toHaveTextContent(savedProduct.name);
    expect(screen.getByRole("tab", { name: "Översikt" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Varianter" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Lager" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Ordrar" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Bildlänk|Image URL/i)).not.toBeInTheDocument();
  });

  it("uses the authorized canonical order search and opens canonical order detail", async () => {
    const orderId = "22222222-2222-4222-8222-222222222222";
    api.get.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "products") return Promise.resolve([]);
      if (endpoint === "product-relationships") return Promise.resolve([]);
      if (endpoint === "inventory-operations") return Promise.resolve({ locations: [], levels: [], movements: [], incidents: [], attempts: [], refunds: [], allocations: [], dispositions: [], orders: [], orders_page: { has_more: false, next_before: null }, movements_page: { has_more: false, next_before: null } });
      if (endpoint === "staff-orders") return Promise.resolve({ orders: [{ order_id: orderId, order_reference: "PICKLA-2026-000829", customer_id: "customer-1", user_id: "user-1", customer_name: "Marcus Theander", customer_email: "marcus@example.test", identity_state: "account", created_at: "2026-09-21T08:00:00Z", paid_at: "2026-09-21T08:01:00Z", order_status: "paid", payment_status: "paid", payment_method: "card", total_inc_vat_minor: 4000, currency: "sek", refund_status: null, products: [{ line_id: "line-1", product_name: "Hyrrack", quantity: 4, issued_quantity: 0, remaining_quantity: 4, fulfillment_status: "pending_pickup", sku: "RACKET-RENTAL", variant_label: null }] }] });
      if (endpoint === "staff-order") return Promise.resolve({ order: { id: orderId, venue_id: venueId, customer_id: "customer-1", user_id: "user-1", order_reference: "PICKLA-2026-000829", status: "paid", payment_status: "paid", payment_method: "card", refund_status: null, currency: "sek", subtotal_minor: 4000, discount_minor: 0, total_inc_vat_minor: 4000, total_ex_vat_minor: 3200, vat_amount_minor: 800, created_at: "2026-09-21T08:00:00Z", checkout_frozen_at: "2026-09-21T08:00:00Z", paid_at: "2026-09-21T08:01:00Z" }, customer: { customer_id: "customer-1", user_id: "user-1", name: "Marcus Theander", canonical_name: "Marcus Theander", email: "marcus@example.test", phone: null, identity_state: "account" }, lines: [{ id: "line-1", commerce_order_id: orderId, product_id: savedProduct.id, product_key: "hyr_rack", product_name: "Hyrrack", commerce_kind: "rental", quantity: 4, unit_price_minor: 1000, discount_minor: 0, line_total_inc_vat_minor: 4000, line_total_ex_vat_minor: 3200, vat_rate: 25, vat_amount_minor: 800, fulfillment_type: "desk_pickup", fulfillment_status: "pending_pickup", fulfilled_at: null, variant_id: null, sku: "RACKET-RENTAL", inventory_policy: "stockless", pickup_location_id: null, variant_snapshot: null, collected_quantity: 0, cancelled_quantity: 0, created_at: "2026-09-21T08:00:00Z", source_type: "catalog", source_id: savedProduct.id, issued_quantity: 0, refunded_quantity: 0, remaining_quantity: 4, pickup_eligible: true, pickup_block_reason: null }], receipt: { receipt_number: "PICKLA-2026-000829", product_description: "Hyrrack × 4", payment_status: "paid", issued_at: "2026-09-21T08:01:00Z" }, receipt_lines: [], ledger_entries: [], refunds: [], allocations: [], pickup_commands: [], audit_events: [], history: [] });
      return Promise.resolve([]);
    });

    render(<AdminProducts venueId={venueId} />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByRole("tab", { name: "Ordrar" }));
    const search = await screen.findByPlaceholderText("Sök order, kvitto, kund, e-post eller SKU");
    fireEvent.change(search, { target: { value: "RACKET-RENTAL" } });
    const result = await screen.findByRole("button", { name: /PICKLA-2026-000829/ });
    expect(result).toHaveTextContent("Marcus Theander");
    expect(result).toHaveTextContent("4 återstår");
    fireEvent.click(result);
    expect(await screen.findByRole("heading", { name: "PICKLA-2026-000829" })).toBeInTheDocument();
    expect(screen.getByText("Hyrrack")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("api-commerce", "staff-orders", { venueId, search: "RACKET-RENTAL" });
    expect(api.get).toHaveBeenCalledWith("api-commerce", "staff-order", { venueId, orderId });
  });

  it("keeps receive, count, pickup, refund, disposition and archive on their canonical commands", async () => {
    const operationalProduct = {
      ...savedProduct,
      status: "active" as const,
      variant_count: 1,
      listing: {
        id: "listing-1",
        status: "active",
        tracked_sales_enabled: false,
        default_inventory_location_id: "location-1",
        location_name: "Butik / reception",
      },
      inventory_summary: {
        on_hand: 7,
        reserved: 0,
        allocated: 1,
        available_to_sell: 6,
        incident_blocked: false,
        configured: true,
        sold_out: false,
        low_stock: false,
      },
    };
    products = [operationalProduct];
    const variant = {
      id: "variant-1",
      product_id: savedProduct.id,
      sku: "PCL-TEE-BLK-M",
      title: "Black / M",
      price_override_minor: null,
      image_url: null,
      status: "active",
      product_variant_option_values: [],
      inventory: {
        id: "level-1",
        variant_id: "variant-1",
        location_id: "location-1",
        on_hand: 7,
        reserved: 0,
        allocated: 1,
        available_to_sell: 6,
        version: 4,
        incident_blocked: false,
      },
    };
    const order = {
      id: "order-1",
      status: "paid",
      currency: "sek",
      total_inc_vat_minor: 59800,
      vat_amount_minor: 11960,
      guest_name: "Stage Customer",
      paid_at: "2026-09-20T20:00:00Z",
      created_at: "2026-09-20T19:55:00Z",
      booking_receipts: { receipt_number: "PICKLA-TEST-1", payment_status: "paid" },
      lines: [{
        id: "line-1",
        commerce_order_id: "order-1",
        product_id: savedProduct.id,
        product_key: savedProduct.product_key,
        product_name: savedProduct.name,
        commerce_kind: "merchandise",
        quantity: 2,
        unit_price_minor: 29900,
        discount_minor: 0,
        line_total_inc_vat_minor: 59800,
        vat_rate: 25,
        vat_amount_minor: 11960,
        line_total_ex_vat_minor: 47840,
        fulfillment_type: "desk_pickup",
        fulfillment_status: "pending_pickup",
        fulfilled_at: null,
        variant_id: variant.id,
        sku: variant.sku,
        inventory_policy: "tracked",
        pickup_location_id: "location-1",
        variant_snapshot: { display_label: "Black / M" },
        collected_quantity: 1,
        cancelled_quantity: 0,
        created_at: "2026-09-20T19:55:00Z",
      }],
    };
    const operations = {
      locations: [{ id: "location-1", name: "Butik / reception" }],
      levels: [variant.inventory],
      movements: [],
      incidents: [],
      attempts: [],
      refunds: [],
      allocations: [{ id: "allocation-1", commerce_order_line_id: "line-1", status: "collected", quantity: 2 }],
      dispositions: [],
      orders: [order],
      orders_page: { has_more: false, next_before: null },
      movements_page: { has_more: false, next_before: null },
    };
    api.get.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "products") return Promise.resolve(products.map((product) => ({ ...product })));
      if (endpoint === "product-relationships") return Promise.resolve([]);
      if (endpoint === "inventory-operations") return Promise.resolve(operations);
      if (endpoint === "product-variants") return Promise.resolve({
        product: { id: savedProduct.id, inventory_policy: "tracked" },
        venue: { franchisee_id: "seller-1", tracked_merch_sales_enabled: false, franchisees: { id: "seller-1", legal_name: "Pickla Solna AB" } },
        listing: { id: "listing-1", tracked_sales_enabled: false, default_inventory_location_id: "location-1", inventory_locations: { name: "Butik / reception" } },
        options: [],
        variants: [variant],
      });
      return Promise.resolve([]);
    });
    api.patch.mockResolvedValue(operationalProduct);

    render(<AdminProducts venueId={venueId} />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByRole("button", { name: /Pickla Classic Tee/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "Lager" }));

    fireEvent.change(screen.getByLabelText("Ta emot PCL-TEE-BLK-M"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Orsak / referens"), { target: { value: "Initial delivery" } });
    fireEvent.click(screen.getByRole("button", { name: "Bekräfta mottagning" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("api-commerce", "inventory-receive", expect.objectContaining({ variant_id: variant.id, quantity: 3 })));

    fireEvent.click(screen.getByRole("button", { name: "Korrigera / räkna" }));
    fireEvent.change(screen.getByLabelText("Räkna PCL-TEE-BLK-M"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Orsak / referens"), { target: { value: "Physical count" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara inventering" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("api-commerce", "inventory-correct", expect.objectContaining({ physical_on_hand: 6, expected_version: 4 })));

    fireEvent.click(screen.getByRole("tab", { name: "Ordrar" }));
    fireEvent.click(await screen.findByRole("button", { name: /PICKLA-TEST-1/ }));
    expect(screen.getByRole("link", { name: "Hantera uthämtning i Desk" })).toHaveAttribute("href", "/desk");
    expect(screen.getByText(/Återbetalar betalningen. Ändrar inte fysiskt lager/)).toBeInTheDocument();
    expect(screen.getByText(/Registrerar vad som faktiskt hände med varan/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Starta återbetalning" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("api-commerce", "refund", expect.objectContaining({ order_id: order.id, lines: [{ line_id: "line-1", quantity: 1 }] })));
    fireEvent.change(screen.getByLabelText("Fysiskt utfall"), { target: { value: "return_damaged" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrera fysisk sanning" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("api-commerce", "physical-disposition", expect.objectContaining({ line_id: "line-1", outcome: "return_damaged", quantity: 1 })));

    fireEvent.click(screen.getByRole("tab", { name: "Översikt" }));
    fireEvent.click(screen.getByRole("button", { name: "Arkivera vid nästa sparning" }));
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("api-admin", "products", expect.objectContaining({ productId: savedProduct.id, status: "archived" })));
  });
});
