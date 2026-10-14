-- Keep bridge eligibility aligned with the GRN picker for recycled feed/food.
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
          AND lower(coalesce(m.category, '') || ' ' || m.name) !~ 'finished[ _-]?(goods|feeds?|products?)|\mfeeds\M|\m(pig|broiler|layer|poultry|beef|cattle|rabbit|dog|horse|goat|sheep)\M.*\m(feed|food|meal|pellets?|crumbles?|concentrate|mash|starter|grower|finisher)\M')
      )
  );
$$;
REVOKE ALL ON FUNCTION public.grn_input_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grn_input_allowed(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
