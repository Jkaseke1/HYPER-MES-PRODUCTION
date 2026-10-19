-- READ ONLY. Run in LIVE PlantControl Production Supabase SQL Editor.
-- Non-unit label is an exception to investigate, NOT proof of wrong Sage quantity.
-- Excludes macro/maxipacks unless explicitly described as packaging.
-- Includes reversed records for visibility; never automatically replay them.
WITH exceptions AS (
  SELECT t.*, m.code, m.name, m.sage_code, m.unit AS catalogue_unit
  FROM public.material_transfers t
  JOIN public.raw_materials m ON m.id = t.raw_material_id
  WHERE t.status = 'received'
    AND lower(btrim(coalesce(t.unit, ''))) NOT IN ('unit', 'units')
    AND concat_ws(' ', m.name, m.description) ~* '(packaging|packadging)'
)
SELECT e.id, e.purpose AS ist, e.transfer_number,
  e.code, coalesce(nullif(btrim(e.sage_code), ''), e.code) AS current_sage_code,
  e.name, e.quantity, e.unit AS saved_unit, e.catalogue_unit,
  e.transfer_date, e.status, e.reversed_at, e.reversed_by,
  (SELECT jsonb_agg(jsonb_build_object(
    'id', s.id, 'movement_type', s.movement_type, 'warehouse_id', s.warehouse_id,
    'quantity', s.quantity, 'unit', s.unit
  ) ORDER BY s.created_at) FROM public.stock_movements s
    WHERE s.reference_id = e.id AND s.raw_material_id = e.raw_material_id) AS movement_records,
  (SELECT jsonb_agg(jsonb_build_object(
    'id', s.id, 'status', s.status, 'queued_at', s.created_at,
    'updated_at', s.updated_at, 'message', s.message,
    'details', s.details, 'sage_response', s.sage_response, 'error_details', s.error_details
  ) ORDER BY s.created_at) FROM public.sync_log s
    WHERE s.reference_id = e.id AND s.event_type = 'material_transfer_to_production') AS posting_history,
  count(*) OVER () AS exception_lines
FROM exceptions e ORDER BY e.transfer_date, e.purpose, e.transfer_number;
