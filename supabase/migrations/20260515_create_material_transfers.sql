-- Create material_transfers table for proper approval workflow

CREATE TABLE IF NOT EXISTS material_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number text UNIQUE NOT NULL DEFAULT 'MT-' || to_char(now(), 'YYYYMMDD') || '-' || floor(random() * 900 + 100)::text,
  raw_material_id uuid REFERENCES raw_materials(id),
  from_warehouse_id uuid REFERENCES warehouses(id),
  to_location text DEFAULT 'Production Floor',
  quantity numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'kg',
  transfer_date date DEFAULT CURRENT_DATE,
  purpose text DEFAULT '',
  production_order_id uuid REFERENCES production_orders(id),
  notes text DEFAULT '',
  
  -- Approval workflow
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'in_transit', 'received', 'rejected')),
  requested_by uuid REFERENCES profiles(id),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  rejection_reason text DEFAULT '',
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE material_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read material_transfers"
  ON material_transfers FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert material_transfers"
  ON material_transfers FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update material_transfers"
  ON material_transfers FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_material_transfers_status ON material_transfers(status);
CREATE INDEX IF NOT EXISTS idx_material_transfers_raw_material ON material_transfers(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_material_transfers_requested_by ON material_transfers(requested_by);
