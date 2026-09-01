-- Production order capture and reporting fields.
-- Adds empty/defaulted columns only; no production order, stock, or Sage data is changed.

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS planned_bags numeric NOT NULL DEFAULT 0 CHECK (planned_bags >= 0),
  ADD COLUMN IF NOT EXISTS actual_bags numeric NOT NULL DEFAULT 0 CHECK (actual_bags >= 0),
  ADD COLUMN IF NOT EXISTS rejected_bags numeric NOT NULL DEFAULT 0 CHECK (rejected_bags >= 0),
  ADD COLUMN IF NOT EXISTS wastage_bags numeric NOT NULL DEFAULT 0 CHECK (wastage_bags >= 0),
  ADD COLUMN IF NOT EXISTS unit_size text NOT NULL DEFAULT '50',
  ADD COLUMN IF NOT EXISTS shift text NOT NULL DEFAULT 'Day Shift',
  ADD COLUMN IF NOT EXISTS operators text,
  ADD COLUMN IF NOT EXISTS week_number integer CHECK (week_number BETWEEN 1 AND 53),
  ADD COLUMN IF NOT EXISTS actual_hours numeric(10,2) CHECK (actual_hours IS NULL OR actual_hours >= 0),
  ADD COLUMN IF NOT EXISTS average_throughput numeric(14,4) CHECK (average_throughput IS NULL OR average_throughput >= 0),
  ADD COLUMN IF NOT EXISTS production_line_cost numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_production_orders_completed_actual_end
  ON public.production_orders(status, actual_end)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_production_orders_shift_planned_end
  ON public.production_orders(shift, planned_end);
