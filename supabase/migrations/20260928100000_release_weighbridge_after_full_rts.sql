-- A completed full RTS reverses the original receipt. Release its weighbridge
-- ticket so it can be selected for a replacement GRN, while retaining an
-- immutable record of the original GRN-to-ticket link.

CREATE TABLE IF NOT EXISTS public.grn_rts_weighbridge_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES public.goods_received_notes(id),
  weigh_bridge_ticket_id uuid NOT NULL REFERENCES public.weigh_bridge_tickets(id),
  rts_id uuid NOT NULL UNIQUE REFERENCES public.return_to_supplier_requests(id),
  rts_number text NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now(),
  release_reason text NOT NULL DEFAULT 'Full RTS posted to Sage; ticket released for replacement GRN.'
);

COMMENT ON TABLE public.grn_rts_weighbridge_releases IS
  'Audit trail for weighbridge tickets released after a full, Sage-posted RTS.';

ALTER TABLE public.grn_rts_weighbridge_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance can read RTS weighbridge releases"
  ON public.grn_rts_weighbridge_releases;

CREATE POLICY "Finance can read RTS weighbridge releases"
  ON public.grn_rts_weighbridge_releases
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'finance')
    )
  );

CREATE OR REPLACE FUNCTION public.release_weighbridge_ticket_for_full_rts(p_rts_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rts public.return_to_supplier_requests%ROWTYPE;
  v_grn public.goods_received_notes%ROWTYPE;
  v_ticket public.weigh_bridge_tickets%ROWTYPE;
  v_total_lines integer;
  v_fully_returned_lines integer;
BEGIN
  SELECT * INTO v_rts
  FROM public.return_to_supplier_requests
  WHERE id = p_rts_id
    AND status = 'posted'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = v_rts.original_grn_id
  FOR UPDATE;

  IF NOT FOUND OR v_grn.weigh_bridge_ticket_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_ticket
  FROM public.weigh_bridge_tickets
  WHERE id = v_grn.weigh_bridge_ticket_id
  FOR UPDATE;

  IF NOT FOUND OR v_ticket.status NOT IN ('open', 'in_grn', 'linked') THEN
    RETURN false;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE rts_item.id IS NOT NULL
        AND rts_item.quantity >= grn_item.received_qty
    )
  INTO v_total_lines, v_fully_returned_lines
  FROM public.grn_items grn_item
  LEFT JOIN public.return_to_supplier_items rts_item
    ON rts_item.grn_item_id = grn_item.id
   AND rts_item.rts_id = v_rts.id
  WHERE grn_item.grn_id = v_grn.id;

  -- A partial RTS must retain the source ticket because its original receipt
  -- has not been fully reversed.
  IF v_total_lines = 0 OR v_fully_returned_lines <> v_total_lines THEN
    RETURN false;
  END IF;

  UPDATE public.goods_received_notes
  SET weigh_bridge_ticket_id = NULL,
      updated_at = now()
  WHERE id = v_grn.id
    AND weigh_bridge_ticket_id = v_ticket.id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.weigh_bridge_tickets
  SET status = 'open',
      updated_at = now()
  WHERE id = v_ticket.id;

  INSERT INTO public.grn_rts_weighbridge_releases (
    grn_id,
    weigh_bridge_ticket_id,
    rts_id,
    rts_number
  ) VALUES (
    v_grn.id,
    v_ticket.id,
    v_rts.id,
    v_rts.rts_number
  )
  ON CONFLICT (rts_id) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.release_weighbridge_ticket_for_full_rts(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.release_weighbridge_ticket_after_rts_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.release_weighbridge_ticket_for_full_rts(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_weighbridge_ticket_after_rts_posted
  ON public.return_to_supplier_requests;

CREATE TRIGGER trg_release_weighbridge_ticket_after_rts_posted
AFTER UPDATE OF status ON public.return_to_supplier_requests
FOR EACH ROW
WHEN (NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted')
EXECUTE FUNCTION public.release_weighbridge_ticket_after_rts_posted();

-- Apply the same safe release rule to existing completed RTSs. The function
-- returns false for partial returns, cancelled tickets, or already-released
-- links, leaving those records unchanged.
DO $$
DECLARE
  v_rts_id uuid;
BEGIN
  FOR v_rts_id IN
    SELECT rts.id
    FROM public.return_to_supplier_requests rts
    JOIN public.goods_received_notes grn ON grn.id = rts.original_grn_id
    WHERE rts.status = 'posted'
      AND grn.weigh_bridge_ticket_id IS NOT NULL
  LOOP
    PERFORM public.release_weighbridge_ticket_for_full_rts(v_rts_id);
  END LOOP;
END;
$$;
