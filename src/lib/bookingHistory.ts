import { DateTime } from "luxon";

import {
  getBookingChatResourceId,
  getLegacyDirectBookingTimeResourceId,
  groupBookingRows,
} from "@/lib/bookingGroups";

export type BookingHistoryStatus = "upcoming" | "completed" | "cancelled";

export type BookingHistoryItem = Record<string, unknown> & {
  history_status: BookingHistoryStatus;
};

export type BookingConversationRoom = {
  room_type?: string | null;
  resource_id?: string | null;
};

function getBookingConversationResourceKeys(booking: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  const addBookingKeys = (value: Record<string, unknown>) => {
    const resourceId = getBookingChatResourceId(value);
    const legacyResourceId = getLegacyDirectBookingTimeResourceId(value);
    if (resourceId) keys.add(resourceId);
    if (legacyResourceId) keys.add(legacyResourceId);
    if (value.booking_ref) keys.add(String(value.booking_ref));
  };

  addBookingKeys(booking);
  const rows = Array.isArray(booking.bookings) ? booking.bookings : [];
  rows.forEach((row) => {
    if (row && typeof row === "object") addBookingKeys(row as Record<string, unknown>);
  });
  return keys;
}

export function bookingHasConversation(
  booking: Record<string, unknown>,
  rooms: BookingConversationRoom[],
): boolean {
  const bookingKeys = getBookingConversationResourceKeys(booking);
  return rooms.some((room) =>
    room.room_type === "booking" &&
    Boolean(room.resource_id) &&
    bookingKeys.has(String(room.resource_id))
  );
}

export function getBookingHistoryStatus(
  booking: Record<string, unknown>,
  nowMillis = DateTime.now().toMillis(),
): BookingHistoryStatus {
  if (booking.status === "cancelled") return "cancelled";

  const endMillis = DateTime.fromISO(String(booking.end_time || ""), { setZone: true }).toMillis();
  return Number.isFinite(endMillis) && endMillis < nowMillis ? "completed" : "upcoming";
}

export function buildBookingHistory(
  rows: Record<string, unknown>[] = [],
  nowMillis = DateTime.now().toMillis(),
): BookingHistoryItem[] {
  return groupBookingRows(rows)
    .map((booking: Record<string, unknown>): BookingHistoryItem => ({
      ...booking,
      history_status: getBookingHistoryStatus(booking, nowMillis),
    }))
    .sort((a, b) => {
      if (a.history_status === "upcoming" && b.history_status !== "upcoming") return -1;
      if (a.history_status !== "upcoming" && b.history_status === "upcoming") return 1;

      const aStart = DateTime.fromISO(String(a.start_time || ""), { setZone: true }).toMillis();
      const bStart = DateTime.fromISO(String(b.start_time || ""), { setZone: true }).toMillis();
      return a.history_status === "upcoming" ? aStart - bStart : bStart - aStart;
    });
}

export function formatBookingHistoryTime(booking: Record<string, unknown>): string {
  const start = DateTime.fromISO(String(booking.start_time || ""), { setZone: true }).setZone("Europe/Stockholm");
  const end = DateTime.fromISO(String(booking.end_time || ""), { setZone: true }).setZone("Europe/Stockholm");
  return `${start.setLocale("sv").toFormat("ccc d LLL HH:mm")}–${end.toFormat("HH:mm")}`;
}
