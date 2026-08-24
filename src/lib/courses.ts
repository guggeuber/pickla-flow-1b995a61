import { apiDelete, apiGet, apiPatch, apiPost, type ApiRequestOptions } from "@/lib/api";
import type { SeriesPresentationType } from "@/lib/seriesPresentation";

export type CourseFormat = {
  id: string;
  name: string;
  description: string | null;
  full_description: string | null;
  image_urls: string[];
  presentation_type: SeriesPresentationType;
  age_group: "adult" | "youth" | "all_ages";
  level: "intro" | "beginner" | "intermediate" | "advanced";
  requires_instructor: boolean;
};

export type CourseSession = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  court_ids: string[];
  requires_staffing: boolean;
  is_active: boolean;
  series_occurrence_index: number;
};

export type CourseResourceConflict = {
  source_type: "booking" | "activity_session" | "event_reservation" | "resource_block" | "venue_closure" | string;
  source_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
};

export type CourseResourcePreviewRow = {
  occurrence_index: number;
  occurrence_date: string;
  proposed_starts_at: string;
  proposed_ends_at: string;
  court_id: string;
  court_name: string;
  is_available: boolean;
  conflicts: CourseResourceConflict[];
};

export type CourseResourcePreview = {
  rows: CourseResourcePreviewRow[];
  has_conflicts: boolean;
  occurrence_count: number;
};

export type CourseSeries = {
  id: string;
  venue_id: string;
  format_id: string;
  name: string;
  description: string | null;
  image_urls: string[];
  status: string;
  start_date: string;
  end_date: string;
  total_sessions: number;
  registration_opens_at: string;
  registration_closes_at: string;
  capacity: number;
  recurrence_days: number[];
  start_time: string;
  end_time: string;
  court_ids: string[];
  registration_state: "upcoming" | "open" | "closed";
  customer_has_commitment: boolean;
  format: CourseFormat;
  product: {
    id: string;
    product_key: string;
    name: string;
    description: string | null;
    base_price_sek: number;
    vat_rate: number;
    status: string;
    is_active: boolean;
    scarcity_mode: "none" | "early_bird" | "capacity";
    early_bird_price_minor: number | null;
    early_bird_slots: number | null;
  };
  pricing?: SeriesCustomerPricing | null;
  venue: { id: string; name: string; slug: string };
  sessions: CourseSession[];
  commitment?: Record<string, unknown> | null;
  staff_grants?: SeriesStaffGrant[];
  edit_policy?: {
    lifecycle_editable: boolean;
    schedule_editable: boolean;
    schedule_lock_reason: "lifecycle_locked" | "series_started" | "participants_or_payments_exist" | "active_checkout_holds" | "staffing_exists" | null;
    has_started: boolean;
    commitment_count: number;
    active_holds_count: number;
    order_history_count: number;
    registration_count: number;
    staffing_assignment_count: number;
    minimum_capacity: number;
    historical_prices_frozen: boolean;
  };
};

export type SeriesCustomerPricing = {
  scope_type: "activity_series";
  list_price_minor: number;
  final_price_minor: number;
  pricing_reason: "series_product_base_price" | "membership_tier_pricing" | "early_bird" | string;
  sales_channel: string;
  checkout_label: string;
  membership_tier_name: string | null;
  early_bird: {
    configured: boolean;
    active: boolean;
    applied: boolean;
    price_minor: number | null;
    slots: number | null;
    remaining: number | null;
  };
};

export type SeriesMemberPricingTier = {
  tier: { id: string; name: string; color: string | null; sort_order: number | null };
  rule: {
    id: string;
    tier_id: string;
    product_type: string;
    fixed_price: number | null;
    discount_percent: number | null;
    vat_rate: number | null;
    label: string | null;
    mode: "fixed" | "percent";
  } | null;
  preview: {
    ordinary_price_sek: number;
    resolved_price_sek: number;
    mode: "fixed" | "percent";
    value: number;
  } | null;
};

export type SeriesMemberPricingItem = {
  series_id: string;
  product: {
    id: string;
    venue_id: string;
    product_key: string;
    product_kind: string;
    name: string;
    base_price_sek: number;
    is_active: boolean;
    status: string;
  } | null;
  tiers: SeriesMemberPricingTier[];
};

export type SeriesGrantParticipant = {
  kind: "customer" | "dependent";
  id: string;
  name: string;
  detail: string | null;
};

export type SeriesStaffGrant = {
  id: string;
  activity_series_id: string;
  status: "active" | "cancelled";
  activated_at: string;
  cancelled_at: string | null;
  participant: SeriesGrantParticipant;
  provenance_label: "Friplats · Pickla";
  grant_reason: string | null;
};

// The API exposes sellable capacity as a nested projection. Keep it distinct
// from Series.capacity in client code to avoid treating physical sessions as
// the commercial seat counter.
export type CourseDetail = Omit<CourseSeries, "capacity"> & {
  capacity: {
    capacity: number;
    committed_count: number;
    active_holds_count: number;
    available_count: number;
  };
};

