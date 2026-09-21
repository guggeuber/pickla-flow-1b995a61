import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminProducts from "@/components/admin/AdminProducts";
import { buildVariantMatrix, productInventoryState, skuBaseFromName } from "@/lib/adminCommerce";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), remove: vi.fn() }));

vi.mock("@/lib/api", () => ({ apiGet: api.get, apiPost: api.post, apiPatch: api.patch, apiDelete: api.remove }));

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
    api.get.mockReset(); api.post.mockReset(); api.patch.mockReset(); api.remove.mockReset();
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

  afterEach(cleanup);

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
});
