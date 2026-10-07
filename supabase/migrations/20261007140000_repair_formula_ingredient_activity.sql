-- The LIVE formula page uses this flag to count and total active BOM rows.
-- Existing Sage-imported and manually maintained ingredients remain active.
ALTER TABLE public.formulation_ingredients
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.formulation_ingredients
SET is_active = true
WHERE is_active IS DISTINCT FROM true;

NOTIFY pgrst, 'reload schema';
