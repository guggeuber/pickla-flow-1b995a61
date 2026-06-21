const PUBLIC_BOOKING_GUEST_EMAIL = 'guest-booking@pickla.local';

export async function resolveCustomerIdForUser(admin: any, userId?: string | null): Promise<string | null> {
  const cleanUserId = String(userId || '').trim();
  if (!cleanUserId) return null;

  const { data: authResult } = await admin.auth.admin.getUserById(cleanUserId);
  const email = String(authResult?.user?.email || '').trim().toLowerCase();
  if (email === PUBLIC_BOOKING_GUEST_EMAIL) return null;

  const { data: profile, error: profileError } = await admin
    .from('player_profiles')
    .select('customer_id')
    .eq('auth_user_id', cleanUserId)
    .maybeSingle();
  if (profileError) {
    console.error('resolveCustomerIdForUser profile lookup failed', profileError.message);
  }
  if (profile?.customer_id) return profile.customer_id;

  const { data: customer, error: customerError } = await admin
    .from('customers')
    .select('id')
    .eq('auth_user_id', cleanUserId)
    .eq('status', 'active')
    .maybeSingle();
  if (customerError) {
    console.error('resolveCustomerIdForUser customer lookup failed', customerError.message);
  }

  return customer?.id || null;
}
