import { DateTime } from "luxon";
import { apiGet, apiPost } from "@/lib/api";

export type CancellationSubjectType =
  | "activity_registration"
  | "booking_participant"
  | "court_booking"
  | "series_commitment"
  | "league_team_entry";

export type CancellationPolicyCopy = {
  title: string;
  summary: string;
  late: string;
  boundary: string;
};

export type CancellationDecision = {
  subject_type: CancellationSubjectType;
  subject_id: string;
  venue_id: string;
  policy_mode: "policy_v1" | "legacy";
  snapshot_id: string | null;
  authority_key?: string;
  policy_family: string;
  policy_key: string;
  policy_version: number | null;
  provenance: string;
  copy_sv: CancellationPolicyCopy;
  copy_en: CancellationPolicyCopy;
  evaluated_at: string;
  state_revision: string;
  decision_revision?: string;
  allowed: boolean;
  can_cancel?: boolean;
  reason_code: string;
  already_cancelled: boolean;
  checked_in: boolean;
  cancel_deadline_at: string | null;
  refund_deadline_at: string | null;
  refund_mode: "automatic_full" | "none" | "manual_legacy";
  refund_eligible?: boolean;
  refund_amount_minor: number;
  currency: string;
  entitlement_restore_mode: "measurable" | "none" | "not_applicable";
  entitlement_effect?: "measurable" | "none" | "not_applicable";
  capacity_release_mode: "immediate";
  capacity_effect?: "release_immediately" | "none";
  customer_message_key?: string;
  customer_message_params?: Record<string, unknown>;
  decision_id?: string;
  refund_status?: string | null;
  refund_processing?: boolean;
  restored_court_hours?: number;
};

export type PublicCancellationPolicy = {
  policy_key: string;
  version: number;
  preset_key: string;
  rules: Record<string, unknown>;
  copy_sv: CancellationPolicyCopy;
  copy_en: CancellationPolicyCopy;
  source: string;
};

export function fetchCancellationPreview(subjectType: CancellationSubjectType, subjectId: string) {
  return apiPost<CancellationDecision>("api-cancellations", "preview", {
    subject_type: subjectType,
    subject_id: subjectId,
  });
}

export function confirmCancellation(decision: CancellationDecision, requestId = crypto.randomUUID()) {
  return apiPost<CancellationDecision>("api-cancellations", "confirm", {
    subject_type: decision.subject_type,
    subject_id: decision.subject_id,
    state_revision: decision.state_revision,
    request_id: requestId,
  });
}

export type StaffCancellationChoice = {
  refundChoice: "policy" | "full" | "none";
  restoreChoice: "policy" | "restore" | "none";
};

export function fetchStaffCancellationPreview(
  subjectType: CancellationSubjectType,
  subjectId: string,
  choice: StaffCancellationChoice,
) {
  return apiPost<CancellationDecision>("api-cancellations", "staff-preview", {
    subject_type: subjectType,
    subject_id: subjectId,
    refund_choice: choice.refundChoice,
    restore_choice: choice.restoreChoice,
  });
}

export function confirmStaffCancellation(
  decision: CancellationDecision,
  reason: string,
  choice: StaffCancellationChoice,
  requestId = crypto.randomUUID(),
) {
  return apiPost<CancellationDecision>("api-cancellations", "staff-confirm", {
    subject_type: decision.subject_type,
    subject_id: decision.subject_id,
    state_revision: decision.state_revision,
    request_id: requestId,
    reason,
    refund_choice: choice.refundChoice,
    restore_choice: choice.restoreChoice,
  });
}

export function fetchPublicCancellationPolicy(input: {
  venueId: string;
  family: string;
  productId?: string | null;
  seriesId?: string | null;
  eventId?: string | null;
}) {
  return apiGet<PublicCancellationPolicy>("api-cancellations", "public-policy", {
    venueId: input.venueId,
    family: input.family,
    ...(input.productId ? { productId: input.productId } : {}),
    ...(input.seriesId ? { seriesId: input.seriesId } : {}),
    ...(input.eventId ? { eventId: input.eventId } : {}),
  });
}

