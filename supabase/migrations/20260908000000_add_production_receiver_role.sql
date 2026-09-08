-- Production receiving-only role. Apply this migration to the production Supabase project.

DO $$
DECLARE
  profile_role_constraint text;
BEGIN
  SELECT conname INTO profile_role_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.profiles'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%production_manager%'
  LIMIT 1;

  IF profile_role_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', profile_role_constraint);
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN (
    'admin', 'md', 'production_manager', 'supervisor', 'operator',
    'warehouse_manager', 'raw_material_manager', 'rm_manager', 'finance',
    'accountant', 'logistics', 'weighbridge', 'weigh_bridge', 'procurement',
    'quality_controller', 'maintenance_tech', 'chick_manager', 'driver',
    'branch_manager', 'production_receiver', 'viewer'
  ));

INSERT INTO public.roles (code, name, description, is_system, is_active)
VALUES ('production_receiver', 'Production Material Receiver',
        'May receive approved material transfers into Production Warehouse only',
        true, true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();

INSERT INTO public.permissions (code, name, description, module)
VALUES ('warehouse.receive', 'Receive Material Transfers',
        'Accept material transfers into Production Warehouse', 'warehouse')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN ('dashboard.view', 'warehouse.view', 'warehouse.receive')
WHERE r.code = 'production_receiver'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_material_transfer_request_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> NEW.requested_by THEN
    RAISE EXCEPTION 'Authenticated user must request the transfer';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'production_manager', 'supervisor',
                   'warehouse_manager', 'raw_material_manager', 'rm_manager', 'logistics')
  ) THEN
    RAISE EXCEPTION 'This role cannot create material transfers';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_material_transfer_request_role ON public.material_transfers;
CREATE TRIGGER trg_enforce_material_transfer_request_role
BEFORE INSERT ON public.material_transfers
FOR EACH ROW EXECUTE FUNCTION public.enforce_material_transfer_request_role();

CREATE OR REPLACE FUNCTION public.approve_material_transfer_to_production(
  p_transfer_id uuid, p_approved_by uuid
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer record;
  v_buffer_balance numeric;
  v_production_warehouse_id uuid;
  v_existing_production_movement boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_approved_by THEN
    RAISE EXCEPTION 'Authenticated user must approve the receipt';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'production_manager', 'supervisor',
                   'logistics', 'finance', 'accountant', 'production_receiver')
  ) THEN
    RAISE EXCEPTION 'This role cannot receive material transfers into Production';
  END IF;

  SELECT * INTO v_transfer FROM public.material_transfers
  WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found: %', p_transfer_id; END IF;
  IF v_transfer.status = 'received' THEN RETURN 'already_received'; END IF;
  IF v_transfer.status <> 'in_buffer' THEN
    RAISE EXCEPTION 'Transfer must be in in_buffer status. Current status: %', v_transfer.status;
  END IF;

  SELECT id INTO v_production_warehouse_id FROM public.warehouses
  WHERE code = 'PRODUCTION' LIMIT 1;
  IF v_production_warehouse_id IS NULL THEN RAISE EXCEPTION 'Production Warehouse not found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE reference_type = 'material_transfer'
      AND reference_id = p_transfer_id
      AND movement_type = 'production_input'
      AND quantity = v_transfer.quantity
      AND raw_material_id = v_transfer.raw_material_id
  ) INTO v_existing_production_movement;

  IF v_existing_production_movement THEN
    UPDATE public.material_transfers
    SET status = 'received', production_approved_by = p_approved_by,
        production_approved_at = now(), approved_by = p_approved_by,
        approved_at = now(), updated_at = now()
    WHERE id = p_transfer_id;
    RETURN 'recovered_existing_posting';
  END IF;

  SELECT COALESCE(quantity, 0) INTO v_buffer_balance
  FROM public.warehouse_stock_balances
  WHERE raw_material_id = v_transfer.raw_material_id
    AND warehouse_id = v_transfer.buffer_warehouse_id FOR UPDATE;
  IF COALESCE(v_buffer_balance, 0) < v_transfer.quantity THEN
    RAISE EXCEPTION 'Insufficient stock in Buffer Warehouse. Available: %, Required: %',
      COALESCE(v_buffer_balance, 0), v_transfer.quantity;
  END IF;

  PERFORM public.update_warehouse_balance(v_transfer.raw_material_id,
                                           v_transfer.buffer_warehouse_id,
                                           -v_transfer.quantity);
  PERFORM public.update_warehouse_balance(v_transfer.raw_material_id,
                                           v_production_warehouse_id,
                                           v_transfer.quantity);

  INSERT INTO public.stock_movements (
    raw_material_id, movement_type, quantity, warehouse_id,
    reference_type, reference_id, notes, performed_by
  ) VALUES (
    v_transfer.raw_material_id, 'production_input', v_transfer.quantity,
    v_production_warehouse_id, 'material_transfer', p_transfer_id,
    'Step 2: Transfer from Buffer to Production Floor', p_approved_by
  );

  UPDATE public.material_transfers
  SET status = 'received', production_approved_by = p_approved_by,
      production_approved_at = now(), approved_by = p_approved_by,
      approved_at = now(), updated_at = now()
  WHERE id = p_transfer_id;

  BEGIN
    PERFORM public.log_approval_action(
      'material_transfer', p_transfer_id, 'production_approved',
      'in_buffer', 'received', p_approved_by,
      'Accepted to Production Floor'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN 'processed';
END;
$$;
