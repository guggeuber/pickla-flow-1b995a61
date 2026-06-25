import { DateTime } from "luxon";
import { apiPost } from "@/lib/api";

export function deskBookingCheckinEligibility(booking: any) {
  if (!booking?.venue_id) return { ok: false, reason: "Bokningsdata saknas" };
  const ids = Array.isArray(booking.source_ids) && booking.source_ids.length ? booking.source_ids : booking.id ? [booking.id] : [];
  if (!ids.length) return { ok: false, reason: "Boknings-id saknas" };

  const startIso = booking.starts_at || booking.start_time;
  const endIso = booking.ends_at || booking.end_time;
  if (!startIso || !endIso) return { ok: false, reason: "Tid saknas" };

  const now = DateTime.now().setZone("Europe/Stockholm");
  const start = DateTime.fromISO(startIso, { zone: "utc" }).setZone("Europe/Stockholm");
  const end = DateTime.fromISO(endIso, { zone: "utc" }).setZone("Europe/Stockholm");
  if (!start.isValid || !end.isValid) return { ok: false, reason: "Ogiltig tid" };
  if (start.toISODate() !== now.toISODate()) return { ok: false, reason: "Inte idag" };
  if (now < start.minus({ minutes: 30 })) return { ok: false, reason: `Öppnar ${start.minus({ minutes: 30 }).toFormat("HH:mm")}` };
  if (now > end) return { ok: false, reason: "Passerad" };

  const amount = Number(booking.amount_sek ?? booking.total_price ?? 0);
  const paymentStatus = String(booking.payment_status || "").toLowerCase();
  const paymentOk = paymentStatus === "paid" || paymentStatus === "free" || amount <= 0;
  const statusOk = !booking.status || ["confirmed", "completed"].includes(String(booking.status));
  if (!statusOk) return { ok: false, reason: "Inte bekräftad" };
  if (!paymentOk) return { ok: false, reason: "Ej betald" };
  if (booking.checked_in) return { ok: false, reason: "Redan inne" };

  return { ok: true, reason: "" };
}

export function bookingIdsForCheckin(booking: any) {
  return Array.isArray(booking?.source_ids) && booking.source_ids.length ? booking.source_ids : booking?.id ? [booking.id] : [];
}

export function checkInDeskBooking(booking: any) {
  return apiPost("api-checkins", "booking", {
    venue_id: booking.venue_id,
    booking_ids: bookingIdsForCheckin(booking),
    customer_name: booking.customer_name || booking.booked_by || null,
  });
}

export function activityRegistrationCheckinEligibility(registration: any) {
  if (!registration?.venue_id) return { ok: false, reason: "Passdata saknas" };
  if (!registration?.session_registration_id && !registration?.registration_id) return { ok: false, reason: "Biljett-id saknas" };

  const startIso = registration.starts_at || registration.start_time;
  const endIso = registration.ends_at || registration.end_time;
  if (!startIso || !endIso) return { ok: false, reason: "Tid saknas" };

  const now = DateTime.now().setZone("Europe/Stockholm");
  const start = DateTime.fromISO(startIso, { zone: "utc" }).setZone("Europe/Stockholm");
  const end = DateTime.fromISO(endIso, { zone: "utc" }).setZone("Europe/Stockholm");
  if (!start.isValid || !end.isValid) return { ok: false, reason: "Ogiltig tid" };
  if (start.toISODate() !== now.toISODate()) return { ok: false, reason: "Inte idag" };
  if (now < start.minus({ minutes: 30 })) return { ok: false, reason: `Öppnar ${start.minus({ minutes: 30 }).toFormat("HH:mm")}` };
  if (now > end) return { ok: false, reason: "Passerad" };

  const amount = Number(registration.amount_sek ?? registration.total_price ?? registration.price_paid_sek ?? 0);
  const paymentStatus = String(registration.payment_status || "").toLowerCase();
  const paymentOk = ["paid", "free", "confirmed"].includes(paymentStatus) || amount <= 0;
  const status = String(registration.status || "confirmed").toLowerCase();
  if (!["confirmed", "checked_in", "paid"].includes(status)) return { ok: false, reason: "Inte bekräftad" };
  if (!paymentOk) return { ok: false, reason: "Ej betald" };
  if (registration.checked_in || registration.consumed || status === "checked_in") return { ok: false, reason: "Redan inne" };

  return { ok: true, reason: "" };
}

export function checkInActivityRegistration(registration: any) {
  const registrationId = registration.session_registration_id || registration.registration_id;
  return apiPost("api-checkins", "checkin", {
    venue_id: registration.venue_id,
    customer_id: registration.customer_id || null,
    target_user_id: registration.user_id || null,
    entry_type: "session_ticket",
    entitlement_id: registrationId,
    player_name: registration.customer_name || registration.player_name || registration.booked_by || null,
    player_phone: registration.customer_phone || registration.player_phone || null,
  });
}
