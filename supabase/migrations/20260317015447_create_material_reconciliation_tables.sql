/*
  # Create Material Reconciliation Tables

  This migration creates the full material reconciliation system that tracks
  monthly stock reconciliation across all production stages:
  - Minivits raw materials
  - Bulk raw materials
  - Bulk production
  - Packaging production
  - Macropacks production
  - Finished goods / dispatch

  1. New Tables
    - `reconciliation_periods` - Monthly reconciliation periods with summary stats
      - `id` (uuid, primary key)
      - `month` (integer) - Month number 1-12
      - `year` (integer) - Year e.g. 2026
      - `branch_id` (uuid, FK to branches) - Which branch this recon is for
      - `status` (text) - draft, in_progress, completed, approved
      - `received_raw_materials_t` (numeric) - Total RM received in tonnes
      - `transferred_rm_to_prod_t` (numeric) - Transferred bulks from RM to Production
      - `exp_production_via_bulks_t` (numeric) - Expected production via bulks
      - `exp_production_via_macropacks_t` (numeric) - Expected production via macropacks
      - `exp_production_via_packaging_t` (numeric) - Expected production via packaging
      - `actual_declared_production_t` (numeric) - Actual declared production
      - `transferred_prod_to_dispatch_t` (numeric) - Transferred from production to dispatch
      - `expected_dispatched_t` (numeric) - Expected dispatched
      - `actual_dispatched_t` (numeric) - Actual dispatched
      - `notes` (text) - General notes
      - `created_by` (uuid, FK to profiles)
      - `approved_by` (uuid, FK to profiles)
      - `created_at`, `updated_at` (timestamptz)

    - `recon_raw_materials` - Raw material reconciliation lines (minivits + bulk)
      - `id` (uuid, primary key)
      - `period_id` (uuid, FK to reconciliation_periods)
      - `material_type` (text) - minivits, bulk
      - `material_name` (text)
      - `raw_material_id` (uuid, FK to raw_materials, nullable)
      - `opening_stock` (numeric)
      - `stock_receipts` (numeric)
      - `total` (numeric)
      - `issues` (numeric) - Material issued to production
      - `physical_stock` (numeric) - Physically counted stock
      - `system_stock` (numeric) - Stock per system
      - `material_variance` (numeric) - Difference physical vs system
      - `variance_pct` (numeric) - Variance percentage
      - `comments` (text)
      - `created_at`, `updated_at` (timestamptz)

    - `recon_production` - Production reconciliation lines (bulk production + packaging)
      - `id` (uuid, primary key)
      - `period_id` (uuid, FK to reconciliation_periods)
      - `production_type` (text) - bulk, packaging
      - `product_name` (text)
      - `formulation_id` (uuid, FK to formulations, nullable)
      - `opening_stock` (numeric)
      - `stock_received` (numeric) - RM received / transferred from RM
      - `total` (numeric)
      - `expected_production` (numeric)
      - `conversion_produced` (numeric) - Actual conversion/produced
      - `wastage` (numeric)
      - `closing_stock` (numeric)
      - `physical_stock` (numeric)
      - `system_stock` (numeric)
      - `material_variance` (numeric)
      - `variance_pct` (numeric)
      - `comments` (text)
      - `created_at`, `updated_at` (timestamptz)

    - `recon_macropacks` - Macropack production reconciliation lines
      - `id` (uuid, primary key)
      - `period_id` (uuid, FK to reconciliation_periods)
      - `macropack_name` (text) - e.g. BRO STARTER, BRO GROWER
      - `formulation_id` (uuid, FK to formulations, nullable)
      - `opening_stock` (numeric)
      - `manufactured_units` (numeric)
      - `total_units` (numeric)
      - `converted_units` (numeric)
      - `closing_stock` (numeric)
      - `system_units` (numeric)
      - `material_variance` (numeric)
      - `variance_pct` (numeric)
      - `comments` (text)
      - `created_at`, `updated_at` (timestamptz)

    - `recon_macropack_usage` - Ingredient usage per macropack line
      - `id` (uuid, primary key)
      - `recon_macropack_id` (uuid, FK to recon_macropacks)
      - `ingredient_name` (text) - e.g. Lysine, MCP, SOD, etc.
      - `raw_material_id` (uuid, FK to raw_materials, nullable)
      - `quantity_used` (numeric)
      - `unit` (text, default 'kg')
      - `created_at` (timestamptz)

    - `recon_finished_goods` - Finished goods / dispatch reconciliation
      - `id` (uuid, primary key)
      - `period_id` (uuid, FK to reconciliation_periods)
      - `product_name` (text) - e.g. Broiler 50 Combo, Layers St Combo
      - `formulation_id` (uuid, FK to formulations, nullable)
      - `opening_stock` (numeric)
      - `receipt_from_production` (numeric)
      - `total` (numeric)
      - `dispatched` (numeric)
      - `closing_stock` (numeric)
      - `physical_stock` (numeric)
      - `system_stock` (numeric)
      - `material_variance` (numeric)
      - `variance_pct` (numeric)
      - `comments` (text)
      - `created_at`, `updated_at` (timestamptz)

    - `recon_observations` - Observations/comments per section
      - `id` (uuid, primary key)
      - `period_id` (uuid, FK to reconciliation_periods)
      - `section` (text) - statistics, bulks, packaging, macropacks, finished_goods
      - `observation` (text)
      - `severity` (text) - info, warning, critical
      - `created_by` (uuid, FK to profiles, nullable)
      - `created_at` (timestamptz)

  2. Security
    - RLS enabled on all tables
    - Authenticated users can read reconciliation data
    - Authenticated users can create/update reconciliation data
*/

