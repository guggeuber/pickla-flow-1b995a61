import { describe, expect, it } from 'vitest';
import {
  assertStripeEnvironmentContract,
  assertStripeEventMode,
  PICKLA_PRODUCTION_PROJECT_REF,
  PICKLA_STAGE_PROJECT_REF,
} from '../../supabase/functions/_shared/stripe_environment_contract';

const productionUrl = `https://${PICKLA_PRODUCTION_PROJECT_REF}.supabase.co`;
const stageUrl = `https://${PICKLA_STAGE_PROJECT_REF}.supabase.co`;

describe('Stripe environment contract', () => {
  it('accepts only a live key on the explicit production project', () => {
    expect(assertStripeEnvironmentContract({
      picklaEnvironment: 'production',
      supabaseUrl: productionUrl,
      stripeSecretKey: 'sk_live_redacted',
    })).toEqual({
      environment: 'production',
      projectRef: PICKLA_PRODUCTION_PROJECT_REF,
      stripeMode: 'live',
    });
    expect(() => assertStripeEnvironmentContract({
      picklaEnvironment: 'production',
      supabaseUrl: productionUrl,
      stripeSecretKey: 'sk_test_redacted',
    })).toThrow('production requires Stripe live mode');
  });

  it('accepts only a test key on the explicit stage project', () => {
    expect(assertStripeEnvironmentContract({
      picklaEnvironment: 'stage',
      supabaseUrl: stageUrl,
      stripeSecretKey: 'sk_test_redacted',
    })).toEqual({
      environment: 'stage',
      projectRef: PICKLA_STAGE_PROJECT_REF,
      stripeMode: 'test',
    });
    expect(() => assertStripeEnvironmentContract({
      picklaEnvironment: 'stage',
      supabaseUrl: stageUrl,
      stripeSecretKey: 'sk_live_redacted',
    })).toThrow('stage requires Stripe test mode');
  });

  it('fails closed on missing identity, crossed project identity, and unknown key mode', () => {
    expect(() => assertStripeEnvironmentContract({
      supabaseUrl: stageUrl,
      stripeSecretKey: 'sk_test_redacted',
    })).toThrow('PICKLA_ENVIRONMENT');
    expect(() => assertStripeEnvironmentContract({
      picklaEnvironment: 'stage',
      supabaseUrl: productionUrl,
      stripeSecretKey: 'sk_test_redacted',
    })).toThrow('stage Supabase project identity mismatch');
    expect(() => assertStripeEnvironmentContract({
      picklaEnvironment: 'production',
      supabaseUrl: stageUrl,
      stripeSecretKey: 'sk_live_redacted',
    })).toThrow('production Supabase project identity mismatch');
    expect(() => assertStripeEnvironmentContract({
      picklaEnvironment: 'stage',
      supabaseUrl: stageUrl,
      stripeSecretKey: 'pk_test_redacted',
    })).toThrow('unsupported Stripe secret-key mode');
    expect(assertStripeEnvironmentContract({
      picklaEnvironment: 'stage',
      supabaseUrl: stageUrl,
      stripeSecretKey: 'rk_test_redacted',
    }).stripeMode).toBe('test');
  });

  it('allows local development only with a local Supabase URL and test key', () => {
    expect(assertStripeEnvironmentContract({
      picklaEnvironment: 'local',
      supabaseUrl: 'http://127.0.0.1:54321',
      stripeSecretKey: 'sk_test_redacted',
    }).stripeMode).toBe('test');
    expect(() => assertStripeEnvironmentContract({
      picklaEnvironment: 'local',
      supabaseUrl: stageUrl,
      stripeSecretKey: 'sk_test_redacted',
    })).toThrow('local environment requires a local Supabase URL');
  });

  it('rejects signed webhook events from the opposite provider mode', () => {
    const stage = assertStripeEnvironmentContract({
      picklaEnvironment: 'stage',
      supabaseUrl: stageUrl,
      stripeSecretKey: 'sk_test_redacted',
    });
    expect(() => assertStripeEventMode(stage, false)).not.toThrow();
    expect(() => assertStripeEventMode(stage, true)).toThrow('webhook event mode mismatch');
    expect(() => assertStripeEventMode(stage, undefined)).toThrow('no livemode identity');
  });
});
