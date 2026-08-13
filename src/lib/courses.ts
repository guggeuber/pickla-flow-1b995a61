import { apiGet, apiPatch, apiPost, type ApiRequestOptions } from "@/lib/api";

export type CourseFormat = {
  id: string;
  name: string;
  description: string | null;
  full_description: string | null;
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
    name: string;
    description: string | null;
    base_price_sek: number;
    vat_rate: number;
  };
  venue: { id: string; name: string; slug: string };
  sessions: CourseSession[];
  commitment?: Record<string, unknown> | null;
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
  series: { id: string; venue_id: string; name: string; start_date: string; end_date: string; total_sessions: number };
  participant: { kind: "customer" | "dependent"; id?: string; first_name?: string; birth_year?: number };
  next_session: CourseSession | null;
  completed_sessions: number;
  total_sessions: number;
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
