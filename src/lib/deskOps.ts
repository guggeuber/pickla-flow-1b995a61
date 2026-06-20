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
