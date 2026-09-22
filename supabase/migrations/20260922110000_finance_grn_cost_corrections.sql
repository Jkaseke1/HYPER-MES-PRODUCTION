-- Apply in live Supabase to enable the Finance unit-cost editor.
BEGIN;

CREATE TABLE IF NOT EXISTS public.grn_unit_cost_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES public.goods_received_notes(id),
  changed_by uuid NOT NULL REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changes jsonb NOT NULL
);
ALTER TABLE public.grn_unit_cost_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grn_unit_cost_audit FROM anon, authenticated;
GRANT SELECT ON public.grn_unit_cost_audit TO authenticated;
DROP POLICY IF EXISTS "Finance can read GRN cost audit" ON public.grn_unit_cost_audit;
CREATE POLICY "Finance can read GRN cost audit"
  ON public.grn_unit_cost_audit FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'finance', 'accountant']));

CREATE OR REPLACE FUNCTION public.save_grn_finance_unit_costs(p_grn_id uuid, p_lines jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_count integer;
  v_changes jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin can correct unit costs.';
  END IF;

  -- Use the same parent lock as GRN approval to serialize saving and approval.
  SELECT status INTO v_status FROM public.goods_received_notes WHERE id = p_grn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found.'; END IF;
  IF v_status NOT IN ('pending', 'pending_costing', 'pending_finance') THEN
    RAISE EXCEPTION 'Only unapproved GRNs can have unit costs corrected.';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Supply the GRN unit-cost lines.';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'No lines supplied.'; END IF;

  PERFORM id FROM public.grn_items WHERE grn_id = p_grn_id FOR UPDATE;
  SELECT count(*) INTO v_count FROM public.grn_items WHERE grn_id = p_grn_id;
  IF v_count <> jsonb_array_length(p_lines) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(id uuid, unit_cost numeric)
    LEFT JOIN public.grn_items gi ON gi.id = x.id AND gi.grn_id = p_grn_id
    WHERE gi.id IS NULL OR x.unit_cost IS NULL OR x.unit_cost <= 0
       OR x.unit_cost::text IN ('NaN', 'Infinity', '-Infinity')
  ) OR (SELECT count(DISTINCT x.id) FROM jsonb_to_recordset(p_lines) AS x(id uuid)) <> v_count THEN
    RAISE EXCEPTION 'Each GRN line must appear once with a positive unit cost. Reopen the GRN and try again.';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('line_id', gi.id, 'old_cost', gi.unit_cost, 'new_cost', x.unit_cost))
  INTO v_changes
  FROM public.grn_items gi
  JOIN jsonb_to_recordset(p_lines) AS x(id uuid, unit_cost numeric) ON x.id = gi.id
  WHERE gi.grn_id = p_grn_id AND gi.unit_cost IS DISTINCT FROM x.unit_cost;

  IF v_changes IS NOT NULL THEN
    UPDATE public.grn_items gi SET unit_cost = x.unit_cost
    FROM jsonb_to_recordset(p_lines) AS x(id uuid, unit_cost numeric)
    WHERE gi.id = x.id AND gi.grn_id = p_grn_id;
    INSERT INTO public.grn_unit_cost_audit(grn_id, changed_by, changes)
    VALUES (p_grn_id, auth.uid(), v_changes);
    UPDATE public.goods_received_notes SET updated_at = now() WHERE id = p_grn_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.save_grn_finance_unit_costs(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_grn_finance_unit_costs(uuid, jsonb) TO authenticated;

COMMIT;
