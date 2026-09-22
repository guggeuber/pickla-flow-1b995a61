-- Read-only Policy V1 rollout report. Run with psql against the target
-- database before migration/release review. This function performs no writes.
BEGIN TRANSACTION READ ONLY;
SELECT jsonb_pretty(public.cancellation_policy_rollout_preflight(NULL));
COMMIT;
