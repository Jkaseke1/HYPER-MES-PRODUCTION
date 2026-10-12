-- Formula-only changes. No existing recipes, orders or Sage transactions are rewritten.
BEGIN;

ALTER TABLE public.formulations DROP CONSTRAINT IF EXISTS formulations_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_formulations_code_version
  ON public.formulations(code, version);
ALTER TABLE public.formulations ADD COLUMN IF NOT EXISTS is_daily_active boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.save_formula_revision(p_source_id uuid, p_formula jsonb, p_bom jsonb)
RETURNS public.formulations
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  old_formula public.formulations;
  new_formula public.formulations;
  spec_id uuid;
  next_version integer;
  old_bom jsonb;
  mass_total numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_mes_role(ARRAY['admin','finance','accountant','finance_manager']) THEN
    RAISE EXCEPTION 'Only Finance can save formula revisions';
  END IF;
  IF nullif(trim(p_formula->>'code'), '') IS NULL OR nullif(trim(p_formula->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Formula name and code are required';
  END IF;
  IF (p_formula->>'batch_size')::numeric IS DISTINCT FROM 1000 OR (p_formula->>'batch_unit') IS DISTINCT FROM 'kg' THEN
    RAISE EXCEPTION 'Formula reference batch must be 1000 kg';
  END IF;
  IF jsonb_typeof(p_bom) IS DISTINCT FROM 'array' OR jsonb_array_length(p_bom) = 0 THEN
    RAISE EXCEPTION 'A formula needs BOM lines';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_bom) b
    LEFT JOIN public.raw_materials m ON m.id = (b->>'raw_material_id')::uuid
    WHERE m.id IS NULL OR coalesce((b->>'quantity')::numeric, 0) <= 0
      OR lower(b->>'quantity') IN ('nan','infinity','-infinity')
      OR ((coalesce(m.name,'') || ' ' || coalesce(m.category,'')) !~* 'packaging'
        AND coalesce(b->>'unit','') <> 'kg')) THEN
    RAISE EXCEPTION 'BOM requires valid materials, positive quantities and kg mass units';
  END IF;
  SELECT sum((b->>'quantity')::numeric) INTO mass_total
  FROM jsonb_array_elements(p_bom) b
  JOIN public.raw_materials m ON m.id = (b->>'raw_material_id')::uuid
  WHERE (coalesce(m.name,'') || ' ' || coalesce(m.category,'')) !~* 'packaging';
  IF mass_total IS NULL OR abs(mass_total - 1000) > 0.01 THEN
    RAISE EXCEPTION 'Formula ingredient mass must total 1000 kg (packaging excluded)';
  END IF;

  -- Serialize version allocation for this product, including concurrent editors.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_formula->>'code', 0));
  IF p_source_id IS NOT NULL THEN
    SELECT * INTO STRICT old_formula FROM public.formulations WHERE id = p_source_id FOR UPDATE;
    IF old_formula.code <> p_formula->>'code' THEN
      RAISE EXCEPTION 'Keep the existing product code when saving a revision';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'raw_material_id', raw_material_id, 'quantity', quantity, 'unit', unit,
      'percentage', percentage, 'is_critical', is_critical, 'notes', coalesce(notes,''), 'sort_order', sort_order
    ) ORDER BY sort_order, id), '[]'::jsonb) INTO old_bom
    FROM public.formulation_ingredients WHERE formulation_id = p_source_id AND is_active IS NOT FALSE;
    IF old_bom = p_bom AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_formula) kv
      WHERE kv.key NOT IN ('version','updated_at','status')
        AND (to_jsonb(old_formula)->kv.key) IS DISTINCT FROM kv.value
    ) THEN
      RETURN old_formula;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.formulations WHERE code = p_formula->>'code') THEN
    RAISE EXCEPTION 'Open an existing formula to save a new revision for this code';
  END IF;
  SELECT coalesce(max(version),0) + 1 INTO next_version
  FROM public.formulations WHERE code = p_formula->>'code';
  INSERT INTO public.formulations (
    name, code, sage_code, version, category, description, batch_size, batch_unit,
    unit_size_variants, target_protein, target_fat, target_fiber, target_moisture,
    estimated_cost_per_unit, status, created_by, approved_by, is_daily_active
  ) VALUES (
    p_formula->>'name', p_formula->>'code', p_formula->>'sage_code', next_version,
    p_formula->>'category', p_formula->>'description', 1000, 'kg',
    nullif(p_formula->'unit_size_variants','null'::jsonb),
    coalesce((p_formula->>'target_protein')::numeric,0), coalesce((p_formula->>'target_fat')::numeric,0),
    coalesce((p_formula->>'target_fiber')::numeric,0), coalesce((p_formula->>'target_moisture')::numeric,0),
    coalesce((p_formula->>'estimated_cost_per_unit')::numeric,0), 'draft', auth.uid(), NULL, false
  ) RETURNING * INTO new_formula;
  INSERT INTO public.formula_specs(formulation_id, reference_batch_size, batch_unit, status, generated_bom_at, created_by)
    VALUES(new_formula.id,1000,'kg','generated',now(),auth.uid()) RETURNING id INTO spec_id;
  INSERT INTO public.formulation_ingredients(formulation_id,raw_material_id,quantity,unit,percentage,is_critical,notes,sort_order,is_active)
    SELECT new_formula.id,(b->>'raw_material_id')::uuid,(b->>'quantity')::numeric,b->>'unit',
      (b->>'percentage')::numeric,coalesce((b->>'is_critical')::boolean,false),coalesce(b->>'notes',''),
      (b->>'sort_order')::integer,true FROM jsonb_array_elements(p_bom) b;
  INSERT INTO public.formula_spec_lines(formula_spec_id,raw_material_id,quantity,unit,notes,sort_order)
    SELECT spec_id,(b->>'raw_material_id')::uuid,(b->>'quantity')::numeric,'kg',coalesce(b->>'notes',''),
      (b->>'sort_order')::integer FROM jsonb_array_elements(p_bom) b
      JOIN public.raw_materials m ON m.id = (b->>'raw_material_id')::uuid
      WHERE (coalesce(m.name,'') || ' ' || coalesce(m.category,'')) !~* 'packaging';
  RETURN new_formula;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_formula_revision(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE f public.formulations; mass_total numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_mes_role(ARRAY['admin','finance','accountant','finance_manager']) THEN
    RAISE EXCEPTION 'Only Finance can activate formulas';
  END IF;
  SELECT * INTO STRICT f FROM public.formulations WHERE id = p_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(f.code,0));
  SELECT * INTO STRICT f FROM public.formulations WHERE id = p_id FOR UPDATE;
  IF f.status = 'archived' OR f.batch_size <> 1000 OR f.batch_unit <> 'kg' THEN
    RAISE EXCEPTION 'Activation requires a non-archived 1000 kg formula';
  END IF;
  IF EXISTS (SELECT 1 FROM public.formulations WHERE code = f.code AND version > f.version) THEN
    RAISE EXCEPTION 'Activate the latest formula version';
  END IF;
  IF EXISTS (SELECT 1 FROM public.formulation_ingredients i JOIN public.raw_materials m ON m.id=i.raw_material_id
    WHERE i.formulation_id=p_id AND i.is_active IS NOT FALSE
    AND (i.quantity <= 0 OR ((coalesce(m.name,'') || ' ' || coalesce(m.category,'')) !~* 'packaging' AND i.unit IS DISTINCT FROM 'kg'))) THEN
    RAISE EXCEPTION 'Invalid ingredient quantity or mass unit';
  END IF;
  SELECT sum(i.quantity) INTO mass_total FROM public.formulation_ingredients i
    JOIN public.raw_materials m ON m.id=i.raw_material_id
    WHERE i.formulation_id=p_id AND i.is_active IS NOT FALSE
      AND (coalesce(m.name,'') || ' ' || coalesce(m.category,'')) !~* 'packaging';
  IF mass_total IS NULL OR abs(mass_total-1000)>0.01 THEN
    RAISE EXCEPTION 'Ingredient mass is % kg; required 1000 kg. Packaging is excluded.', mass_total;
  END IF;
  UPDATE public.formulations SET is_daily_active=false WHERE code=f.code AND id<>p_id AND is_daily_active;
  UPDATE public.formulations SET status='active',approved_by=auth.uid(),is_daily_active=true,updated_at=now() WHERE id=p_id;
  UPDATE public.formula_specs SET status='approved',updated_at=now() WHERE formulation_id=p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_formula_revision(uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_formula_revision(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_formula_revision(uuid,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_formula_revision(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
