import type { CourseDetail } from "@/lib/courses";

export type CatalogOfferSection = "active" | "draft" | "paused" | "archived";

function metadataFlag(metadata: Record<string, unknown>, key: string) {
  return metadata[key] === true || String(metadata[key] || "").toLowerCase() === "true";
}

export function catalogOfferHiddenReason(series: CourseDetail) {
  const metadata = series.metadata && typeof series.metadata === "object" ? series.metadata : {};
  const provenance = [
    metadata.source_type,
    metadata.provenance,
    metadata.fixture_type,
    metadata.created_for,
  ].map((value) => String(value || "").toLowerCase());
  if (metadataFlag(metadata, "catalog_hidden")) return "catalog_hidden";
  if (metadataFlag(metadata, "synthetic") || metadataFlag(metadata, "test_fixture")) return "synthetic";
  if (provenance.some((value) => value.includes("test_fixture") || value.includes("production_smoke"))) return "synthetic";

  // Existing House Comp production-smoke fixtures carry an explicit hc_<run>
  // marker in their operator identity. It is provenance, not a customer offer.
  if (/\bhc_[a-z0-9_-]+/i.test(series.name)) return "house_comp_smoke";
  return null;
}

export function catalogOfferSection(series: CourseDetail): CatalogOfferSection {
  if (series.status === "active") return "active";
  if (series.status === "draft") return "draft";
  if (series.status === "paused") return "paused";
  return "archived";
}

export function visibleCatalogOffers(series: CourseDetail[]) {
  return series.filter((item) => !catalogOfferHiddenReason(item));
}

export function sortCatalogOffers(series: CourseDetail[]) {
  return [...series].sort((left, right) => {
    const dateOrder = String(left.start_date || "9999-12-31").localeCompare(String(right.start_date || "9999-12-31"));
    return dateOrder || left.name.localeCompare(right.name, "sv");
  });
}
