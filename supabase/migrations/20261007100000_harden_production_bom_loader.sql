-- Keep the LIVE production BOM loader authoritative and duplicate-safe.
-- Multiple formulation lines for the same raw material are combined into one
-- production-order material line.

CREATE OR REPLACE FUNCTION public.auto_load_bom_ingredients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.formulation_id IS NOT NULL THEN
    INSERT INTO public.production_order_materials (
      production_order_id,
      raw_material_id,
      planned_qty,
      actual_qty,
      unit,
      issued,
      issued_at,
      created_at
    )
    SELECT
      NEW.id,
      fi.raw_material_id,
      (
        SUM(
          COALESCE(
            NULLIF(fi.percentage, 0),
            CASE
              WHEN f.batch_size IS NULL OR f.batch_size = 0 THEN 0
              ELSE (fi.quantity / f.batch_size) * 100
            END
          )
        ) / 100.0
      ) * NEW.planned_qty,
      NULL,
      COALESCE(MIN(NULLIF(fi.unit, '')), 'kg'),
      false,
      NULL,
      now()
    FROM public.formulation_ingredients fi
    JOIN public.formulations f
      ON f.id = fi.formulation_id
    WHERE fi.formulation_id = NEW.formulation_id
      AND fi.raw_material_id IS NOT NULL
    GROUP BY fi.raw_material_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_production_order_bom
ON public.production_orders;

DROP TRIGGER IF EXISTS on_production_order_created
ON public.production_orders;

CREATE TRIGGER on_production_order_created
AFTER INSERT ON public.production_orders
FOR EACH ROW
EXECUTE FUNCTION public.auto_load_bom_ingredients();
