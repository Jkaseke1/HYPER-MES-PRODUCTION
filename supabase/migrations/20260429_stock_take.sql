-- Stock Take Module
-- Full stock take workflow with blind counting, mandatory items, recount, and audit trail

CREATE TABLE IF NOT EXISTS stock_takes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  take_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','FROZEN','CLOSED')),
  started_by uuid REFERENCES auth.users(id),
  started_at timestamptz DEFAULT now(),
  frozen_by uuid REFERENCES auth.users(id),
  frozen_at timestamptz,
  closed_by uuid REFERENCES auth.users(id),
  closed_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  notes text,
  blind_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_take_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id uuid REFERENCES stock_takes(id) ON DELETE CASCADE,
  raw_material_id uuid REFERENCES raw_materials(id),
  assigned_to uuid REFERENCES auth.users(id),
  system_qty numeric NOT NULL DEFAULT 0,
  counted_qty numeric,
  recount_qty numeric,
  variance numeric GENERATED ALWAYS AS (COALESCE(counted_qty, 0) - system_qty) STORED,
  unit text NOT NULL DEFAULT 'kg',
  is_mandatory boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  needs_recount boolean NOT NULL DEFAULT false,
  recount_reason text,
  counted_by uuid REFERENCES auth.users(id),
  counted_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_take_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id uuid REFERENCES stock_takes(id) ON DELETE CASCADE,
  line_id uuid REFERENCES stock_take_lines(id) ON DELETE CASCADE,
  action text NOT NULL,
  old_value numeric,
  new_value numeric,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz DEFAULT now(),
  notes text
);

-- RLS Policies
ALTER TABLE stock_takes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_take_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_take_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON stock_takes FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON stock_take_lines FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON stock_take_audit_log FOR ALL USING (auth.role() = 'authenticated');

-- Indexes for performance
CREATE INDEX idx_stock_takes_status ON stock_takes(status);
CREATE INDEX idx_stock_take_lines_stock_take_id ON stock_take_lines(stock_take_id);
CREATE INDEX idx_stock_take_lines_assigned_to ON stock_take_lines(assigned_to);
CREATE INDEX idx_stock_take_audit_log_stock_take_id ON stock_take_audit_log(stock_take_id);

COMMENT ON TABLE stock_takes IS 'Stock take header records';
COMMENT ON TABLE stock_take_lines IS 'Individual count lines per raw material';
COMMENT ON TABLE stock_take_audit_log IS 'Audit trail for all count changes';
