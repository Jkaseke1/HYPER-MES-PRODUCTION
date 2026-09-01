-- Production maintenance and fleet foundations.
-- Schema only: creates no vehicles, spare parts, schedules, work orders, or transactions.
-- Sage integration: none. This migration does not create sync events or posting triggers.

CREATE TABLE IF NOT EXISTS public.spare_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'other',
  unit text NOT NULL DEFAULT 'pcs',
  unit_cost numeric NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'USD',
  reorder_level numeric NOT NULL DEFAULT 0,
  current_stock numeric NOT NULL DEFAULT 0,
  warehouse_id uuid REFERENCES public.warehouses(id),
  supplier_id uuid REFERENCES public.suppliers(id),
  lead_time_days integer NOT NULL DEFAULT 7,
  is_critical boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_spares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_no integer,
  description text NOT NULL,
  machine text,
  category text,
  sub_group text,
  qty_on_hand numeric NOT NULL DEFAULT 0,
  min_stock numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'pcs',
  notes text,
  dimensions_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_code text UNIQUE NOT NULL,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  maintenance_type text NOT NULL DEFAULT 'preventive',
  frequency_type text NOT NULL DEFAULT 'monthly',
  frequency_value integer NOT NULL DEFAULT 1,
  estimated_duration_minutes integer NOT NULL DEFAULT 60,
  last_performed_date date,
  next_due_date date,
  assigned_to uuid REFERENCES public.profiles(id),
  priority text NOT NULL DEFAULT 'medium',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_number text UNIQUE NOT NULL,
  schedule_id uuid REFERENCES public.maintenance_schedules(id),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  work_type text NOT NULL DEFAULT 'corrective',
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  title text NOT NULL,
  description text,
  reported_by uuid REFERENCES public.profiles(id),
  assigned_to uuid REFERENCES public.profiles(id),
  scheduled_date date,
  started_at timestamptz,
  completed_at timestamptz,
  completed_date date,
  performed_by text,
  estimated_duration_minutes integer NOT NULL DEFAULT 60,
  actual_duration_minutes integer,
  downtime_minutes integer NOT NULL DEFAULT 0,
  production_impact_qty numeric NOT NULL DEFAULT 0,
  root_cause text,
  corrective_action text,
  labor_cost numeric NOT NULL DEFAULT 0,
  parts_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spare_id uuid NOT NULL REFERENCES public.maintenance_spares(id) ON DELETE CASCADE,
  transaction_type text NOT NULL,
  quantity numeric NOT NULL,
  reference text,
  performed_by text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.maintenance_work_orders(id) ON DELETE CASCADE,
  task_number integer NOT NULL,
  description text NOT NULL,
  is_completed boolean NOT NULL DEFAULT false,
  completed_by uuid REFERENCES public.profiles(id),
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, task_number)
);

CREATE TABLE IF NOT EXISTS public.spare_parts_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.maintenance_work_orders(id) ON DELETE CASCADE,
  spare_part_id uuid NOT NULL REFERENCES public.spare_parts(id),
  quantity_used numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  batch_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_number text UNIQUE NOT NULL,
  make_model text NOT NULL,
  vehicle_type text NOT NULL,
  ownership text NOT NULL DEFAULT 'owned',
  capacity_tons numeric NOT NULL DEFAULT 0,
  current_odometer_km numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'available',
  assigned_driver_name text,
  driver_phone text,
  fuel_tank_capacity_l numeric,
  avg_fuel_consumption_kml numeric,
  service_interval_km numeric,
  last_service_odometer_km numeric,
  last_service_date date,
  next_service_due_km numeric,
  license_expiry_date date,
  insurance_expiry_date date,
  transporter_vendor_name text,
  hire_rate_per_ton numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fleet_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_number text UNIQUE NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES public.fleet_vehicles(id),
  driver_name text NOT NULL,
  driver_phone text,
  allocation_type text NOT NULL,
  reference_order_number text,
  destination text NOT NULL,
  planned_tonnage numeric NOT NULL DEFAULT 0,
  start_odometer_km numeric NOT NULL DEFAULT 0,
  end_odometer_km numeric,
  fuel_issued_liters numeric,
  fuel_cost_usd numeric,
  dispatch_time timestamptz,
  expected_return_time timestamptz,
  actual_return_time timestamptz,
  status text NOT NULL DEFAULT 'allocated',
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fleet_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_number text UNIQUE NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES public.fleet_vehicles(id),
  service_type text NOT NULL,
  description text NOT NULL,
  work_done_by text NOT NULL,
  odometer_reading_km numeric NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  parts_replaced text,
  service_date date NOT NULL DEFAULT current_date,
  completion_date date,
  status text NOT NULL DEFAULT 'scheduled',
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fleet_breakdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number text UNIQUE NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES public.fleet_vehicles(id),
  driver_name text NOT NULL,
  incident_date_time timestamptz NOT NULL DEFAULT now(),
  location text NOT NULL,
  nature_of_breakdown text NOT NULL,
  description text NOT NULL,
  cargo_status text NOT NULL DEFAULT 'intact',
  rescue_vehicle_id uuid REFERENCES public.fleet_vehicles(id),
  downtime_hours numeric,
  repair_cost_usd numeric,
  status text NOT NULL DEFAULT 'reported',
  resolved_at timestamptz,
  resolution_notes text,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_schedules_due ON public.maintenance_schedules(next_due_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_work_orders_status ON public.maintenance_work_orders(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_transactions_spare ON public.maintenance_transactions(spare_id);
CREATE INDEX IF NOT EXISTS idx_spare_parts_code ON public.spare_parts(code);
CREATE INDEX IF NOT EXISTS idx_fleet_allocations_vehicle ON public.fleet_allocations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_maintenance_vehicle ON public.fleet_maintenance(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_breakdowns_vehicle ON public.fleet_breakdowns(vehicle_id);

DO $schema_security$
DECLARE
  relation_name text;
  policy_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'spare_parts', 'maintenance_spares', 'maintenance_schedules',
    'maintenance_work_orders', 'maintenance_transactions', 'maintenance_tasks',
    'spare_parts_usage', 'fleet_vehicles', 'fleet_allocations',
    'fleet_maintenance', 'fleet_breakdowns'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    policy_name := 'Authenticated users manage ' || relation_name;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, relation_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      policy_name,
      relation_name
    );
  END LOOP;
END
$schema_security$;

NOTIFY pgrst, 'reload schema';
