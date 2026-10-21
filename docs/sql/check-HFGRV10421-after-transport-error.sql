-- Read-only. Run in LIVE nxlhgpqtmgixhazihapz before attempting another creation.
SELECT g.id, g.grn_number, g.manual_grv_number, g.status,
  (SELECT count(*) FROM public.grn_items i WHERE i.grn_id=g.id) AS saved_product_lines,
  w.ticket_no, w.inbound_transport_mode,
  c.id AS transport_claim_id, c.status AS transport_status, c.calculated_amount AS transport_total,
  (SELECT count(*) FROM public.sync_log s WHERE s.reference_id=g.id AND s.event_type='grn_confirmed') AS sage_queue_events
FROM public.goods_received_notes g
LEFT JOIN public.weigh_bridge_tickets w ON w.id=g.weigh_bridge_ticket_id
LEFT JOIN public.inbound_transport_claims c ON c.grn_id=g.id
WHERE g.manual_grv_number='HFGRV10421' ORDER BY g.created_at;

SELECT pg_get_functiondef(to_regprocedure('public.guard_inbound_transport_claim_admin()')) AS claim_guard_definition;
