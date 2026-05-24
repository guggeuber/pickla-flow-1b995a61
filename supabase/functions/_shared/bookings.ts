import { DateTime } from 'https://esm.sh/luxon@3.5.0';

export const VENUE_TIMEZONE = 'Europe/Stockholm';

export function stockholmDate(): string {
  return DateTime.now().setZone(VENUE_TIMEZONE).toISODate()!;
}

export function stockholmDateRangeUtc(date: string): { start: string; end: string } {
  const day = DateTime.fromISO(date, { zone: VENUE_TIMEZONE });
  if (!day.isValid) throw new Error('Invalid Stockholm date');
  return {
    start: day.startOf('day').toUTC().toISO()!,
    end: day.endOf('day').toUTC().toISO()!,
  };
}

/**
 * Generates a unique 4-digit access code for a booking (no repeated digits, no NNNN patterns).
 * Retries up to 50 times to find a code that isn't already used for the venue on the given Stockholm date.
 */
export async function generateAccessCode(
  supabase: any,
  venueId: string,
  bookingDate: string, // YYYY-MM-DD in Stockholm local time (used for uniqueness window)
): Promise<string> {
  const { start, end } = stockholmDateRangeUtc(bookingDate);
  const excluded = new Set(['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999']);
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (excluded.has(code)) continue;
    const { data } = await supabase
      .from('bookings')
      .select('id')
      .eq('venue_id', venueId)
      .eq('access_code', code)
      .gte('start_time', start)
      .lte('start_time', end)
      .limit(1)
      .maybeSingle();
    if (!data) return code;
  }
  throw new Error('Kunde inte generera unik åtkomstkod');
}

/**
 * Finds or lazily creates a shared guest user used for anonymous (non-authenticated) bookings.
 */
export async function getOrCreatePublicBookingUserId(admin: any): Promise<string> {
  const publicEmail = 'guest-booking@pickla.local';

  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    const found = data?.users?.find((u: any) => u.email?.toLowerCase() === publicEmail);
    if (found?.id) return found.id;
    if (!data?.users || data.users.length < 200) break;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: publicEmail,
    email_confirm: true,
    user_metadata: { display_name: 'Public Booking Guest' },
  });
  if (error || !data?.user?.id) throw new Error('Kunde inte skapa gästanvändare för bokning');
  return data.user.id;
}

export async function findAuthUserByEmail(admin: any, email: string): Promise<any | null> {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data?.users?.find((user: any) => user.email?.toLowerCase() === normalizedEmail);
    if (found) return found;
    if (!data?.users || data.users.length < 200) break;
  }

  return null;
}
