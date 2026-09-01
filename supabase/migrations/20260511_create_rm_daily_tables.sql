-- DRS (Daily Raw Materials System) Tables
-- Tracks 37 bulk raw materials daily

-- 1. Daily Snapshots (the "TODAY" sheet)
CREATE TABLE IF NOT EXISTS rm_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  raw_material_name text NOT NULL,
  raw_material_id uuid REFERENCES raw_materials(id) ON DELETE SET NULL,
  opening_stock numeric(14,4) DEFAULT 0,
  opening_stock_base_date date,
  mtd_receipts numeric(14,4) DEFAULT 0,
  total_available numeric(14,4) GENERATED ALWAYS AS (opening_stock + mtd_receipts) STORED,
  issues_to_production numeric(14,4) DEFAULT 0,
  theo_closing_stock numeric(14,4) GENERATED ALWAYS AS (opening_stock + mtd_receipts - issues_to_production) STORED,
  physical_stock numeric(14,4) DEFAULT 0,
  system_stock numeric(14,4) DEFAULT 0,
  stock_variance numeric(14,4) GENERATED ALWAYS AS (physical_stock - system_stock) STORED,
  comment text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(snapshot_date, raw_material_name)
);

-- 2. Daily Receipts ("Raw mat Received" sheet)
CREATE TABLE IF NOT EXISTS rm_daily_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_date date NOT NULL,
  raw_material_name text NOT NULL,
  raw_material_id uuid REFERENCES raw_materials(id) ON DELETE SET NULL,
  quantity_kg numeric(14,4) DEFAULT 0,
  grn_reference text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- 3. Daily Issues ("Raw mat Issues&transfers" sheet)
CREATE TABLE IF NOT EXISTS rm_daily_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_date date NOT NULL,
  raw_material_name text NOT NULL,
  raw_material_id uuid REFERENCES raw_materials(id) ON DELETE SET NULL,
  quantity_kg numeric(14,4) DEFAULT 0,
  production_order_ref text,
  production_line text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rm_snapshots_date ON rm_daily_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_rm_snapshots_material ON rm_daily_snapshots(raw_material_name);
CREATE INDEX IF NOT EXISTS idx_rm_receipts_date ON rm_daily_receipts(receipt_date);
CREATE INDEX IF NOT EXISTS idx_rm_receipts_material ON rm_daily_receipts(raw_material_name);
CREATE INDEX IF NOT EXISTS idx_rm_issues_date ON rm_daily_issues(issue_date);
CREATE INDEX IF NOT EXISTS idx_rm_issues_material ON rm_daily_issues(raw_material_name);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION update_rm_snapshot_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rm_snapshots_updated_at ON rm_daily_snapshots;
CREATE TRIGGER trg_rm_snapshots_updated_at
  BEFORE UPDATE ON rm_daily_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_rm_snapshot_updated_at();

-- Monthly Receipts Matrix View
CREATE OR REPLACE VIEW vw_rm_receipts_monthly AS
SELECT
  raw_material_name,
  DATE_TRUNC('month', receipt_date)::date AS month,
  SUM(quantity_kg) AS total_received_kg,
  jsonb_object_agg(receipt_date::text, quantity_kg) AS daily_breakdown
FROM rm_daily_receipts
GROUP BY raw_material_name, DATE_TRUNC('month', receipt_date);

-- Monthly Issues Matrix View
CREATE OR REPLACE VIEW vw_rm_issues_monthly AS
SELECT
  raw_material_name,
  DATE_TRUNC('month', issue_date)::date AS month,
  SUM(quantity_kg) AS total_issued_kg,
  jsonb_object_agg(issue_date::text, quantity_kg) AS daily_breakdown
FROM rm_daily_issues
GROUP BY raw_material_name, DATE_TRUNC('month', issue_date);

-- RLS Policies
ALTER TABLE rm_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE rm_daily_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rm_daily_issues ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if recreating
DROP POLICY IF EXISTS rm_snapshots_select ON rm_daily_snapshots;
DROP POLICY IF EXISTS rm_snapshots_insert ON rm_daily_snapshots;
DROP POLICY IF EXISTS rm_snapshots_update ON rm_daily_snapshots;
DROP POLICY IF EXISTS rm_snapshots_delete ON rm_daily_snapshots;

DROP POLICY IF EXISTS rm_receipts_select ON rm_daily_receipts;
DROP POLICY IF EXISTS rm_receipts_insert ON rm_daily_receipts;
DROP POLICY IF EXISTS rm_receipts_update ON rm_daily_receipts;
DROP POLICY IF EXISTS rm_receipts_delete ON rm_daily_receipts;

DROP POLICY IF EXISTS rm_issues_select ON rm_daily_issues;
DROP POLICY IF EXISTS rm_issues_insert ON rm_daily_issues;
DROP POLICY IF EXISTS rm_issues_update ON rm_daily_issues;
DROP POLICY IF EXISTS rm_issues_delete ON rm_daily_issues;

-- SELECT: all authenticated users
CREATE POLICY rm_snapshots_select ON rm_daily_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY rm_receipts_select ON rm_daily_receipts FOR SELECT TO authenticated USING (true);
CREATE POLICY rm_issues_select ON rm_daily_issues FOR SELECT TO authenticated USING (true);

-- INSERT: all authenticated users
CREATE POLICY rm_snapshots_insert ON rm_daily_snapshots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY rm_receipts_insert ON rm_daily_receipts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY rm_issues_insert ON rm_daily_issues FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE: all authenticated users
CREATE POLICY rm_snapshots_update ON rm_daily_snapshots FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY rm_receipts_update ON rm_daily_receipts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY rm_issues_update ON rm_daily_issues FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- DELETE: only rm_manager and admin roles
CREATE POLICY rm_snapshots_delete ON rm_daily_snapshots FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('rm_manager','admin')));
CREATE POLICY rm_receipts_delete ON rm_daily_receipts FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('rm_manager','admin')));
CREATE POLICY rm_issues_delete ON rm_daily_issues FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('rm_manager','admin')));
