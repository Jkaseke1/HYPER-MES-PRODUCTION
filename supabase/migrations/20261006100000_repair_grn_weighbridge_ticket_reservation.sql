-- A partially completed GRN must never leave its weighbridge ticket available
-- for a second GRN. Repair old stale ticket statuses and keep them aligned.

UPDATE public.weigh_bridge_tickets AS ticket
SET status = CASE
  WHEN grn.status = 'approved' THEN 'linked'
  ELSE 'in_grn'
END,
updated_at = now()
FROM public.goods_received_notes AS grn
WHERE grn.weigh_bridge_ticket_id = ticket.id
  AND ticket.status = 'open';

CREATE OR REPLACE FUNCTION public.reserve_weighbridge_ticket_for_grn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.weigh_bridge_ticket_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.weigh_bridge_tickets
  SET status = CASE WHEN NEW.status = 'approved' THEN 'linked' ELSE 'in_grn' END,
      updated_at = now()
  WHERE id = NEW.weigh_bridge_ticket_id
    AND status = 'open';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reserve_weighbridge_ticket_for_grn ON public.goods_received_notes;
CREATE TRIGGER trg_reserve_weighbridge_ticket_for_grn
  AFTER INSERT OR UPDATE OF weigh_bridge_ticket_id, status ON public.goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION public.reserve_weighbridge_ticket_for_grn();

NOTIFY pgrst, 'reload schema';
