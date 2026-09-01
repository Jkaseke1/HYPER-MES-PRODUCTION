-- Editor-safe quality holds and lot traceability.
-- This migration deliberately contains no PostgreSQL functions or triggers.

CREATE TABLE IF NOT EXISTS quality_lot_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('grn', 'production_output', 'manual')),
  source_id uuid,
  raw_material_id uuid REFERENCES raw_materials(id) ON DELETE SET NULL,
  production_order_id uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  batch_number text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit text NOT NULL DEFAULT 'kg',
  disposition text NOT NULL DEFAULT 'hold' CHECK (disposition IN ('hold', 'released', 'conditional', 'rejected')),
  hold_reason text,
  released_by uuid REFERENCES profiles(id),
  released_at timestamptz,
  release_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quality_lot_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quality_lot_control_id uuid NOT NULL REFERENCES quality_lot_controls(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('held', 'released', 'conditional_release', 'rejected', 'reopened')),
  previous_disposition text,
  new_disposition text NOT NULL,
  reason text,
  performed_by uuid REFERENCES profiles(id),
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_lot_controls_source_batch
  ON quality_lot_controls(source_type, source_id, raw_material_id, batch_number);
CREATE INDEX IF NOT EXISTS idx_quality_lot_controls_disposition
  ON quality_lot_controls(disposition, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_lot_controls_batch ON quality_lot_controls(batch_number);
CREATE INDEX IF NOT EXISTS idx_quality_lot_actions_lot ON quality_lot_actions(quality_lot_control_id, performed_at DESC);

ALTER TABLE quality_lot_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_lot_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read quality lot controls" ON quality_lot_controls;
DROP POLICY IF EXISTS "Authenticated users can manage quality lot controls" ON quality_lot_controls;
DROP POLICY IF EXISTS "Authenticated users can read quality lot actions" ON quality_lot_actions;
CREATE POLICY "Authenticated users can read quality lot controls" ON quality_lot_controls FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can manage quality lot controls" ON quality_lot_controls FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can read quality lot actions" ON quality_lot_actions FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

ALTER TABLE production_outputs ADD COLUMN IF NOT EXISTS quality_disposition text NOT NULL DEFAULT 'hold'
  CHECK (quality_disposition IN ('hold', 'released', 'conditional', 'rejected'));
ALTER TABLE production_outputs ADD COLUMN IF NOT EXISTS quality_released_by uuid REFERENCES profiles(id);
ALTER TABLE production_outputs ADD COLUMN IF NOT EXISTS quality_released_at timestamptz;
ALTER TABLE production_outputs ADD COLUMN IF NOT EXISTS quality_release_notes text;

CREATE OR REPLACE VIEW quality_lot_traceability AS
SELECT
  qlc.id, qlc.source_type, qlc.source_id, qlc.batch_number, qlc.quantity, qlc.unit,
  qlc.disposition, qlc.hold_reason, qlc.released_at, qlc.release_notes,
  rm.code AS material_code, rm.name AS material_name,
  grn.grn_number, po.batch_number AS production_batch_number
FROM quality_lot_controls qlc
LEFT JOIN raw_materials rm ON rm.id = qlc.raw_material_id
LEFT JOIN goods_received_notes grn ON qlc.source_type = 'grn' AND grn.id = qlc.source_id
LEFT JOIN production_orders po ON po.id = qlc.production_order_id;

GRANT SELECT ON quality_lot_traceability TO authenticated;
