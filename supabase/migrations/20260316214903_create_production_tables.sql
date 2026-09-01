/*
  # Production Management Tables

  1. New Tables
    - `production_plans` - Daily/weekly production schedules
    - `production_plan_items` - Line items for each plan
    - `production_orders` - Batch production orders with full tracking
    - `production_order_materials` - Materials required/consumed per order
    - `production_logs` - Shop floor activity logs (start/stop/downtime)
    - `production_outputs` - Finished goods produced per order

  2. Notes
    - Production orders track planned vs actual for variance analysis
    - Material consumption tracked at individual ingredient level
    - Shop floor logs capture machine, operator, and time data
*/

CREATE TABLE IF NOT EXISTS production_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_number text UNIQUE NOT NULL,
  plan_date date NOT NULL DEFAULT CURRENT_DATE,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date NOT NULL DEFAULT CURRENT_DATE,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  notes text DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE production_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read production_plans"
  ON production_plans FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert production_plans"
  ON production_plans FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update production_plans"
  ON production_plans FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS production_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES production_plans(id) ON DELETE CASCADE,
  formulation_id uuid REFERENCES formulations(id),
  planned_qty numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'kg',
  priority integer DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE production_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read production_plan_items"
  ON production_plan_items FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert production_plan_items"
  ON production_plan_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update production_plan_items"
  ON production_plan_items FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete production_plan_items"
  ON production_plan_items FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number text UNIQUE NOT NULL,
  plan_id uuid REFERENCES production_plans(id),
  formulation_id uuid REFERENCES formulations(id),
  machine_id uuid REFERENCES machines(id),
  planned_qty numeric NOT NULL DEFAULT 0,
  actual_qty numeric DEFAULT 0,
  rejected_qty numeric DEFAULT 0,
  wastage_qty numeric DEFAULT 0,
  unit text DEFAULT 'kg',
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'materials_issued', 'in_progress', 'completed', 'cancelled')),
  priority text DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  operator_id uuid REFERENCES profiles(id),
  supervisor_id uuid REFERENCES profiles(id),
  raw_material_cost numeric DEFAULT 0,
  labour_cost numeric DEFAULT 0,
  machine_cost numeric DEFAULT 0,
  overhead_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  cost_per_unit numeric DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read production_orders"
  ON production_orders FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert production_orders"
  ON production_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update production_orders"
  ON production_orders FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS production_order_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid REFERENCES production_orders(id) ON DELETE CASCADE,
  raw_material_id uuid REFERENCES raw_materials(id),
  planned_qty numeric NOT NULL DEFAULT 0,
  actual_qty numeric DEFAULT 0,
  wastage_qty numeric DEFAULT 0,
  unit text DEFAULT 'kg',
  unit_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  issued boolean DEFAULT false,
  issued_at timestamptz,
  issued_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE production_order_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read production_order_materials"
  ON production_order_materials FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert production_order_materials"
  ON production_order_materials FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update production_order_materials"
  ON production_order_materials FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS production_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid REFERENCES production_orders(id) ON DELETE CASCADE,
  machine_id uuid REFERENCES machines(id),
  operator_id uuid REFERENCES profiles(id),
  log_type text NOT NULL DEFAULT 'info' CHECK (log_type IN ('start', 'stop', 'pause', 'resume', 'downtime', 'issue', 'info')),
  description text DEFAULT '',
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  duration_minutes numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE production_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read production_logs"
  ON production_logs FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert production_logs"
  ON production_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update production_logs"
  ON production_logs FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS production_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid REFERENCES production_orders(id) ON DELETE CASCADE,
  batch_number text NOT NULL DEFAULT '',
  quantity_produced numeric NOT NULL DEFAULT 0,
  rejected_quantity numeric DEFAULT 0,
  wastage_quantity numeric DEFAULT 0,
  unit text DEFAULT 'kg',
  warehouse_id uuid REFERENCES warehouses(id),
  quality_status text DEFAULT 'pending' CHECK (quality_status IN ('pending', 'passed', 'failed')),
  recorded_by uuid REFERENCES profiles(id),
  recorded_at timestamptz DEFAULT now(),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE production_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read production_outputs"
  ON production_outputs FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert production_outputs"
  ON production_outputs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update production_outputs"
  ON production_outputs FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);