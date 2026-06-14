import type { EventLandingConfig } from "@/config/eventLandingPages";

export type EventLandingFormType = "group_inquiry";

export type EventLandingTrackPayload = {
  event: "event_landing_inquiry_submit";
  slug: string;
  keyword: string;
  inquiryCategory: "corporate" | "private" | "unknown";
  source: string;
  formType: EventLandingFormType;
  participants?: number;
  hasDate?: boolean;
  hasBudget?: boolean;
  packageSlug?: string | null;
};

function isDebug(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("debug") === "events") return true;
    if (window.localStorage?.getItem("pickla_debug_events") === "1") return true;
  } catch {
    /* noop */
  }
  return false;
}

/**
 * Lightweight validator: warns in dev/debug when expected SEO fields are missing
 * but never blocks submission. Returns a normalized payload safe to send.
 */
export function validateLandingPayload(
  cfg: Partial<EventLandingConfig>,
  extra: { formType: EventLandingFormType },
): { keyword: string; source: string; inquiryCategory: "corporate" | "private" | "unknown"; formType: EventLandingFormType } {
  const missing: string[] = [];
  if (!cfg.inquiryCategory) missing.push("inquiryCategory");
  if (!cfg.inquirySource) missing.push("inquirySource");
  if (!cfg.primaryKeyword) missing.push("primaryKeyword");

  if (missing.length && isDebug()) {
    // eslint-disable-next-line no-console
    console.warn("[event-landing] missing tracking fields:", missing, { slug: cfg.slug, path: cfg.path });
  }

  return {
    keyword: cfg.primaryKeyword || "",
    source: cfg.inquirySource || cfg.path || "unknown",
    inquiryCategory: (cfg.inquiryCategory as "corporate" | "private") || "unknown",
    formType: extra.formType,
  };
}

/** Fires to Vercel Analytics + gtag + dataLayer when present. Never throws. */
export function trackLandingInquiry(payload: EventLandingTrackPayload) {
  try {
    const w = window as any;
    const data = { ...payload };
    if (typeof w.va === "function") w.va("event", { name: payload.event, data });
    if (typeof w.gtag === "function") w.gtag("event", payload.event, data);
    if (Array.isArray(w.dataLayer)) w.dataLayer.push(data);
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.log("[event_landing_inquiry_submit]", data);
    }
  } catch {
    /* analytics failures must never break submit */
  }
}
