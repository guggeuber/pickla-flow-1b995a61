-- Active venue check-ins should be idempotent. A booking code or desk scan can
-- be retried safely without inflating live counts or creating duplicate rows.

WITH ranked_entitlements AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY venue_id, session_date, entry_type, entitlement_id
      ORDER BY checked_in_at ASC, created_at ASC, id ASC
    ) AS rn
  FROM public.venue_checkins
  WHERE entitlement_id IS NOT NULL
    AND checked_out_at IS NULL
)
DELETE FROM public.venue_checkins vc
USING ranked_entitlements r
WHERE vc.id = r.id
  AND r.rn > 1;

WITH ranked_users AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY venue_id, session_date, entry_type, user_id
      ORDER BY checked_in_at ASC, created_at ASC, id ASC
    ) AS rn
  FROM public.venue_checkins
  WHERE entitlement_id IS NULL
    AND user_id IS NOT NULL
    AND checked_out_at IS NULL
)
DELETE FROM public.venue_checkins vc
USING ranked_users r
WHERE vc.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_checkins_active_entitlement_once
  ON public.venue_checkins (venue_id, session_date, entry_type, entitlement_id)
  WHERE entitlement_id IS NOT NULL
    AND checked_out_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_checkins_active_user_entry_once
  ON public.venue_checkins (venue_id, session_date, entry_type, user_id)
  WHERE entitlement_id IS NULL
    AND user_id IS NOT NULL
    AND checked_out_at IS NULL;

