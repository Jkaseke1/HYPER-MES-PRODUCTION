-- Add only the metadata column used by the formula editor. Existing formula,
-- BOM, material, stock and Sage transaction data are not modified.
BEGIN;
ALTER TABLE public.formulations
  ADD COLUMN IF NOT EXISTS unit_size_variants jsonb;
NOTIFY pgrst, 'reload schema';
COMMIT;