-- reconciliation_periods
CREATE TABLE IF NOT EXISTS reconciliation_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  branch_id uuid REFERENCES branches(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'approved')),
  received_raw_materials_t numeric NOT NULL DEFAULT 0,
  transferred_rm_to_prod_t numeric NOT NULL DEFAULT 0,
  exp_production_via_bulks_t numeric NOT NULL DEFAULT 0,
  exp_production_via_macropacks_t numeric NOT NULL DEFAULT 0,
  exp_production_via_packaging_t numeric NOT NULL DEFAULT 0,
  actual_declared_production_t numeric NOT NULL DEFAULT 0,
  transferred_prod_to_dispatch_t numeric NOT NULL DEFAULT 0,
  expected_dispatched_t numeric NOT NULL DEFAULT 0,
  actual_dispatched_t numeric NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  approved_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(month, year, branch_id)
);

ALTER TABLE reconciliation_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view reconciliation periods"
  ON reconciliation_periods FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create reconciliation periods"
  ON reconciliation_periods FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update reconciliation periods"
  ON reconciliation_periods FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete draft reconciliation periods"
  ON reconciliation_periods FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND status = 'draft');

-- recon_raw_materials
CREATE TABLE IF NOT EXISTS recon_raw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES reconciliation_periods(id) ON DELETE CASCADE,
  material_type text NOT NULL CHECK (material_type IN ('minivits', 'bulk')),
  material_name text NOT NULL DEFAULT '',
  raw_material_id uuid REFERENCES raw_materials(id),
  opening_stock numeric NOT NULL DEFAULT 0,
  stock_receipts numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  issues numeric NOT NULL DEFAULT 0,
  physical_stock numeric NOT NULL DEFAULT 0,
  system_stock numeric NOT NULL DEFAULT 0,
  material_variance numeric NOT NULL DEFAULT 0,
  variance_pct numeric NOT NULL DEFAULT 0,
  comments text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE recon_raw_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view recon raw materials"
  ON recon_raw_materials FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create recon raw materials"
  ON recon_raw_materials FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update recon raw materials"
  ON recon_raw_materials FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete recon raw materials"
  ON recon_raw_materials FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- recon_production