export type MyCourseItem = {
  commitment: { id: string; status: string; dependent_participant_id?: string | null };
  series: { id: string; venue_id: string; name: string; format_name?: string | null; start_date: string; end_date: string; total_sessions: number; presentation_type?: SeriesPresentationType };
  participant: { kind: "customer" | "dependent"; id?: string; first_name?: string; birth_year?: number };
  next_session: CourseSession | null;
  completed_sessions: number;
  total_sessions: number;
  access?: { label: "Friplats"; detail: "Ingår · Pickla" } | null;
};

export function fetchCourseDetail(seriesId: string) {
  return apiGet<CourseDetail>("api-courses", "detail", { seriesId });
}

export function fetchMyCourses() {
  return apiGet<{ items: MyCourseItem[] }>("api-courses", "my");
}

export function fetchCourseHome(venueSlug: string) {
  return apiGet<{ mode: "none" | "registration" | "next"; item: CourseDetail | MyCourseItem | null }>(
    "api-courses",
    "home",
    { v: venueSlug },
  );
}

export function fetchCourseCatalog(venueSlug: string) {
  return apiGet<{ items: CourseDetail[] }>("api-courses", "catalog", { v: venueSlug });
}

export function createCourseCart(input: Record<string, unknown>, options?: ApiRequestOptions) {
  return apiPost<{ order: { id: string }; cart_token?: string; course_access?: Record<string, unknown> }>(
    "api-commerce",
    "course-cart",
    input,
    options,
  );
}

export function fetchCourseAdmin(venueId: string) {
  return apiGet<{ formats: CourseFormat[]; series: CourseDetail[]; courts: Array<{ id: string; name: string; sport_type: string }> }>(
    "api-courses",
    "admin",
    { venueId },
  );
}

export function fetchSeriesMemberPricing(venueId: string) {
  return apiGet<{ series: SeriesMemberPricingItem[] }>("api-memberships", "series-tier-pricing", { venueId });
}

export function saveSeriesMemberPricing(input: {
  ruleId?: string | null;
  tierId: string;
  productKey: string;
  mode: "fixed" | "percent";
  value: number;
  label: string;
}) {
  const body = {
    ...(input.ruleId ? { id: input.ruleId } : { tierId: input.tierId }),
    product_type: input.productKey,
    fixed_price: input.mode === "fixed" ? input.value : null,
    discount_percent: input.mode === "percent" ? input.value : null,
    label: input.label,
  };
  return input.ruleId
    ? apiPatch("api-memberships", "tier-pricing", body)
    : apiPost("api-memberships", "tier-pricing", body);
}

export function removeSeriesMemberPricing(ruleId: string) {
  return apiDelete("api-memberships", `tier-pricing?id=${encodeURIComponent(ruleId)}`);
}

export function createCourseFormat(input: Record<string, unknown>) {
  return apiPost<CourseFormat>("api-courses", "format", input);
}

export function updateCourseFormat(input: Record<string, unknown>) {
  return apiPatch<CourseFormat>("api-courses", "format", input);
}

export function createCourseSeries(input: Record<string, unknown>) {
  return apiPost<{ series: { id: string }; sessions: CourseSession[] }>("api-courses", "series", input);
}

export function previewCourseSeries(input: Record<string, unknown>) {
  return apiPost<CourseResourcePreview>("api-courses", "series-preview", input);
}

export function updateCourseSeries(input: Record<string, unknown>) {
  return apiPatch<CourseDetail>("api-courses", "series", input);
}

export function saveSeriesEarlyBird(input: {
  seriesId: string;
  enabled: boolean;
  priceSek?: number;
  slots?: number;
}) {
  return apiPatch<{
    series_id: string;
    product: CourseSeries["product"];
    preview: {
      ordinary_price_sek: number;
      early_bird_price_sek: number | null;
      early_bird_slots: number | null;
    };
  }>("api-courses", "series-early-bird", {
    series_id: input.seriesId,
    enabled: input.enabled,
    price_sek: input.enabled ? input.priceSek : null,
    slots: input.enabled ? input.slots : null,
  });
}

export function findSeriesGrantParticipants(venueId: string, search: string) {
  return apiGet<{ items: SeriesGrantParticipant[] }>("api-courses", "grant-participants", { venueId, search });
}

export function grantSeriesStaffPlace(input: {
  venue_id: string;
  series_id: string;
  participant_kind: "customer" | "dependent";
  participant_id: string;
  reason: string;
  request_id: string;
}) {
  return apiPost<{
    ok: true;
    commitment_id: string;
    entitlement_id: string;
    available_count: number;
    reason: string;
    grant: SeriesStaffGrant;
  }>("api-courses", "staff-grant", input);
}

export function cancelSeriesStaffPlace(input: {
  venue_id: string;
  commitment_id: string;
  reason: string;
  request_id: string;
}) {
  return apiPost<{
    ok: true;
    commitment_id: string;
    entitlement_id: string;
    available_count: number;
    reason: string;
  }>("api-courses", "staff-grant-cancel", input);
}
