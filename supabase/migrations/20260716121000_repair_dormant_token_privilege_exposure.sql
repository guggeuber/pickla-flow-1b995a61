-- Repair B: keep invite/token validation and corporate role assignment server-side.

DROP POLICY IF EXISTS "Anon read by invite token" ON public.corporate_accounts;
DROP POLICY IF EXISTS "Public read by token" ON public.day_pass_shares;
DROP POLICY IF EXISTS "Members can join via invite" ON public.corporate_members;

-- api-corporate validates account invite tokens and assigns roles with service access.
-- api-day-passes validates share tokens and claim ownership with service access.
