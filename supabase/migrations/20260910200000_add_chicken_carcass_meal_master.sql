-- Add the Sage material master so live Sage stock sync can surface it in PlantControl.
-- This intentionally does not create an opening ledger movement; Sage remains the
-- authoritative source for the live RM balance.

INSERT INTO public.raw_materials (
  name, code, category, unit, current_stock, reorder_level, warehouse_id,
  description, is_active
)
SELECT
  'Chicken Carcass Meal',
  'CCM0001',
  'protein',
  'kg',
  0,
  0,
  w.id,
  'Sage RM item CCM0001; live stock supplied by Sage warehouse 18.',
  true
FROM public.warehouses w
WHERE upper(w.code) = 'RM'
  AND w.is_active
LIMIT 1
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    category = EXCLUDED.category,
    unit = EXCLUDED.unit,
    warehouse_id = COALESCE(raw_materials.warehouse_id, EXCLUDED.warehouse_id),
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();
