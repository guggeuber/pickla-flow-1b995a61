export const PICKLA_PRODUCTION_PROJECT_REF = 'ptnvhbniiiapzbyofctg';
export const PICKLA_STAGE_PROJECT_REF = 'anpxxnpevtxhiajxmfji';

export type PicklaRuntimeEnvironment = 'production' | 'stage' | 'local';
export type StripeProviderMode = 'live' | 'test';

export type StripeEnvironmentContract = {
  environment: PicklaRuntimeEnvironment;
  projectRef: string;
  stripeMode: StripeProviderMode;
};

type StripeEnvironmentInput = {
  picklaEnvironment?: string | null;
  supabaseUrl?: string | null;
  stripeSecretKey?: string | null;
};

function normalizeEnvironment(value: string | null | undefined): PicklaRuntimeEnvironment {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'production') return 'production';
  if (normalized === 'stage') return 'stage';
  if (['local', 'development', 'test'].includes(normalized)) return 'local';
  throw new Error('Stripe environment guard rejected: PICKLA_ENVIRONMENT is missing or unsupported');
}

function stripeModeFromSecret(value: string | null | undefined): StripeProviderMode {
  const key = String(value || '').trim();
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  throw new Error('Stripe environment guard rejected: unsupported Stripe secret-key mode');
}

function projectIdentity(value: string | null | undefined) {
  let url: URL;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('Stripe environment guard rejected: SUPABASE_URL is invalid');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return { projectRef: 'local', local: true };
  }
  if (!hostname.endsWith('.supabase.co')) {
    throw new Error('Stripe environment guard rejected: SUPABASE_URL is not a recognized Supabase environment');
  }
  const projectRef = hostname.slice(0, -'.supabase.co'.length);
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error('Stripe environment guard rejected: Supabase project ref is invalid');
  }
  return { projectRef, local: false };
}

export function assertStripeEnvironmentContract(input: StripeEnvironmentInput): StripeEnvironmentContract {
  const environment = normalizeEnvironment(input.picklaEnvironment);
  const stripeMode = stripeModeFromSecret(input.stripeSecretKey);
  const identity = projectIdentity(input.supabaseUrl);

  if (environment === 'production') {
    if (identity.projectRef !== PICKLA_PRODUCTION_PROJECT_REF) {
      throw new Error('Stripe environment guard rejected: production Supabase project identity mismatch');
    }
    if (stripeMode !== 'live') {
      throw new Error('Stripe environment guard rejected: production requires Stripe live mode');
    }
  } else if (environment === 'stage') {
    if (identity.projectRef !== PICKLA_STAGE_PROJECT_REF) {
      throw new Error('Stripe environment guard rejected: stage Supabase project identity mismatch');
    }
    if (stripeMode !== 'test') {
      throw new Error('Stripe environment guard rejected: stage requires Stripe test mode');
    }
  } else {
    if (!identity.local) {
      throw new Error('Stripe environment guard rejected: local environment requires a local Supabase URL');
    }
    if (stripeMode !== 'test') {
      throw new Error('Stripe environment guard rejected: local environment requires Stripe test mode');
    }
  }

  return { environment, projectRef: identity.projectRef, stripeMode };
}

export function assertStripeEventMode(
  contract: StripeEnvironmentContract,
  eventLiveMode: unknown,
) {
  if (typeof eventLiveMode !== 'boolean') {
    throw new Error('Stripe environment guard rejected: webhook event has no livemode identity');
  }
  const eventMode: StripeProviderMode = eventLiveMode ? 'live' : 'test';
  if (eventMode !== contract.stripeMode) {
    throw new Error('Stripe environment guard rejected: webhook event mode mismatch');
  }
}
