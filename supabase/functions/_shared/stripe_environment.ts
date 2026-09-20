import {
  assertStripeEnvironmentContract,
  type StripeEnvironmentContract,
} from './stripe_environment_contract.ts';

export type StripeRuntimeEnvironment = StripeEnvironmentContract & { stripeKey: string };

export function requireStripeRuntimeEnvironment(
  stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '',
): StripeRuntimeEnvironment {
  if (!stripeSecretKey) throw new Error('Stripe not configured');
  const contract = assertStripeEnvironmentContract({
    picklaEnvironment: Deno.env.get('PICKLA_ENVIRONMENT'),
    supabaseUrl: Deno.env.get('SUPABASE_URL'),
    stripeSecretKey,
  });
  return { ...contract, stripeKey: stripeSecretKey };
}

export function optionalStripeRuntimeEnvironment(): StripeRuntimeEnvironment | null {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
  return stripeSecretKey ? requireStripeRuntimeEnvironment(stripeSecretKey) : null;
}
