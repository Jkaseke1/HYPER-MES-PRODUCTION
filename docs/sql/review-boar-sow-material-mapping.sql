-- READ ONLY. Run in LIVE PlantControl Production Supabase SQL Editor.
-- Do not map two active material IDs onto one Sage code without checking
-- their stock and document usage. Do not delete or repost old documents.
WITH materials AS (
  SELECT * FROM public.raw_materials
  WHERE upper(btrim(code)) IN ('PIPBSM001', 'PIPBSM050')
     OR upper(btrim(sage_code)) IN ('PIPBSM001', 'PIPBSM050')
)
SELECT m.id, m.code, m.sage_code, m.name, m.unit, m.is_active,
  coalesce(nullif(btrim(m.sage_code), ''), btrim(m.code)) AS effective_sage_code,
  (SELECT count(*) FROM public.material_transfers t WHERE t.raw_material_id = m.id) AS transfer_lines,
  (SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'ist', t.purpose, 'number', t.transfer_number,
      'quantity', t.quantity, 'unit', t.unit, 'status', t.status,
      'date', t.transfer_date, 'reversed_at', t.reversed_at
    ) ORDER BY t.created_at)
   FROM public.material_transfers t WHERE t.raw_material_id = m.id) AS transfer_usage,
  (SELECT count(*) FROM public.stock_movements s WHERE s.raw_material_id = m.id) AS stock_movement_lines,
  (SELECT jsonb_agg(jsonb_build_object('warehouse_id', b.warehouse_id, 'quantity', b.quantity)
      ORDER BY b.warehouse_id)
   FROM public.warehouse_stock_balances b WHERE b.raw_material_id = m.id) AS warehouse_balances,
  (SELECT count(*) FROM public.grn_items g WHERE g.raw_material_id = m.id) AS grn_lines,
  (SELECT count(*) FROM public.formulation_ingredients i WHERE i.raw_material_id = m.id) AS bom_lines,
  (SELECT count(*) FROM public.formula_spec_lines i WHERE i.raw_material_id = m.id) AS formula_spec_lines,
  (SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'event_type', s.event_type, 'status', s.status,
      'message', s.message, 'error_details', s.error_details, 'sage_response', s.sage_response
    ) ORDER BY s.created_at)
   FROM public.sync_log s JOIN public.material_transfers t ON t.id = s.reference_id
   WHERE t.raw_material_id = m.id
     AND s.event_type = 'material_transfer_to_production') AS transfer_posting_history
FROM materials m ORDER BY m.code, m.id;
