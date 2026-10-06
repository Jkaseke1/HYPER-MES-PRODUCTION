-- Keep the entered formula specification separate from the generated production BOM.
-- The existing formulation_ingredients table remains the production-facing BOM
-- consumed by production-order triggers.

CREATE TABLE IF NOT EXISTS public.formula_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulation_id uuid NOT NULL REFERENCES public.formulations(id) ON DELETE CASCADE,
  reference_batch_size numeric NOT NULL CHECK (reference_batch_size > 0),
  batch_unit text NOT NULL DEFAULT 'kg',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'approved', 'archived')),
  generated_bom_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT formula_specs_one_per_formulation UNIQUE (formulation_id)
);

CREATE TABLE IF NOT EXISTS public.formula_spec_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_spec_id uuid NOT NULL REFERENCES public.formula_specs(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'kg',
  notes text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.formula_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formula_spec_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read formula specs" ON public.formula_specs;
CREATE POLICY "Authenticated users can read formula specs"
  ON public.formula_specs FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can manage formula specs" ON public.formula_specs;
CREATE POLICY "Authenticated users can manage formula specs"
  ON public.formula_specs FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read formula spec lines" ON public.formula_spec_lines;
CREATE POLICY "Authenticated users can read formula spec lines"
  ON public.formula_spec_lines FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can manage formula spec lines" ON public.formula_spec_lines;
CREATE POLICY "Authenticated users can manage formula spec lines"
  ON public.formula_spec_lines FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_formula_spec_lines_spec
  ON public.formula_spec_lines (formula_spec_id, sort_order);

-- Backfill existing formula/BOM records into the new formula-input layer.
-- This is idempotent and does not alter existing production BOM rows.
INSERT INTO public.formula_specs (formulation_id, reference_batch_size, batch_unit, status, generated_bom_at, created_by)
SELECT f.id, f.batch_size, f.batch_unit,
       CASE WHEN EXISTS (
         SELECT 1 FROM public.formulation_ingredients fi
         WHERE fi.formulation_id = f.id AND COALESCE(fi.quantity, 0) > 0
       ) THEN 'generated' ELSE 'draft' END,
       CASE WHEN EXISTS (
         SELECT 1 FROM public.formulation_ingredients fi
         WHERE fi.formulation_id = f.id AND COALESCE(fi.quantity, 0) > 0
       ) THEN now() ELSE NULL END,
       f.created_by
FROM public.formulations f
ON CONFLICT (formulation_id) DO NOTHING;

INSERT INTO public.formula_spec_lines (formula_spec_id, raw_material_id, quantity, unit, notes, sort_order)
SELECT fs.id, fi.raw_material_id, fi.quantity, COALESCE(fi.unit, 'kg'), COALESCE(fi.notes, ''), fi.sort_order
FROM public.formula_specs fs
JOIN public.formulation_ingredients fi ON fi.formulation_id = fs.formulation_id
WHERE COALESCE(fi.quantity, 0) > 0
  AND fi.raw_material_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.formula_spec_lines fsl
    WHERE fsl.formula_spec_id = fs.id
  );
