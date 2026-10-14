-- Validate new/edited GRN lines and approval. Historical postings are unchanged.
CREATE OR REPLACE FUNCTION public.grn_input_allowed(p_material_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.raw_materials m
    WHERE m.id = p_material_id AND m.is_active
      AND NOT EXISTS (
        SELECT 1 FROM public.formulations f
        WHERE upper(btrim(f.code)) = upper(btrim(m.code))
           OR upper(nullif(btrim(f.sage_code), '')) = upper(coalesce(nullif(btrim(m.sage_code), ''), btrim(m.code)))
           OR upper(btrim(f.code)) = upper(nullif(btrim(m.sage_code), ''))
           OR upper(nullif(btrim(f.sage_code), '')) = upper(btrim(m.code))
      )
      AND (
        lower(coalesce(m.category, '') || ' ' || m.name) ~ 'packaging|premix|pre-mix'
        OR (lower(coalesce(m.category, '')) NOT IN ('feed', 'feeds', 'finished_goods', 'finished goods')
          AND lower(coalesce(m.category, '') || ' ' || m.name) !~ 'finished[ _-]?(goods|feeds?|products?)|\mfeeds\M|\m(pig|broiler|layer|poultry|beef|cattle|rabbit|dog|horse|goat|sheep)\M.*\m(meal|pellets?|crumbles?|concentrate|mash|starter|grower|finisher)\M')
      )
  );
$$;
REVOKE ALL ON FUNCTION public.grn_input_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grn_input_allowed(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_grn_input_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.grn_input_allowed(NEW.raw_material_id) THEN
    RAISE EXCEPTION 'Finished feeds or inactive items cannot be selected for an RM GRN.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_grn_input_item
BEFORE INSERT OR UPDATE OF raw_material_id ON public.grn_items
FOR EACH ROW EXECUTE FUNCTION public.guard_grn_input_item();

CREATE OR REPLACE FUNCTION public.guard_grn_input_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND EXISTS (
    SELECT 1 FROM public.grn_items i
    WHERE i.grn_id = NEW.id AND NOT public.grn_input_allowed(i.raw_material_id)
  ) THEN
    RAISE EXCEPTION 'GRN approval blocked: a line contains a finished feed or inactive item.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_grn_input_approval
BEFORE UPDATE OF status ON public.goods_received_notes
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.guard_grn_input_approval();

NOTIFY pgrst, 'reload schema';
