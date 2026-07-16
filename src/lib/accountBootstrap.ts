import { supabase } from "@/integrations/supabase/client";

export type AccountIdentityRecord = {
  id?: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  customer_id?: string | null;
  phone?: string | null;
};

export type AccountBootstrap = {
  profile: AccountIdentityRecord | null;
  customer: AccountIdentityRecord | null;
  identityMissing: boolean;
};

type BootstrapClient = {
  fetchProfile: (userId: string) => Promise<{ data: unknown; error: { message?: string } | null }>;
  fetchCustomerById: (customerId: string) => Promise<{ data: unknown; error: { message?: string } | null }>;
  fetchCustomerByUserId: (userId: string) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

type BootstrapQueryResult = Promise<{ data: unknown; error: { message?: string } | null }>;
type BootstrapTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => BootstrapQueryResult;
    };
  };
};
type BootstrapSupabase = { from: (table: string) => BootstrapTable };

const bootstrapSupabase = supabase as unknown as BootstrapSupabase;

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeAccountIdentity(value: unknown): AccountIdentityRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    id: optionalId(record.id),
    display_name: optionalText(record.display_name),
    first_name: optionalText(record.first_name),
    last_name: optionalText(record.last_name),
    customer_id: optionalId(record.customer_id),
    phone: optionalText(record.phone ?? record.primary_phone),
  };
}

function bootstrapError(scope: string, error: { message?: string } | null) {
  return new Error(`Account bootstrap ${scope} failed: ${error?.message || "Unknown error"}`);
}

export async function loadAccountBootstrapWith(client: BootstrapClient, userId: string): Promise<AccountBootstrap> {
  const profileResult = await client.fetchProfile(userId);
  if (profileResult.error) throw bootstrapError("profile", profileResult.error);
  const profile = normalizeAccountIdentity(profileResult.data);

  let customerResult = profile?.customer_id
    ? await client.fetchCustomerById(profile.customer_id)
    : { data: null, error: null };
  if (customerResult.error) throw bootstrapError("customer", customerResult.error);

  if (!customerResult.data) {
    customerResult = await client.fetchCustomerByUserId(userId);
    if (customerResult.error) throw bootstrapError("customer fallback", customerResult.error);
  }

  const customer = normalizeAccountIdentity(customerResult.data);
  return {
    profile,
    customer,
    // Missing rows are an explicitly supported degraded state. Downstream screens
    // must use auth metadata/fallback labels until the database trigger catches up.
    identityMissing: !profile && !customer,
  };
}

const supabaseBootstrapClient: BootstrapClient = {
  fetchProfile: async (userId) => {
    const result = await supabase
      .from("player_profiles")
      .select("id, display_name, first_name, last_name, customer_id, phone")
      .eq("auth_user_id", userId)
      .maybeSingle();
    return { data: result.data, error: result.error };
  },
  fetchCustomerById: async (customerId) => {
    const result = await bootstrapSupabase
      .from("customers")
      .select("id, display_name, first_name, last_name, primary_phone")
      .eq("id", customerId)
      .maybeSingle();
    return { data: result.data, error: result.error };
  },
  fetchCustomerByUserId: async (userId) => {
    const result = await bootstrapSupabase
      .from("customers")
      .select("id, display_name, first_name, last_name, primary_phone")
      .eq("auth_user_id", userId)
      .maybeSingle();
    return { data: result.data, error: result.error };
  },
};

export function loadAccountBootstrap(userId: string) {
  return loadAccountBootstrapWith(supabaseBootstrapClient, userId);
}
