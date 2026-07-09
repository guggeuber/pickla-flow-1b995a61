const PUBLIC_BOOKING_GUEST_EMAIL = 'guest-booking@pickla.local';

const normalizeEmail = (value: unknown) => {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
};

const normalizePhone = (value: unknown) => {
  const phone = String(value || '').replace(/[^0-9+]/g, '').trim();
  return phone || null;
};

function cleanName(value: unknown) {
  const name = String(value || '').trim();
  return name || null;
}

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

async function organizationIdForVenue(admin: any, venueId?: string | null): Promise<string | null> {
  const cleanVenueId = String(venueId || '').trim();
  if (cleanVenueId) {
    const { data: venue, error } = await admin
      .from('venues')
      .select('organization_id')
      .eq('id', cleanVenueId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (venue?.organization_id) return venue.organization_id;
  }

  const { data: org, error } = await admin
    .from('organizations')
    .select('id')
    .eq('slug', 'pickla')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return org?.id || null;
}

export async function linkCustomerToVenue(admin: any, customerId?: string | null, venueId?: string | null, source = 'customer_link') {
  const cleanCustomerId = String(customerId || '').trim();
  const cleanVenueId = String(venueId || '').trim();
  if (!cleanCustomerId || !cleanVenueId) return;

  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await admin
    .from('customer_venue_profiles')
    .select('id')
    .eq('customer_id', cleanCustomerId)
    .eq('venue_id', cleanVenueId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing?.id) {
    await admin
      .from('customer_venue_profiles')
      .update({
        last_seen_at: now,
        metadata: { source },
      })
      .eq('id', existing.id);
    return;
  }

  const { error } = await admin.from('customer_venue_profiles').insert({
    customer_id: cleanCustomerId,
    venue_id: cleanVenueId,
    is_home_venue: false,
    first_seen_at: now,
    last_seen_at: now,
    visit_count: 0,
    metadata: { source },
  });
  if (error) throw new Error(error.message);
}

async function assertIdentityCanAttach(admin: any, organizationId: string, customerId: string, provider: string, providerId: string) {
  const { data, error } = await admin
    .from('customer_identities')
    .select('customer_id')
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .eq('provider_id', providerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.customer_id && data.customer_id !== customerId) {
    throw new Error('Customer identity is already linked to another customer');
  }
}

async function insertIdentityIfMissing(admin: any, row: Record<string, unknown>) {
  const organizationId = String(row.organization_id || '');
  const provider = String(row.provider || '');
  const providerId = String(row.provider_id || '');
  if (!organizationId || !provider || !providerId) return;

  const { data: existing, error: existingError } = await admin
    .from('customer_identities')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .eq('provider_id', providerId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.id) return;

  const { error } = await admin.from('customer_identities').insert(row);
  if (error) throw new Error(error.message);
}

export async function resolveOrCreateCustomerIdForUser(
  admin: any,
  userId?: string | null,
  venueId?: string | null,
  source = 'customer_resolve',
): Promise<string | null> {
  const cleanUserId = String(userId || '').trim();
  if (!cleanUserId) return null;

  const { data: authResult, error: authError } = await admin.auth.admin.getUserById(cleanUserId);
  if (authError) throw new Error(authError.message);
  const authUser = authResult?.user;
  const email = normalizeEmail(authUser?.email);
  if (!authUser || email === PUBLIC_BOOKING_GUEST_EMAIL) return null;

  const existingCustomerId = await resolveCustomerIdForUser(admin, cleanUserId);
  if (existingCustomerId) {
    await linkCustomerToVenue(admin, existingCustomerId, venueId, source);
    return existingCustomerId;
  }

  const { data: authIdentity, error: authIdentityError } = await admin
    .from('customer_identities')
    .select('customer_id')
    .eq('provider', 'auth')
    .eq('provider_id', cleanUserId)
    .limit(1)
    .maybeSingle();
  if (authIdentityError) throw new Error(authIdentityError.message);
  if (authIdentity?.customer_id) {
    await admin
      .from('player_profiles')
      .update({ customer_id: authIdentity.customer_id })
      .eq('auth_user_id', cleanUserId)
      .is('customer_id', null);
    await linkCustomerToVenue(admin, authIdentity.customer_id, venueId, source);
    return authIdentity.customer_id;
  }

  const organizationId = await organizationIdForVenue(admin, venueId);
  if (!organizationId) throw new Error('Missing organization for customer identity');

  const { data: profile, error: profileError } = await admin
    .from('player_profiles')
    .select('id, customer_id, display_name, first_name, last_name, phone')
    .eq('auth_user_id', cleanUserId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (profile?.customer_id) {
    await linkCustomerToVenue(admin, profile.customer_id, venueId, source);
    return profile.customer_id;
  }

  const displayName = cleanName(profile?.display_name)
    || cleanName([profile?.first_name, profile?.last_name].filter(Boolean).join(' '))
    || cleanName(authUser.user_metadata?.display_name)
    || cleanName(authUser.user_metadata?.full_name)
    || email
    || 'Kund';
  const phone = normalizePhone(profile?.phone);

  let customerId: string | null = null;
  if (email) {
    const { data: emailCustomer, error: emailCustomerError } = await admin
      .from('customers')
      .select('id, auth_user_id')
      .eq('organization_id', organizationId)
      .eq('email_normalized', email)
      .eq('status', 'active')
      .is('merged_into_id', null)
      .maybeSingle();
    if (emailCustomerError) throw new Error(emailCustomerError.message);
    if (emailCustomer?.id) {
      if (emailCustomer.auth_user_id && emailCustomer.auth_user_id !== cleanUserId) {
        throw new Error('Email is already linked to another customer');
      }
      await assertIdentityCanAttach(admin, organizationId, emailCustomer.id, 'auth', cleanUserId);
      customerId = emailCustomer.id;
      const { error: updateError } = await admin
        .from('customers')
        .update({
          auth_user_id: cleanUserId,
          display_name: displayName,
          primary_email: email,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId);
      if (updateError) throw new Error(updateError.message);
    }
  }

  if (!customerId) {
    const { data: inserted, error: insertError } = await admin
      .from('customers')
      .insert({
        organization_id: organizationId,
        auth_user_id: cleanUserId,
        display_name: displayName,
        first_name: profile?.first_name || null,
        last_name: profile?.last_name || null,
        primary_email: email,
        primary_phone: profile?.phone || null,
        email_normalized: email,
        phone_e164: phone,
        metadata: {
          source,
          player_profile_id: profile?.id || null,
        },
      })
      .select('id')
      .single();
    if (insertError) throw new Error(insertError.message);
    customerId = inserted.id;
  }

  await admin
    .from('player_profiles')
    .update({ customer_id: customerId })
    .eq('auth_user_id', cleanUserId)
    .is('customer_id', null);

  await assertIdentityCanAttach(admin, organizationId, customerId, 'auth', cleanUserId);
  await insertIdentityIfMissing(admin, {
    customer_id: customerId,
    organization_id: organizationId,
    provider: 'auth',
    provider_id: cleanUserId,
    verified_at: new Date().toISOString(),
    metadata: { source },
  });

  if (email) {
    await assertIdentityCanAttach(admin, organizationId, customerId, 'email', email);
    await insertIdentityIfMissing(admin, {
      customer_id: customerId,
      organization_id: organizationId,
      provider: 'email',
      provider_id: email,
      email,
      verified_at: authUser.email_confirmed_at || null,
      metadata: { source },
    });
  }

  if (phone) {
    await insertIdentityIfMissing(admin, {
      customer_id: customerId,
      organization_id: organizationId,
      provider: 'phone',
      provider_id: phone,
      phone: profile?.phone || phone,
      metadata: { source },
    });
  }

  await linkCustomerToVenue(admin, customerId, venueId, source);
  return customerId;
}