function formatDeadline(value: string | null, locale: "sv" | "en") {
  if (!value) return null;
  return DateTime.fromISO(value, { zone: "utc" })
    .setZone("Europe/Stockholm")
    .setLocale(locale)
    .toFormat(locale === "sv" ? "d LLL yyyy 'kl.' HH:mm" : "d LLL yyyy, HH:mm");
}

export function cancellationDecisionCopy(decision: CancellationDecision, locale: "sv" | "en" = "sv") {
  const english = locale === "en";
  const amount = new Intl.NumberFormat(english ? "en-GB" : "sv-SE", {
    style: "currency",
    currency: decision.currency || "SEK",
    maximumFractionDigits: 2,
  }).format(Number(decision.refund_amount_minor || 0) / 100);
  const cancelDeadline = formatDeadline(decision.cancel_deadline_at, locale);
  const refundDeadline = formatDeadline(decision.refund_deadline_at, locale);
  const refund = decision.refund_mode === "automatic_full"
    ? english ? `${amount} will be refunded automatically.` : `Du får ${amount} tillbaka automatiskt.`
    : decision.refund_mode === "manual_legacy"
      ? english ? "This is an earlier purchase. Pickla will review the refund under the terms that applied then." : "Det här är ett tidigare köp. Pickla granskar återbetalningen enligt villkoren som gällde då."
      : english ? "No refund will be made." : "Ingen återbetalning görs.";
  const restore = decision.entitlement_restore_mode === "measurable"
    ? english ? "Your measurable membership entitlement will be restored." : "Din mätbara medlemsrättighet återställs."
    : decision.entitlement_restore_mode === "not_applicable"
      ? english ? "Your unlimited entitlement is unaffected." : "Din obegränsade rättighet påverkas inte."
      : english ? "No entitlement will be restored." : "Ingen rättighet återställs.";
  const blocked = (english ? {
    checked_in_locked: "You are already checked in. Contact Pickla if something is wrong.",
    course_started: "The course has started. Self-service economic cancellation is closed.",
    cancellation_closed: "The customer cancellation deadline has passed.",
    registration_closed: "Registration has closed.",
    fixtures_published: "Fixtures have been published. Team cancellation is locked.",
    league_started: "The league has started. Team cancellation is locked.",
    already_cancelled: "This place has already been cancelled.",
  } : {
    checked_in_locked: "Du är redan incheckad. Kontakta Pickla om något blivit fel.",
    course_started: "Kursen har startat. Självservice för ekonomisk avbokning är stängd.",
    cancellation_closed: "Tiden för kundavbokning har passerat.",
    registration_closed: "Anmälan har stängt.",
    fixtures_published: "Spelschemat är publicerat. Lagavbokning är låst.",
    league_started: "Seriespelet har startat. Lagavbokning är låst.",
    already_cancelled: "Platsen är redan avbokad.",
  } as Record<string, string>)[decision.reason_code];

  const policyCopy = english ? decision.copy_en : decision.copy_sv;
  const legacy = decision.policy_mode === "legacy";

  return {
    title: policyCopy?.title || (legacy ? "Legacy policy" : english ? "Cancellation policy" : "Avbokningsvillkor"),
    summary: policyCopy?.summary || (english ? "The place is released immediately when cancellation is confirmed." : "Platsen släpps direkt när avbokningen bekräftas."),
    outcome: blocked || `${refund} ${restore}`,
    cancelDeadline: cancelDeadline ? english ? `Cancellation deadline: ${cancelDeadline}.` : `Avbokning senast: ${cancelDeadline}.` : null,
    refundDeadline: refundDeadline ? english ? `Refund cutoff: strictly before ${refundDeadline}.` : `Återbetalningsgräns: strikt före ${refundDeadline}.` : null,
    confirmLabel: decision.refund_mode === "automatic_full"
      ? english ? `Cancel and refund ${amount}` : `Avboka och återbetala ${amount}`
      : decision.refund_mode === "manual_legacy"
        ? english ? "Cancel · refund reviewed" : "Avboka · återbetalning granskas"
      : english ? "Cancel without refund" : "Avboka utan återbetalning",
  };
}
