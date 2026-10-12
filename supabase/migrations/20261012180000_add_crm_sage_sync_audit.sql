-- Execution audit trail for controlled Sage customer-master pulls.
-- This is deliberately separate from sync_log, whose pending rows are work
-- instructions for the Sage posting bridge.

CREATE TABLE IF NOT EXISTS crm_sage_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_endpoint text NOT NULL,
  changed_since timestamptz,
  sage_environment text,
  sage_company_database text,
  customers_read integer NOT NULL DEFAULT 0 CHECK (customers_read >= 0),
  customers_synced integer NOT NULL DEFAULT 0 CHECK (customers_synced >= 0),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crm_sage_sync_runs_started_at
  ON crm_sage_sync_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_sage_sync_runs_status
  ON crm_sage_sync_runs(status, started_at DESC);

ALTER TABLE crm_sage_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_sage_sync_runs_authenticated_select ON crm_sage_sync_runs;
CREATE POLICY crm_sage_sync_runs_authenticated_select ON crm_sage_sync_runs
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE crm_sage_sync_runs IS
  'Execution history for read-only Sage customer-master pulls into the CRM.';
