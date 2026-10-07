-- Read-only Sage manufacturing import storage. These tables never initiate
-- Sage postings; they preserve the source identifiers required for audit.

ALTER TABLE public.formulations
  ADD COLUMN IF NOT EXISTS sage_bom_id integer,
  ADD COLUMN IF NOT EXISTS sage_source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS sage_imported_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_formulations_sage_bom_id
  ON public.formulations (sage_bom_id)
  WHERE sage_bom_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sage_manufacturing_history (
  sage_process_id integer PRIMARY KEY,
  process_reference text NOT NULL DEFAULT '',
  external_reference text NOT NULL DEFAULT '',
  sage_bom_id integer,
  finished_good_code text NOT NULL DEFAULT '',
  finished_good_name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  source_status text NOT NULL DEFAULT '',
  planned_quantity numeric NOT NULL DEFAULT 0,
  manufactured_quantity numeric NOT NULL DEFAULT 0,
  warehouse_id integer,
  branch_id integer,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  projected_completion_at timestamptz,
  actual_completion_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sage_manufacturing_history_created
  ON public.sage_manufacturing_history (source_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sage_manufacturing_history_reference
  ON public.sage_manufacturing_history (process_reference);

CREATE TABLE IF NOT EXISTS public.sage_manufacturing_history_lines (
  sage_process_line_id bigint PRIMARY KEY,
  sage_process_id integer NOT NULL REFERENCES public.sage_manufacturing_history(sage_process_id) ON DELETE CASCADE,
  action_code integer,
  line_number integer,
  reference text NOT NULL DEFAULT '',
  item_stock_link integer,
  item_code text NOT NULL DEFAULT '',
  item_name text NOT NULL DEFAULT '',
  warehouse_id integer,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  line_cost numeric NOT NULL DEFAULT 0,
  processed boolean NOT NULL DEFAULT false,
  transaction_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sage_manufacturing_history_lines_process
  ON public.sage_manufacturing_history_lines (sage_process_id, line_number);

ALTER TABLE public.sage_manufacturing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sage_manufacturing_history_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sage_manufacturing_history_read ON public.sage_manufacturing_history;
CREATE POLICY sage_manufacturing_history_read ON public.sage_manufacturing_history
  FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin','md','production_manager','supervisor','operator','finance','accountant']));

DROP POLICY IF EXISTS sage_manufacturing_history_lines_read ON public.sage_manufacturing_history_lines;
CREATE POLICY sage_manufacturing_history_lines_read ON public.sage_manufacturing_history_lines
  FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin','md','production_manager','supervisor','operator','finance','accountant']));

NOTIFY pgrst, 'reload schema';
