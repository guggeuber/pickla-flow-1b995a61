import type { getServiceClient } from './auth.ts';

type SupabaseAdminClient = ReturnType<typeof getServiceClient>;

export async function canListCustomers(
  admin: SupabaseAdminClient,
  userId: string,
  venueId?: string | null,
) {
  const globalRolePromise = admin.from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'super_admin')
    .maybeSingle();
  const venueStaffPromise = venueId
    ? admin.from('venue_staff')
      .select('id')
      .eq('user_id', userId)
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [globalRoleResult, venueStaffResult] = await Promise.all([
    globalRolePromise,
    venueStaffPromise,
  ]);
  if (globalRoleResult.error) throw new Error(globalRoleResult.error.message);
  if (venueStaffResult.error) throw new Error(venueStaffResult.error.message);
  return Boolean(globalRoleResult.data || venueStaffResult.data);
}

export function filterVenueEligibleProfiles<T extends {
  customer_id?: string | null;
  auth_user_id?: string | null;
}>(
  profiles: T[],
  eligibleCustomerIds: Iterable<string>,
  eligibleUserIds: Iterable<string>,
) {
  const customerIds = new Set(eligibleCustomerIds);
  const userIds = new Set(eligibleUserIds);
  return profiles.filter((profile) =>
    Boolean(
      (profile.customer_id && customerIds.has(profile.customer_id))
      || (profile.auth_user_id && userIds.has(profile.auth_user_id)),
    )
  );
}
