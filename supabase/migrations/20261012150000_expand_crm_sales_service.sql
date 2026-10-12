-- HYPERFEEDS CRM: pipeline, tasks, service issues and customer health

ALTER TABLE crm_customers
  ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'healthy'
    CHECK (health_status IN ('healthy', 'growing', 'dormant', 'at_risk', 'reactivation_ready')),
  ADD COLUMN IF NOT EXISTS next_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS preferred_channel text,
  ADD COLUMN IF NOT EXISTS last_purchase_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  stage_order integer NOT NULL,
  probability numeric(5,2) NOT NULL DEFAULT 0,
  stage_type text NOT NULL DEFAULT 'open'
    CHECK (stage_type IN ('open', 'won', 'lost')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO crm_pipeline_stages (name, stage_order, probability, stage_type)
VALUES
  ('New lead', 10, 10, 'open'),
  ('Qualified', 20, 25, 'open'),
  ('Needs analysis', 30, 40, 'open'),
  ('Quotation sent', 40, 60, 'open'),
  ('Negotiation', 50, 75, 'open'),
  ('Won', 90, 100, 'won'),
  ('Lost', 100, 0, 'lost')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS crm_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES crm_customers(id) ON DELETE SET NULL,
  title text NOT NULL,
  opportunity_type text NOT NULL DEFAULT 'new_business'
    CHECK (opportunity_type IN ('new_business', 'repeat_order', 'feed_cross_sell', 'chicks_cross_sell', 'reactivation', 'contract', 'other')),
  product_interest text,
  stage_id uuid REFERENCES crm_pipeline_stages(id),
  owner_id uuid REFERENCES profiles(id),
  source text,
  estimated_value numeric(18,2),
  currency_code text,
  probability numeric(5,2),
  expected_close_date date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'won', 'lost', 'on_hold')),
  lost_reason text,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES crm_customers(id) ON DELETE SET NULL,
  issue_type text NOT NULL DEFAULT 'other'
    CHECK (issue_type IN ('complaint', 'delivery_failure', 'quality', 'credit', 'billing', 'stock_availability', 'other')),
  severity text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'waiting_customer', 'resolved', 'closed')),
  subject text NOT NULL,
  description text,
  reference_number text,
  owner_id uuid REFERENCES profiles(id),
  due_date date,
  resolved_at timestamptz,
  resolution_notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_customer_tags (
  customer_id uuid NOT NULL REFERENCES crm_customers(id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_crm_customers_health ON crm_customers(health_status);
CREATE INDEX IF NOT EXISTS idx_crm_customers_next_contact ON crm_customers(next_contact_at);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_customer ON crm_opportunities(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_stage ON crm_opportunities(stage_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_issues_customer_status ON crm_issues(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_issues_due_date ON crm_issues(due_date, status);

DROP TRIGGER IF EXISTS trg_crm_opportunities_updated_at ON crm_opportunities;
CREATE TRIGGER trg_crm_opportunities_updated_at BEFORE UPDATE ON crm_opportunities
FOR EACH ROW EXECUTE FUNCTION set_crm_updated_at();
DROP TRIGGER IF EXISTS trg_crm_issues_updated_at ON crm_issues;
CREATE TRIGGER trg_crm_issues_updated_at BEFORE UPDATE ON crm_issues
FOR EACH ROW EXECUTE FUNCTION set_crm_updated_at();

ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_customer_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_pipeline_stages_authenticated_all ON crm_pipeline_stages;
CREATE POLICY crm_pipeline_stages_authenticated_all ON crm_pipeline_stages FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS crm_opportunities_authenticated_all ON crm_opportunities;
CREATE POLICY crm_opportunities_authenticated_all ON crm_opportunities FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS crm_issues_authenticated_all ON crm_issues;
CREATE POLICY crm_issues_authenticated_all ON crm_issues FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS crm_customer_tags_authenticated_all ON crm_customer_tags;
CREATE POLICY crm_customer_tags_authenticated_all ON crm_customer_tags FOR ALL TO authenticated USING (true) WITH CHECK (true);
