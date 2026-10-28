-- Persist the best available USD unit-cost snapshot when a production order is
-- created. Registered RM prices are USD per tonne; material master prices are
-- converted from their native stock unit. Existing orders are not rewritten.

CREATE OR REPLACE FUNCTION public.auto_load_bom_ingredients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.formulation_id IS NOT NULL THEN
    WITH grouped_bom AS (
      SELECT
        fi.raw_material_id,
        COALESCE(MIN(NULLIF(fi.unit, '')), 'kg') AS unit,
        (
          SUM(COALESCE(
            NULLIF(fi.percentage, 0),
            CASE WHEN f.batch_size IS NULL OR f.batch_size = 0 THEN 0
              ELSE (fi.quantity / f.batch_size) * 100 END
          )) / 100.0
        ) * NEW.planned_qty AS planned_qty
      FROM public.formulation_ingredients fi
      JOIN public.formulations f ON f.id = fi.formulation_id
      WHERE fi.formulation_id = NEW.formulation_id
        AND fi.raw_material_id IS NOT NULL
      GROUP BY fi.raw_material_id
    )
    INSERT INTO public.production_order_materials (
      production_order_id,
      raw_material_id,
      planned_qty,
      actual_qty,
      unit,
      unit_cost,
      total_cost,
      issued,
      issued_at,
      created_at
    )
    SELECT
      NEW.id,
      bom.raw_material_id,
      bom.planned_qty,
      NULL,
      bom.unit,
      COALESCE(price.unit_cost, 0),
      bom.planned_qty * COALESCE(price.unit_cost, 0),
      false,
      NULL,
      now()
    FROM grouped_bom bom
    JOIN public.raw_materials rm ON rm.id = bom.raw_material_id
    LEFT JOIN LATERAL (
      SELECT r.cost_per_tonne_usd
      FROM public.rm_cost_register r
      WHERE r.raw_material_id = bom.raw_material_id
        AND r.cost_per_tonne_usd > 0
      ORDER BY r.effective_date DESC, r.created_at DESC
      LIMIT 1
    ) registered ON true
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN lower(COALESCE(rm.name, '') || ' ' || COALESCE(rm.category, '')) LIKE '%packaging%'
          THEN COALESCE(NULLIF(rm.cost_per_unit_usd, 0), NULLIF(rm.cost_per_unit, 0), 0)
        WHEN registered.cost_per_tonne_usd IS NOT NULL THEN
          registered.cost_per_tonne_usd * CASE lower(replace(trim(bom.unit), ' ', ''))
            WHEN 'kg' THEN 1 WHEN 'kgs' THEN 1 WHEN 'kilo' THEN 1 WHEN 'kilogram' THEN 1
            WHEN 'g' THEN 0.001 WHEN 'gm' THEN 0.001 WHEN 'gram' THEN 0.001
            WHEN 'mg' THEN 0.000001 WHEN 'milligram' THEN 0.000001
            WHEN 't' THEN 1000 WHEN 'tonne' THEN 1000 WHEN 'tonnes' THEN 1000
            ELSE 0 END / 1000.0
        ELSE
          COALESCE(NULLIF(rm.cost_per_unit_usd, 0), NULLIF(rm.cost_per_unit, 0), 0)
          * CASE lower(replace(trim(bom.unit), ' ', ''))
              WHEN 'kg' THEN 1 WHEN 'kgs' THEN 1 WHEN 'kilo' THEN 1 WHEN 'kilogram' THEN 1
              WHEN 'g' THEN 0.001 WHEN 'gm' THEN 0.001 WHEN 'gram' THEN 0.001
              WHEN 'mg' THEN 0.000001 WHEN 'milligram' THEN 0.000001
              WHEN 't' THEN 1000 WHEN 'tonne' THEN 1000 WHEN 'tonnes' THEN 1000
              ELSE 0 END
          / NULLIF(CASE lower(replace(trim(COALESCE(rm.unit, 'kg')), ' ', ''))
              WHEN 'kg' THEN 1 WHEN 'kgs' THEN 1 WHEN 'kilo' THEN 1 WHEN 'kilogram' THEN 1
              WHEN 'g' THEN 0.001 WHEN 'gm' THEN 0.001 WHEN 'gram' THEN 0.001
              WHEN 'mg' THEN 0.000001 WHEN 'milligram' THEN 0.000001
              WHEN 't' THEN 1000 WHEN 'tonne' THEN 1000 WHEN 'tonnes' THEN 1000
              ELSE 0 END, 0)
      END AS unit_cost
    ) price;
  END IF;

  RETURN NEW;
END;
$$;
