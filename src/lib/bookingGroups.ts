export const BOOKING_GROUP_PREFIX = "stripe:";

export function getBookingChatResourceId(booking: any): string {
  if (booking?.stripe_session_id) return `${BOOKING_GROUP_PREFIX}${booking.stripe_session_id}`;
  return booking?.booking_ref || booking?.id || "";
}

export function isStripeBookingResourceId(resourceId?: string | null): boolean {
  return !!resourceId && resourceId.startsWith(BOOKING_GROUP_PREFIX);
}

export function getStripeSessionFromResourceId(resourceId?: string | null): string | null {
  if (!isStripeBookingResourceId(resourceId)) return null;
  return resourceId!.slice(BOOKING_GROUP_PREFIX.length);
}

export function groupBookingRows(rows: any[] = []): any[] {
  const groups = new Map<string, any>();

  for (const row of rows) {
    const key = getBookingChatResourceId(row);
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        id: key,
        booking_ref: row.booking_ref,
        bookings: [],
        court_names: [],
        access_codes: [],
        total_price: 0,
      });
    }

    const group = groups.get(key);
    group.bookings.push(row);
    group.total_price += Number(row.total_price || 0);

    const courtName = row.venue_courts?.name;
    if (courtName && !group.court_names.includes(courtName)) {
      group.court_names.push(courtName);
    }

    if (row.access_code && !group.access_codes.includes(row.access_code)) {
      group.access_codes.push(row.access_code);
    }
  }

  return Array.from(groups.values()).map((group) => {
    const bookings = [...group.bookings].sort((a, b) =>
      String(a.venue_courts?.name || "").localeCompare(String(b.venue_courts?.name || ""), "sv")
    );
    const statuses = bookings.map((b) => b.status);
    const status = statuses.every((s) => s === "cancelled")
      ? "cancelled"
      : statuses.some((s) => s === "pending")
      ? "pending"
      : "confirmed";

    return {
      ...group,
      bookings,
      status,
      court_count: bookings.length,
      court_names: bookings
        .map((b) => b.venue_courts?.name)
        .filter((name, index, arr) => name && arr.indexOf(name) === index),
      access_codes: bookings
        .map((b) => b.access_code)
        .filter((code, index, arr) => code && arr.indexOf(code) === index),
      primary_booking_ref: bookings[0]?.booking_ref || group.booking_ref,
    };
  });
}

export function getBookingCourtLabel(booking: any): string {
  const count = booking?.court_count || booking?.bookings?.length || 1;
  if (count > 1) return `${count} banor`;
  return booking?.court_names?.[0] || booking?.venue_courts?.name || "Bana";
}

export function getBookingCourtNamesLabel(booking: any): string {
  const names = booking?.court_names || booking?.bookings?.map((b: any) => b.venue_courts?.name).filter(Boolean) || [];
  if (names.length > 1) return names.join(", ");
  return names[0] || booking?.venue_courts?.name || "Bana";
}

export function getBookingAccessCodes(booking: any): string[] {
  const codes = booking?.access_codes?.length
    ? booking.access_codes
    : booking?.bookings?.length
    ? booking.bookings.map((b: any) => b.access_code).filter(Boolean)
    : booking?.access_code
    ? [booking.access_code]
    : [];
  return codes.length ? [codes[0]] : [];
}

export function getBookingIds(booking: any): string[] {
  if (booking?.bookings?.length) return booking.bookings.map((b: any) => b.id).filter(Boolean);
  return booking?.id && !String(booking.id).startsWith(BOOKING_GROUP_PREFIX) ? [booking.id] : [];
}

export function stripBookingCodesFromText(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/\s*·\s*Koder?:\s*[\d,\s]+/gi, "")
    .replace(/\s*Koder?:\s*[\d,\s]+/gi, "")
    .trim();
}