CREATE TABLE IF NOT EXISTS recon_production (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES reconciliation_periods(id) ON DELETE CASCADE,
  production_type text NOT NULL CHECK (production_type IN ('bulk', 'packaging')),
  product_name text NOT NULL DEFAULT '',
  formulation_id uuid REFERENCES formulations(id),
  opening_stock numeric NOT NULL DEFAULT 0,
  stock_received numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  expected_production numeric NOT NULL DEFAULT 0,
  conversion_produced numeric NOT NULL DEFAULT 0,
  wastage numeric NOT NULL DEFAULT 0,
  closing_stock numeric NOT NULL DEFAULT 0,
  physical_stock numeric NOT NULL DEFAULT 0,
  system_stock numeric NOT NULL DEFAULT 0,
  material_variance numeric NOT NULL DEFAULT 0,
  variance_pct numeric NOT NULL DEFAULT 0,
  comments text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE recon_production ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view recon production"
  ON recon_production FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create recon production"
  ON recon_production FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update recon production"
  ON recon_production FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete recon production"
  ON recon_production FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- recon_macropacks
CREATE TABLE IF NOT EXISTS recon_macropacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES reconciliation_periods(id) ON DELETE CASCADE,
  macropack_name text NOT NULL DEFAULT '',
  formulation_id uuid REFERENCES formulations(id),
  opening_stock numeric NOT NULL DEFAULT 0,
  manufactured_units numeric NOT NULL DEFAULT 0,
  total_units numeric NOT NULL DEFAULT 0,
  converted_units numeric NOT NULL DEFAULT 0,
  closing_stock numeric NOT NULL DEFAULT 0,
  system_units numeric NOT NULL DEFAULT 0,
  material_variance numeric NOT NULL DEFAULT 0,
  variance_pct numeric NOT NULL DEFAULT 0,
  comments text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE recon_macropacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view recon macropacks"
  ON recon_macropacks FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create recon macropacks"
  ON recon_macropacks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update recon macropacks"
  ON recon_macropacks FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete recon macropacks"
  ON recon_macropacks FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- recon_macropack_usage
CREATE TABLE IF NOT EXISTS recon_macropack_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_macropack_id uuid NOT NULL REFERENCES recon_macropacks(id) ON DELETE CASCADE,
  ingredient_name text NOT NULL DEFAULT '',
  raw_material_id uuid REFERENCES raw_materials(id),
  quantity_used numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'kg',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE recon_macropack_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view recon macropack usage"
  ON recon_macropack_usage FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create recon macropack usage"
  ON recon_macropack_usage FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update recon macropack usage"
  ON recon_macropack_usage FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete recon macropack usage"
  ON recon_macropack_usage FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- recon_finished_goods
CREATE TABLE IF NOT EXISTS recon_finished_goods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES reconciliation_periods(id) ON DELETE CASCADE,
  product_name text NOT NULL DEFAULT '',
  formulation_id uuid REFERENCES formulations(id),
  opening_stock numeric NOT NULL DEFAULT 0,
  receipt_from_production numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  dispatched numeric NOT NULL DEFAULT 0,
  closing_stock numeric NOT NULL DEFAULT 0,
  physical_stock numeric NOT NULL DEFAULT 0,
  system_stock numeric NOT NULL DEFAULT 0,
  material_variance numeric NOT NULL DEFAULT 0,
  variance_pct numeric NOT NULL DEFAULT 0,
  comments text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE recon_finished_goods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view recon finished goods"
  ON recon_finished_goods FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create recon finished goods"
  ON recon_finished_goods FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update recon finished goods"
  ON recon_finished_goods FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete recon finished goods"
  ON recon_finished_goods FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- recon_observations
CREATE TABLE IF NOT EXISTS recon_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES reconciliation_periods(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('statistics', 'bulks', 'packaging', 'macropacks', 'finished_goods')),
  observation text NOT NULL DEFAULT '',
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE recon_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view recon observations"
  ON recon_observations FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create recon observations"
  ON recon_observations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update recon observations"
  ON recon_observations FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete recon observations"
  ON recon_observations FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_recon_raw_materials_period ON recon_raw_materials(period_id);
CREATE INDEX IF NOT EXISTS idx_recon_raw_materials_type ON recon_raw_materials(material_type);
CREATE INDEX IF NOT EXISTS idx_recon_production_period ON recon_production(period_id);
CREATE INDEX IF NOT EXISTS idx_recon_production_type ON recon_production(production_type);
CREATE INDEX IF NOT EXISTS idx_recon_macropacks_period ON recon_macropacks(period_id);
CREATE INDEX IF NOT EXISTS idx_recon_macropack_usage_macropack ON recon_macropack_usage(recon_macropack_id);
CREATE INDEX IF NOT EXISTS idx_recon_finished_goods_period ON recon_finished_goods(period_id);
CREATE INDEX IF NOT EXISTS idx_recon_observations_period ON recon_observations(period_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_month_year ON reconciliation_periods(year, month);