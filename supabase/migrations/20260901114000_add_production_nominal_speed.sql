-- Production schema-only repair for the Production Orders and efficiency pages.
-- A default of zero means no production rate has been configured yet.
ALTER TABLE public.formulations
  ADD COLUMN IF NOT EXISTS nominal_speed numeric(10,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.formulations.nominal_speed IS
  'Theoretical maximum production rate in tonnes per hour (t/hr).';
