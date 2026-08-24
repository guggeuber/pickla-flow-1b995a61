import { supabase } from "@/integrations/supabase/client";
import { terminateInvalidSessionSingleFlight } from "@/lib/authSessionSingleFlight";

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

type SessionUserResult = {
  data: { user: { id: string } | null };
  error: unknown | null;
};

type SessionValidator = () => Promise<SessionUserResult>;
type InvalidSessionTerminator = () => Promise<unknown>;

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

function authErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") return { name: "", code: "", status: null as number | null };
  const authError = error as { name?: unknown; code?: unknown; status?: unknown };
  return {
    name: typeof authError.name === "string" ? authError.name : "",
    code: typeof authError.code === "string" ? authError.code : "",
    status: typeof authError.status === "number" ? authError.status : null,
  };
}

function isUnrecoverableSessionError(error: unknown) {
  const { name, code, status } = authErrorDetails(error);
  return name === "AuthSessionMissingError"
    || ["bad_jwt", "refresh_token_not_found", "session_not_found", "user_not_found"].includes(code)
    || status === 401
    || status === 403;
}

/** Remotely validates one restored session at the authenticated app boundary. */
export async function validateRestoredSessionWith(
  expectedUserId: string,
  validate: SessionValidator,
  terminate: InvalidSessionTerminator,
) {
  const result = await validate();
  if (!result.error && result.data.user?.id === expectedUserId) return result.data.user;

  const mismatchedUser = !result.error && result.data.user?.id !== expectedUserId;
  if (mismatchedUser || isUnrecoverableSessionError(result.error)) {
    await terminate();
  }

  if (result.error instanceof Error) throw result.error;
  throw new Error(mismatchedUser ? "Restored auth user does not match the active session" : "Auth session validation failed");
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

export async function loadAccountBootstrap(userId: string) {
  await validateRestoredSessionWith(
    userId,
    () => supabase.auth.getUser() as Promise<SessionUserResult>,
    () => terminateInvalidSessionSingleFlight(),
  );
  return loadAccountBootstrapWith(supabaseBootstrapClient, userId);
}
