import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminProducts from "@/components/admin/AdminProducts";
import { ProductMediaEditor } from "@/components/admin/commerce/ProductMediaEditor";
import { buildVariantMatrix, productInventoryState, skuBaseFromName } from "@/lib/adminCommerce";

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

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
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

  it("shows Products, Inventory and Orders as one Admin OS workspace", async () => {
    products = [{ ...savedProduct }];
    render(<AdminProducts venueId={venueId} />, { wrapper: wrapper() });
    const tabs = await screen.findByRole("tablist", { name: "Commerce" });
    expect(within(tabs).getByRole("tab", { name: "Produkter" })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: "Lager" })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: "Ordrar" })).toBeInTheDocument();
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
