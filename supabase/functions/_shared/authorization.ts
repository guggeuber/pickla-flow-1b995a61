import { getAuthenticatedClient, getServiceClient } from './auth.ts';

type SupabaseAdminClient = ReturnType<typeof getServiceClient>;

type AuditMutationInput = {
  req: Request;
  userId: string;
  action: string;
  entityTable: string;
  entityId?: string | null;
  venueId?: string | null;
  organizationId?: string | null;
  franchiseeId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

const SUPER_ADMIN_ROLE = 'super_admin';

export async function requireUser(req: Request) {
  const result = await getAuthenticatedClient(req);
  if (result.error || !result.client || !result.userId) {
    throw new Error(result.error || 'Unauthorized');
  }
  return result;
}

export async function isSuperAdmin(admin: SupabaseAdminClient, userId: string) {
  const { data, error } = await admin
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', SUPER_ADMIN_ROLE)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function requireSuperAdmin(admin: SupabaseAdminClient, userId: string) {
  if (await isSuperAdmin(admin, userId)) return true;
  throw new Error('Forbidden: super admin only');
}

export async function requireVenueRole(
  admin: SupabaseAdminClient,
  userId: string,
  venueId: string,
  roles: string[] = ['venue_admin'],
) {
  if (!venueId) throw new Error('Missing venueId');
  if (await isSuperAdmin(admin, userId)) return true;

  const { data, error } = await admin
    .from('venue_staff')
    .select('id')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .in('role', roles)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return true;
  throw new Error('Forbidden: venue role required');
}

export async function requireOrganizationRole(
  admin: SupabaseAdminClient,
  userId: string,
  organizationId: string,
  roles: string[] = ['owner', 'admin'],
) {
  if (!organizationId) throw new Error('Missing organizationId');
  if (await isSuperAdmin(admin, userId)) return true;

  const { data, error } = await admin
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .in('role', roles)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return true;
  throw new Error('Forbidden: organization role required');
}

export async function canOperateVenue(admin: SupabaseAdminClient, userId: string, venueId: string) {
  if (!venueId) return false;
  if (await isSuperAdmin(admin, userId)) return true;

  const { data, error } = await admin
    .from('venue_staff')
    .select('id')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function getAuthorizedVenueIds(admin: SupabaseAdminClient, userId: string) {
  if (await isSuperAdmin(admin, userId)) {
    const { data, error } = await admin.from('venues').select('id').order('name');
    if (error) throw new Error(error.message);
    return (data || []).map((row: { id: string }) => row.id);
  }

  const { data: staffRows, error: staffError } = await admin
    .from('venue_staff')
    .select('venue_id')
    .eq('user_id', userId)
    .eq('is_active', true);
  if (staffError) throw new Error(staffError.message);

  const { data: orgRows, error: orgError } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('role', ['owner', 'admin', 'ops']);
  if (orgError) throw new Error(orgError.message);

  const orgIds = (orgRows || []).map((row: { organization_id: string }) => row.organization_id).filter(Boolean);
  let orgVenueIds: string[] = [];
  if (orgIds.length) {
    const { data: venues, error: venueError } = await admin
      .from('venues')
      .select('id')
      .in('organization_id', orgIds);
    if (venueError) throw new Error(venueError.message);
    orgVenueIds = (venues || []).map((row: { id: string }) => row.id);
  }

  return Array.from(new Set([
    ...(staffRows || []).map((row: { venue_id: string }) => row.venue_id).filter(Boolean),
    ...orgVenueIds,
  ]));
}

export async function writeAuditLog(admin: SupabaseAdminClient, row: Record<string, unknown>) {
  const { error } = await admin.from('audit_log').insert(row);
  if (error) throw new Error(error.message);
}

export async function auditMutation(admin: SupabaseAdminClient, input: AuditMutationInput) {
  const requestId = input.req.headers.get('x-request-id') || crypto.randomUUID();
  const forwardedFor = input.req.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || input.req.headers.get('x-real-ip') || null;

  await writeAuditLog(admin, {
    organization_id: input.organizationId || null,
    franchisee_id: input.franchiseeId || null,
    venue_id: input.venueId || null,
    actor_user_id: input.userId,
    actor_type: 'user',
    action: input.action,
    entity_table: input.entityTable,
    entity_id: input.entityId || null,
    request_id: requestId,
    before: input.before || null,
    after: input.after || null,
    metadata: input.metadata || {},
    ip,
    user_agent: input.req.headers.get('user-agent') || null,
  });
}
