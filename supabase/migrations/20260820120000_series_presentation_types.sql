-- Series is the general engine. Format presentation controls customer language
-- and discovery only; it must never redefine commercial or operational truth.

ALTER TABLE public.activity_formats
  ADD COLUMN IF NOT EXISTS presentation_type TEXT NOT NULL DEFAULT 'course';

ALTER TABLE public.activity_formats
  DROP CONSTRAINT IF EXISTS activity_formats_presentation_type_check,
  ADD CONSTRAINT activity_formats_presentation_type_check CHECK (
    presentation_type IN ('course', 'social_event', 'clinic', 'tournament')
  );

CREATE INDEX IF NOT EXISTS idx_activity_formats_presentation
  ON public.activity_formats (organization_id, presentation_type)
  WHERE is_active = true;

COMMENT ON COLUMN public.activity_formats.presentation_type IS
  'Customer presentation only: label, copy, metadata visibility, image prominence and discovery filtering. Never pricing, checkout, capacity, entitlement, commitment, attendance, resources, staffing or cancellation behavior.';
