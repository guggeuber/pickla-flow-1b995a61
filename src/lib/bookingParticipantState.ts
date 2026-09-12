import { DateTime } from "luxon";

export type BookingParticipantOperationalState =
  | "confirmed_included"
  | "confirmed_paid"
  | "payment_pending"
  | "payment_expired"
  | "payment_attention"
  | "identity_pending"
  | "confirmation_pending"
  | "cancelled_released";

export type BookingParticipantStateView = {
  state: BookingParticipantOperationalState;
  hasPlace: boolean;
  reserved: boolean;
  checkInAllowed: boolean;
  headline: string;
  detail: string;
  tone: "positive" | "pending" | "attention" | "cancelled";
  paymentLinkAction: "resume" | "retry" | "identity" | "confirm" | null;
  paymentLinkLabel: string | null;
};

type ParticipantStateInput = {
  operational_state?: BookingParticipantOperationalState | string | null;
  payment_status?: string | null;
  customer_id?: string | null;
  user_id?: string | null;
  check_in_allowed?: boolean | null;
  can_resume_payment?: boolean | null;
  can_retry_payment?: boolean | null;
  reservation_expires_at?: string | null;
  access_reason?: string | null;
  amount_sek?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type ParticipantSummaryInput = {
  confirmed_count?: number | null;
  committed_count?: number | null;
  reserved_count?: number | null;
  available_count?: number | null;
  capacity?: number | null;
  capacity_source?: string | null;
  capacity_is_authoritative?: boolean | null;
  capacity_state?: "ok" | "over_capacity_attention" | string | null;
  capacity_invariant_violation?: boolean | null;
  over_capacity_count?: number | null;
};

function fallbackState(participant: ParticipantStateInput): BookingParticipantOperationalState {
  const status = String(participant?.payment_status || "").toLowerCase();
  if (status === "cancelled") return "cancelled_released";
  if (status === "paid") return "confirmed_paid";
  if (status === "free") return "confirmed_included";
  return participant?.customer_id || participant?.user_id ? "payment_expired" : "identity_pending";
}

function expiryTime(value: unknown) {
  const expiry = DateTime.fromISO(String(value || ""), { zone: "utc" }).setZone("Europe/Stockholm");
  return expiry.isValid ? expiry.toFormat("HH:mm") : "";
}

function accessReason(participant: ParticipantStateInput) {
  const metadata = participant?.metadata && typeof participant.metadata === "object" ? participant.metadata : {};
  return String(participant?.access_reason || metadata.effective_access_reason || metadata.access_reason || "").trim();
}

function amountLabel(participant: ParticipantStateInput) {
  const amount = Number(participant?.amount_sek);
  return Number.isFinite(amount) && amount >= 0 ? `${amount.toLocaleString("sv-SE")} kr` : "aktuellt pris";
}

export function bookingParticipantStateView(participant: ParticipantStateInput): BookingParticipantStateView {
  const state = (participant?.operational_state || fallbackState(participant)) as BookingParticipantOperationalState;
  const reason = accessReason(participant);
  const expiresAt = expiryTime(participant?.reservation_expires_at);

  switch (state) {
    case "confirmed_paid":
      return {
        state,
        hasPlace: true,
        reserved: false,
        checkInAllowed: participant?.check_in_allowed !== false,
        headline: "HAR PLATS",
        detail: "Betald",
        tone: "positive",
        paymentLinkAction: null,
        paymentLinkLabel: null,
      };
    case "confirmed_included":
      return {
        state,
        hasPlace: true,
        reserved: false,
        checkInAllowed: participant?.check_in_allowed !== false,
        headline: "HAR PLATS",
        detail: reason ? `Ingår · ${reason}` : "Ingår",
        tone: "positive",
        paymentLinkAction: null,
        paymentLinkLabel: null,
      };
    case "payment_pending":
      return {
        state,
        hasPlace: false,
        reserved: true,
        checkInAllowed: false,
        headline: "BETALNING PÅGÅR",
        detail: expiresAt ? `Plats reserverad till ${expiresAt}` : "Plats tillfälligt reserverad",
        tone: "pending",
        paymentLinkAction: participant?.can_resume_payment === false ? null : "resume",
        paymentLinkLabel: participant?.can_resume_payment === false ? null : "Kopiera betalningslänk",
      };
    case "payment_expired":
      return {
        state,
        hasPlace: false,
        reserved: false,
        checkInAllowed: false,
        headline: "HAR INTE PLATS ÄNNU",
        detail: `Betalning utgången · betala ${amountLabel(participant)}`,
        tone: "pending",
        paymentLinkAction: participant?.can_retry_payment === false ? null : "retry",
        paymentLinkLabel: participant?.can_retry_payment === false ? null : "Kopiera ny betalningslänk",
      };
    case "confirmation_pending":
      return {
        state,
        hasPlace: false,
        reserved: false,
        checkInAllowed: false,
        headline: "HAR INTE PLATS ÄNNU",
        detail: reason ? `Bekräfta rättighet · ${reason}` : "Bekräfta rättighet",
        tone: "pending",
        paymentLinkAction: "confirm",
        paymentLinkLabel: "Kopiera platslänk",
      };
    case "identity_pending":
      return {
        state,
        hasPlace: false,
        reserved: false,
        checkInAllowed: false,
        headline: "HAR INTE PLATS ÄNNU",
        detail: "Identitet krävs",
        tone: "pending",
        paymentLinkAction: "identity",
        paymentLinkLabel: "Kopiera inbjudningslänk",
      };
    case "payment_attention":
      return {
        state,
        hasPlace: false,
        reserved: false,
        checkInAllowed: false,
        headline: "KRÄVER ÅTGÄRD",
        detail: "Betalning eller plats behöver kontrolleras",
        tone: "attention",
        paymentLinkAction: null,
        paymentLinkLabel: null,
      };
    case "cancelled_released":
    default:
      return {
        state: "cancelled_released",
        hasPlace: false,
        reserved: false,
        checkInAllowed: false,
        headline: "AVBOKAD",
        detail: "Platsen är släppt",
        tone: "cancelled",
        paymentLinkAction: null,
        paymentLinkLabel: null,
      };
  }
}

export function bookingParticipantCustomerCopy(participant: ParticipantStateInput) {
  const view = bookingParticipantStateView(participant);
  if (view.state === "confirmed_paid" || view.state === "confirmed_included") {
    return { title: "Din plats är klar", detail: view.detail };
  }
  if (view.state === "payment_pending") {
    return { title: "Betalning pågår", detail: view.detail };
  }
  if (view.state === "payment_attention") {
    return { title: "Din plats behöver kontrolleras", detail: "Ingen ny betalning startas automatiskt." };
  }
  if (view.state === "cancelled_released") {
    return { title: "Din plats är avbokad", detail: "Platsen är släppt." };
  }
  if (view.state === "confirmation_pending") {
    return { title: "Bekräfta din plats", detail: "Din rättighet kontrolleras innan platsen blir klar." };
  }
  return { title: "Slutför betalningen för att säkra platsen", detail: `Ditt pris är ${amountLabel(participant)}.` };
}

export function bookingParticipantSummaryLabel(summary: ParticipantSummaryInput) {
  const confirmed = Math.max(0, Number(summary?.confirmed_count ?? summary?.committed_count ?? 0));
  const reserved = Math.max(0, Number(summary?.reserved_count || 0));
  const capacity = Math.max(0, Number(summary?.capacity || 0));
  const available = Math.max(0, Number(summary?.available_count ?? 0));
  const overCapacity = Math.max(0, Number(summary?.over_capacity_count ?? 0));
  if (summary?.capacity_invariant_violation === true || summary?.capacity_state === "over_capacity_attention") {
    return `${confirmed}/${capacity} har plats · KRÄVER ÅTGÄRD (+${overCapacity})`;
  }
  if (reserved > 0) {
    return `${confirmed} har plats · ${reserved} reserverad${reserved === 1 ? "" : "e"} · ${available} ledig${available === 1 ? "" : "a"}`;
  }
  return `${confirmed}/${capacity} har plats · ${available} ${available === 1 ? "plats" : "platser"} kvar`;
}
