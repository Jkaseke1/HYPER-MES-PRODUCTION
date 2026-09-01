-- Create sync_log table and purchase_orders table for Sage Pastel integration
-- This migration creates the missing tables needed for the bridge integration

-- Create sync_log table for bridge logging
CREATE TABLE IF NOT EXISTS sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('grn_confirmed', 'materials_issued', 'production_completed', 'dispatch_delivered', 'price_sync', 'customer_sync', 'error')),
  reference_id uuid,
  reference_type text DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'retry')),
  message text DEFAULT '',
  details jsonb DEFAULT '{}',
  sage_response jsonb DEFAULT '{}',
  error_details jsonb DEFAULT '{}',
  retry_count integer DEFAULT 0,
  next_retry_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read sync_log" ON sync_log;
DROP POLICY IF EXISTS "Authenticated users can insert sync_log" ON sync_log;
DROP POLICY IF EXISTS "Authenticated users can update sync_log" ON sync_log;
CREATE POLICY "Authenticated users can read sync_log"
  ON sync_log FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert sync_log"
  ON sync_log FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update sync_log"
  ON sync_log FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

-- Create purchase_orders table for Sage PO integration
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sage_po_id text UNIQUE NOT NULL,
  supplier_id uuid REFERENCES suppliers(id),
  warehouse_id uuid REFERENCES warehouses(id),
  order_date date DEFAULT CURRENT_DATE,
  expected_date date,
  status text DEFAULT 'open' CHECK (status IN ('open', 'partially_received', 'closed', 'cancelled')),
  total_value numeric DEFAULT 0,
  currency text DEFAULT 'USD',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "Authenticated users can insert purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "Authenticated users can update purchase_orders" ON purchase_orders;
CREATE POLICY "Authenticated users can read purchase_orders"
  ON purchase_orders FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert purchase_orders"
  ON purchase_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update purchase_orders"
  ON purchase_orders FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

-- Create purchase_order_items table
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
  raw_material_id uuid REFERENCES raw_materials(id),
  quantity_ordered numeric NOT NULL DEFAULT 0,
  quantity_received numeric DEFAULT 0,
  unit text DEFAULT 'kg',
  unit_price numeric DEFAULT 0,
  line_total numeric DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "Authenticated users can insert purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "Authenticated users can update purchase_order_items" ON purchase_order_items;
CREATE POLICY "Authenticated users can read purchase_order_items"
  ON purchase_order_items FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert purchase_order_items"
  ON purchase_order_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update purchase_order_items"
  ON purchase_order_items FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

-- Ensure purchase_orders columns exist before creating indexes
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);

-- Ensure purchase_order_items columns exist
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS raw_material_id uuid REFERENCES raw_materials(id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sync_log_event_type ON sync_log(event_type);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status);
CREATE INDEX IF NOT EXISTS idx_sync_log_created_at ON sync_log(created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_sage_po_id ON purchase_orders(sage_po_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);

-- Add comments for documentation
COMMENT ON TABLE sync_log IS 'Bridge integration log for Sage Pastel synchronization events';
COMMENT ON COLUMN sync_log.event_type IS 'Type of integration event (grn_confirmed, materials_issued, etc.)';
COMMENT ON COLUMN sync_log.sage_response IS 'Response from Sage Pastel system';
COMMENT ON COLUMN sync_log.error_details IS 'Detailed error information for failed syncs';

COMMENT ON TABLE purchase_orders IS 'Purchase orders imported from Sage Pastel';
COMMENT ON COLUMN purchase_orders.sage_po_id IS 'Sage Pastel purchase order ID';
COMMENT ON TABLE purchase_order_items IS 'Line items for Sage purchase orders';
