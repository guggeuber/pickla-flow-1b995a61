import { getServiceClient } from './auth.ts';

type SupabaseAdmin = ReturnType<typeof getServiceClient>;

export const LEGACY_CANCELLATION_COPY = {
  sv: {
    title: 'Legacy policy',
    summary: 'Köpt före Policy V1. Policyuppgifter saknas; endast den bevarade legacy-konsekvensen visas.',
    late: 'Inga nya Policy V1-villkor tillämpas retroaktivt.',
    boundary: 'Kontakta Pickla om de historiska villkoren behöver granskas.',
  },
  en: {
    title: 'Legacy policy',
    summary: 'Purchased before Policy V1. Policy details are unavailable; only the preserved legacy consequence is shown.',
    late: 'No new Policy V1 terms are applied retroactively.',
    boundary: 'Contact Pickla if the historical terms need review.',
  },
} as const;

export async function legacyCancellationProjection(
  admin: SupabaseAdmin,
  input: {
    venueId: string;
    authorityKey: string;
    policyFamily: string;
    purchaseAt: string | null | undefined;
  },
) {
  const { data: cutover, error } = await admin.from('cancellation_policy_cutovers')
    .select('authority_key,policy_family,preset_key,schema_version,enabled_at')
    .eq('venue_id', input.venueId)
    .eq('authority_key', input.authorityKey)
    .eq('policy_family', input.policyFamily)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!cutover) throw new Error(`cancellation_policy_family_not_enabled:${input.authorityKey}`);
  if (!input.purchaseAt || new Date(input.purchaseAt).getTime() >= new Date(cutover.enabled_at).getTime()) {
    throw new Error(`cancellation_policy_snapshot_required_after_cutover:${input.authorityKey}`);
  }
  return {
    policy_mode: 'legacy',
    snapshot_id: null,
    authority_key: input.authorityKey,
    policy_family: input.policyFamily,
    policy_key: 'legacy-preserved',
    policy_version: null,
    provenance: 'pre_cutover_runtime',
    legacy_policy_details_available: false,
    purchase_at: input.purchaseAt,
    cutover_at: cutover.enabled_at,
    copy_sv: LEGACY_CANCELLATION_COPY.sv,
    copy_en: LEGACY_CANCELLATION_COPY.en,
    source: 'legacy_pre_cutover',
  };
}
