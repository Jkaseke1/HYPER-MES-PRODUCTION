/*
  # Warehouse and Dispatch Management Tables

  1. New Tables
    - `stock_movements` - All stock movements (receipts, issues, transfers, adjustments)
    - `dispatch_orders` - Dispatch orders to branches
    - `dispatch_items` - Items in each dispatch order

  2. Notes
    - Stock movements provide full audit trail
    - Dispatch orders track delivery to 18 branches
    - Links to production orders for traceability
*/

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type text NOT NULL CHECK (movement_type IN ('receipt', 'issue', 'transfer', 'adjustment', 'production_input', 'production_output', 'dispatch')),
  reference_type text DEFAULT '',
  reference_id uuid,
  raw_material_id uuid REFERENCES raw_materials(id),
  formulation_id uuid REFERENCES formulations(id),
  warehouse_id uuid REFERENCES warehouses(id),
  quantity numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'kg',
  batch_number text DEFAULT '',
  movement_date timestamptz DEFAULT now(),
  performed_by uuid REFERENCES profiles(id),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stock_movements"
  ON stock_movements FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert stock_movements"
  ON stock_movements FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS dispatch_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_number text UNIQUE NOT NULL,
  branch_id uuid REFERENCES branches(id),
  warehouse_id uuid REFERENCES warehouses(id),
  dispatch_date date DEFAULT CURRENT_DATE,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'loading', 'dispatched', 'in_transit', 'delivered', 'cancelled')),
  vehicle_number text DEFAULT '',
  driver_name text DEFAULT '',
  total_weight numeric DEFAULT 0,
  total_value numeric DEFAULT 0,
  prepared_by uuid REFERENCES profiles(id),
  approved_by uuid REFERENCES profiles(id),
  delivery_notes text DEFAULT '',
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE dispatch_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read dispatch_orders"
  ON dispatch_orders FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert dispatch_orders"
  ON dispatch_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update dispatch_orders"
  ON dispatch_orders FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS dispatch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_order_id uuid REFERENCES dispatch_orders(id) ON DELETE CASCADE,
  formulation_id uuid REFERENCES formulations(id),
  batch_number text DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'kg',
  unit_price numeric DEFAULT 0,
  line_total numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE dispatch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read dispatch_items"
  ON dispatch_items FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert dispatch_items"
  ON dispatch_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update dispatch_items"
  ON dispatch_items FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete dispatch_items"
  ON dispatch_items FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_stock_movements_material ON stock_movements(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(movement_date);
CREATE INDEX IF NOT EXISTS idx_production_orders_status ON production_orders(status);
CREATE INDEX IF NOT EXISTS idx_production_orders_batch ON production_orders(batch_number);
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_branch ON dispatch_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_status ON dispatch_orders(status);
CREATE INDEX IF NOT EXISTS idx_raw_materials_code ON raw_materials(code);
CREATE INDEX IF NOT EXISTS idx_formulations_code ON formulations(code);