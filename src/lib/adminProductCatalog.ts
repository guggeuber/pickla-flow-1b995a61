export type ProductCatalogStatus = "draft" | "active" | "archived";
export type ProductSalesFilter = "all" | "standalone" | "addon" | "both";
export type ProductCatalogSort = "name" | "price_asc" | "price_desc";

export interface CatalogProductLike {
  name: string;
  description?: string | null;
  status: ProductCatalogStatus;
  standalone_enabled: boolean;
  activity_addon_enabled: boolean;
  category?: string | null;
  sport?: string | null;
  base_price_sek: number;
}

export interface ProductCatalogFilters {
  search: string;
  status: "all" | ProductCatalogStatus;
  salesMode: ProductSalesFilter;
  category: string;
  sport: string;
  sort: ProductCatalogSort;
}

export function productSalesModeLabel(product: CatalogProductLike) {
  if (product.standalone_enabled && product.activity_addon_enabled) return "Butik + aktivitet";
  if (product.standalone_enabled) return "Butik";
  if (product.activity_addon_enabled) return "Aktivitetstillval";
  return "Inte till salu";
}

export function filterAndSortProducts<T extends CatalogProductLike>(products: T[], filters: ProductCatalogFilters) {
  const needle = filters.search.trim().toLocaleLowerCase("sv-SE");
  return products
    .filter((product) => {
      if (filters.status !== "all" && product.status !== filters.status) return false;
      if (filters.category && product.category !== filters.category) return false;
      if (filters.sport && product.sport !== filters.sport) return false;
      if (filters.salesMode === "standalone" && !product.standalone_enabled) return false;
      if (filters.salesMode === "addon" && !product.activity_addon_enabled) return false;
      if (filters.salesMode === "both" && !(product.standalone_enabled && product.activity_addon_enabled)) return false;
      if (!needle) return true;
      return [product.name, product.description, product.category, product.sport]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("sv-SE").includes(needle));
    })
    .sort((left, right) => {
      if (filters.sort === "price_asc") return Number(left.base_price_sek) - Number(right.base_price_sek);
      if (filters.sort === "price_desc") return Number(right.base_price_sek) - Number(left.base_price_sek);
      return left.name.localeCompare(right.name, "sv-SE");
    });
}
