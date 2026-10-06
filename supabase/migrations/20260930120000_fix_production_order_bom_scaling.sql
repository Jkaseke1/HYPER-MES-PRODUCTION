-- Correct production-order BOM scaling.
-- Formula BOM quantities are stored against the formulation's reference batch
-- and percentages are the source of truth when scaling to a production order.
-- Example: a 25% ingredient in a 1,000 kg order receives 250 kg.

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
      issued,
      issued_at,
      created_at
    )
    SELECT
      NEW.id,
      fi.raw_material_id,
      (
        COALESCE(
          NULLIF(fi.percentage, 0),
          (fi.quantity / NULLIF(f.batch_size, 0)) * 100
        ) / 100.0
      ) * NEW.planned_qty,
      NULL,
      false,
      NULL,
      now()
    FROM public.formulation_ingredients fi
    JOIN public.formulations f
      ON f.id = fi.formulation_id
    WHERE fi.formulation_id = NEW.formulation_id
      AND fi.raw_material_id IS NOT NULL;

    RAISE NOTICE
      'Auto-loaded % ingredients for production order % using percentage scaling',
      (
        SELECT count(*)
        FROM public.formulation_ingredients
        WHERE formulation_id = NEW.formulation_id
          AND raw_material_id IS NOT NULL
      ),
      NEW.batch_number;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_production_order_created
ON public.production_orders;

CREATE TRIGGER on_production_order_created
AFTER INSERT ON public.production_orders
FOR EACH ROW
EXECUTE FUNCTION public.auto_load_bom_ingredients();
