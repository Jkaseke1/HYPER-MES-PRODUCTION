BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.material_transfer_requests
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.material_transfer_requests TO authenticated;

REVOKE EXECUTE ON FUNCTION public.save_material_transfer_request(uuid, jsonb, uuid, date, text, text, uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_material_transfer_request_check(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_material_transfer_request_failure(uuid, text)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_material_transfer_request(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_material_transfer_request(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_material_transfer_request(uuid, jsonb, uuid, date, text, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_material_transfer_request_check(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_material_transfer_request_failure(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_material_transfer_request(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_material_transfer_request(uuid)
  TO authenticated;

COMMIT;
