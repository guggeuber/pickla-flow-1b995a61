/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canListCustomers,
  filterVenueEligibleProfiles,
} from '../../supabase/functions/_shared/customer_access';
import {
  linkCustomerToVenue,
  resolveOrCreateCustomerIdForUser,
} from '../../supabase/functions/_shared/customers';

type Row = Record<string, any>;
type Result = { data: any; error: { message: string; code?: string } | null };

class FixtureQuery implements PromiseLike<Result> {
  private action: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private payload: Row | Row[] | null = null;
  private filters: Array<(row: Row) => boolean> = [];
  private maximum: number | null = null;

  constructor(
    private readonly database: Record<string, Row[]>,
    private readonly table: string,
  ) {}

  select(_columns?: string) {
    return this;
  }

  insert(payload: Row | Row[]) {
    this.action = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.action = 'update';
    this.payload = payload;
    return this;
  }

  upsert(payload: Row | Row[]) {
    this.action = 'upsert';
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  limit(value: number) {
    this.maximum = value;
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.execute(true));
  }

  single() {
    return Promise.resolve(this.execute(true));
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute(false)).then(onfulfilled, onrejected);
  }

  private execute(single: boolean): Result {
    const rows = this.database[this.table] || (this.database[this.table] = []);
    if (this.action === 'insert') {
      const inserted = (Array.isArray(this.payload) ? this.payload : [this.payload]).filter(Boolean) as Row[];
      rows.push(...inserted.map((row) => ({ ...row })));
      return { data: single ? inserted[0] || null : inserted, error: null };
    }
    if (this.action === 'upsert') {
      const upserted = (Array.isArray(this.payload) ? this.payload : [this.payload]).filter(Boolean) as Row[];
      for (const row of upserted) {
        const existing = rows.find((candidate) =>
          candidate.id === row.id
          || (candidate.auth_user_id && candidate.auth_user_id === row.auth_user_id)
        );
        if (existing) Object.assign(existing, row);
        else rows.push({ ...row });
      }
      return { data: single ? upserted[0] || null : upserted, error: null };
    }

    let selected = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.maximum !== null) selected = selected.slice(0, this.maximum);
    if (this.action === 'update') {
      selected.forEach((row) => Object.assign(row, this.payload));
    }
    return { data: single ? selected[0] || null : selected.map((row) => ({ ...row })), error: null };
  }
}

function fixtureAdmin(database: Record<string, Row[]>, authUsers: Record<string, Row> = {}) {
  return {
    from: (table: string) => new FixtureQuery(database, table),
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: authUsers[id] || null },
          error: authUsers[id] ? null : { message: 'User not found' },
        }),
      },
    },
  };
}

