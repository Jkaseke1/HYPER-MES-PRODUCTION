-- Track Sage stock levels in Supabase for MES validation
-- This ensures MES validates against actual Sage stock before allowing operations

-- Create sage_stock_balances table
CREATE TABLE IF NOT EXISTS sage_stock_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id uuid REFERENCES raw_materials(id) ON DELETE CASCADE,
  sage_code text NOT NULL,
  warehouse_id int NOT NULL, -- Sage WhseID (18 = Raw Materials, 20 = Finished Goods)
  quantity numeric NOT NULL DEFAULT 0,
  last_synced_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (raw_material_id, warehouse_id)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_sage_stock_balances_rm_id ON sage_stock_balances(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_sage_stock_balances_sage_code ON sage_stock_balances(sage_code);
CREATE INDEX IF NOT EXISTS idx_sage_stock_balances_warehouse ON sage_stock_balances(warehouse_id);

-- Create view for easy MES stock validation
CREATE OR REPLACE VIEW v_sage_stock_for_validation AS
SELECT 
  rm.id as raw_material_id,
  rm.name as raw_material_name,
  rm.code as raw_material_code,
  rm.sage_code,
  COALESCE(ssb.quantity, 0) as sage_quantity,
  ssb.warehouse_id,
  CASE ssb.warehouse_id
    WHEN 18 THEN 'Raw Materials'
    WHEN 20 THEN 'Finished Goods'
    ELSE 'Unknown'
  END as warehouse_name,
  ssb.last_synced_at
FROM raw_materials rm
LEFT JOIN sage_stock_balances ssb ON rm.id = ssb.raw_material_id AND ssb.warehouse_id = 18
WHERE rm.is_active = true;

-- Enable RLS
ALTER TABLE sage_stock_balances ENABLE ROW LEVEL SECURITY;

-- Policies: service role can read/write, authenticated can read
DROP POLICY IF EXISTS "Service role can manage sage stock" ON sage_stock_balances;
CREATE POLICY "Service role can manage sage stock"
  ON sage_stock_balances
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can read sage stock" ON sage_stock_balances;
CREATE POLICY "Authenticated users can read sage stock"
  ON sage_stock_balances
  FOR SELECT
  TO authenticated
  USING (true);

-- Function to update sage stock (called by bridge worker)
CREATE OR REPLACE FUNCTION update_sage_stock_balance(
  p_sage_code text,
  p_warehouse_id int,
  p_quantity_delta numeric
)
RETURNS void AS $$
DECLARE
  v_rm_id uuid;
BEGIN
  -- Find raw material by sage_code
  SELECT id INTO v_rm_id FROM raw_materials WHERE sage_code = p_sage_code AND is_active = true;
  
  IF v_rm_id IS NULL THEN
    RAISE EXCEPTION 'Raw material not found for sage_code: %', p_sage_code;
  END IF;
  
  -- Insert or update
  INSERT INTO sage_stock_balances (raw_material_id, sage_code, warehouse_id, quantity, last_synced_at)
  VALUES (v_rm_id, p_sage_code, p_warehouse_id, p_quantity_delta, now())
  ON CONFLICT (raw_material_id, warehouse_id)
  DO UPDATE SET
    quantity = sage_stock_balances.quantity + p_quantity_delta,
    last_synced_at = now(),
    updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- Function to set absolute sage stock (for initial sync)
CREATE OR REPLACE FUNCTION set_sage_stock_balance(
  p_sage_code text,
  p_warehouse_id int,
  p_quantity numeric
)
RETURNS void AS $$
DECLARE
  v_rm_id uuid;
BEGIN
  -- Find raw material by sage_code
  SELECT id INTO v_rm_id FROM raw_materials WHERE sage_code = p_sage_code AND is_active = true;
  
  IF v_rm_id IS NULL THEN
    RAISE EXCEPTION 'Raw material not found for sage_code: %', p_sage_code;
  END IF;
  
  -- Insert or update
  INSERT INTO sage_stock_balances (raw_material_id, sage_code, warehouse_id, quantity, last_synced_at)
  VALUES (v_rm_id, p_sage_code, p_warehouse_id, p_quantity, now())
  ON CONFLICT (raw_material_id, warehouse_id)
  DO UPDATE SET
    quantity = p_quantity,
    last_synced_at = now(),
    updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- Function to get available sage stock for a material
CREATE OR REPLACE FUNCTION get_sage_available_stock(p_raw_material_id uuid)
RETURNS numeric AS $$
BEGIN
  RETURN COALESCE(
    (SELECT quantity FROM sage_stock_balances 
     WHERE raw_material_id = p_raw_material_id AND warehouse_id = 18),
    0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