describe('customer and membership production restoration', () => {
  it('denies ordinary users without a venue and preserves explicit super-admin global authority', async () => {
    const ordinaryDb = { user_roles: [], venue_staff: [] };
    await expect(canListCustomers(fixtureAdmin(ordinaryDb), 'ordinary-user', null)).resolves.toBe(false);

    const superDb = {
      user_roles: [{ user_id: 'super-user', role: 'super_admin' }],
      venue_staff: [],
    };
    await expect(canListCustomers(fixtureAdmin(superDb), 'super-user', null)).resolves.toBe(true);
  });

  it('authorizes only active staff at the requested venue', async () => {
    const database = {
      user_roles: [],
      venue_staff: [
        { id: 'staff-a', user_id: 'operator', venue_id: 'venue-a', is_active: true },
        { id: 'staff-b', user_id: 'inactive-operator', venue_id: 'venue-b', is_active: false },
      ],
    };
    const admin = fixtureAdmin(database);
    await expect(canListCustomers(admin, 'operator', 'venue-a')).resolves.toBe(true);
    await expect(canListCustomers(admin, 'operator', 'venue-b')).resolves.toBe(false);
    await expect(canListCustomers(admin, 'inactive-operator', 'venue-b')).resolves.toBe(false);
  });

  it('filters search profile matches to the requested venue scope', () => {
    const profiles = [
      { id: 'profile-a', customer_id: 'customer-a', auth_user_id: 'user-a' },
      { id: 'profile-b', customer_id: 'customer-b', auth_user_id: 'user-b' },
      { id: 'receipt-user', customer_id: null, auth_user_id: 'receipt-user' },
    ];
    expect(filterVenueEligibleProfiles(
      profiles,
      ['customer-a'],
      ['user-a', 'receipt-user'],
    ).map((profile) => profile.id)).toEqual(['profile-a', 'receipt-user']);
  });

  it('reuses the canonical same-organization customer and links that identity to the venue', async () => {
    const database: Record<string, Row[]> = {
      player_profiles: [{ id: 'profile', auth_user_id: 'user', customer_id: 'merged-customer' }],
      customers: [
        { id: 'merged-customer', organization_id: 'org-a', merged_into_id: 'canonical-customer', status: 'active' },
        { id: 'canonical-customer', organization_id: 'org-a', merged_into_id: null, status: 'active' },
      ],
      venues: [{ id: 'venue-a', organization_id: 'org-a' }],
      customer_venue_profiles: [],
      organizations: [{ id: 'org-a', slug: 'pickla' }],
      customer_identities: [],
    };
    const admin = fixtureAdmin(database, {
      user: { id: 'user', email: 'synthetic@example.invalid', user_metadata: {} },
    });

    await expect(resolveOrCreateCustomerIdForUser(
      admin,
      'user',
      'venue-a',
      'membership_restore_test',
    )).resolves.toBe('canonical-customer');
    expect(database.player_profiles[0].customer_id).toBe('canonical-customer');
    expect(database.customer_venue_profiles).toEqual([
      expect.objectContaining({ customer_id: 'canonical-customer', venue_id: 'venue-a' }),
    ]);
  });

  it('rejects cross-organization customer linking before creating a venue link', async () => {
    const database: Record<string, Row[]> = {
      player_profiles: [{ id: 'profile', auth_user_id: 'user', customer_id: 'foreign-customer' }],
      customers: [
        { id: 'foreign-customer', organization_id: 'org-b', merged_into_id: null, status: 'active' },
      ],
      venues: [{ id: 'venue-a', organization_id: 'org-a' }],
      customer_venue_profiles: [],
      organizations: [{ id: 'org-a', slug: 'pickla' }],
      customer_identities: [],
    };
    const admin = fixtureAdmin(database, {
      user: { id: 'user', email: 'synthetic@example.invalid', user_metadata: {} },
    });

    await expect(resolveOrCreateCustomerIdForUser(
      admin,
      'user',
      'venue-a',
      'membership_restore_test',
    )).rejects.toThrow('Customer identity scope mismatch');
    await expect(linkCustomerToVenue(
      admin,
      'foreign-customer',
      'venue-a',
      'membership_restore_test',
    )).rejects.toThrow('Customer identity scope mismatch');
    expect(database.customer_venue_profiles).toHaveLength(0);
  });

  it('restores the customer, Commerce, social and membership-pricing contracts from main', () => {
    const customersApi = readFileSync('supabase/functions/api-customers/index.ts', 'utf8');
    const membershipsApi = readFileSync('supabase/functions/api-memberships/index.ts', 'utf8');

    expect(customersApi).toContain("path === 'social-preferences'");
    expect(customersApi).toContain(".from('commerce_orders')");
    expect(customersApi).toContain('requestedCommerceOrderId');
    expect(customersApi).toContain('filterVenueEligibleProfiles');
    expect(customersApi).toContain('const canList = await canListCustomers(admin, userId, venueId)');
    expect(membershipsApi).toContain("path === 'series-tier-pricing'");
    expect(membershipsApi).toContain('validatedTierPricingWrite');
    expect(membershipsApi).toContain('allowDraftProduct: allow_draft_product === true');
  });

  it('resolves customer scope before cancelling an existing membership but documents non-transactional retry risk', () => {
    const membershipsApi = readFileSync('supabase/functions/api-memberships/index.ts', 'utf8');
    const assignBlock = membershipsApi.slice(
      membershipsApi.indexOf("path === 'assign'"),
      membershipsApi.indexOf("path === 'assign-email'"),
    );
    expect(assignBlock.indexOf('resolveOrCreateCustomerIdForUser')).toBeLessThan(
      assignBlock.indexOf(".update({ status: 'cancelled' })"),
    );
    expect(assignBlock.indexOf(".update({ status: 'cancelled' })")).toBeLessThan(
      assignBlock.indexOf(".from('memberships').insert"),
    );
    expect(assignBlock).not.toContain('.rpc(');
  });
});
