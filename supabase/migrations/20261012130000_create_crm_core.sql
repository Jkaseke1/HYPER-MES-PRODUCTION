-- HYPERFEEDS CRM core
-- Customer relationships are kept separate from Sage so the CRM can own
-- segmentation, contacts, activities and pipeline without writing to Sage.

CREATE TABLE IF NOT EXISTS crm_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sage_customer_id integer,
  sage_customer_code text,
  legal_name text NOT NULL,
  trading_name text,
  customer_type text NOT NULL DEFAULT 'customer'
    CHECK (customer_type IN ('customer', 'prospect', 'lead', 'dealer', 'partner')),
  segment text NOT NULL DEFAULT 'commercial'
    CHECK (segment IN ('commercial', 'small_scale', 'dealer', 'prospect', 'institutional', 'other')),
  lifecycle_stage text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_stage IN ('lead', 'prospect', 'active', 'dormant', 'blocked', 'lost')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'blocked')),
  account_owner uuid REFERENCES profiles(id),
  customer_group text,
  area text,
  branch_name text,
  currency_code text,
  payment_terms text,
  credit_limit numeric(18,2),
  account_balance numeric(18,2),
  on_hold boolean NOT NULL DEFAULT false,
  cash_customer boolean NOT NULL DEFAULT false,
  cash_on_delivery_customer boolean NOT NULL DEFAULT false,
  insurance_customer boolean NOT NULL DEFAULT false,
  tax_number text,
  registration_number text,
  primary_contact_name text,
  primary_email text,
  primary_phone text,
  website text,
  physical_address text,
  delivery_address text,
  notes text,
  sage_last_synced_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_customers_sage_code_unique UNIQUE (sage_customer_code)
);

CREATE TABLE IF NOT EXISTS crm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES crm_customers(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  job_title text,
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES crm_customers(id) ON DELETE CASCADE,
  activity_type text NOT NULL DEFAULT 'note'
    CHECK (activity_type IN ('call', 'meeting', 'email', 'visit', 'task', 'note', 'complaint', 'follow_up')),
  subject text NOT NULL,
  details text,
  activity_date timestamptz NOT NULL DEFAULT now(),
  due_date timestamptz,
  completed_at timestamptz,
  assigned_to uuid REFERENCES profiles(id),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS crm_customer_id uuid REFERENCES crm_customers(id);
ALTER TABLE dispatch_orders ADD COLUMN IF NOT EXISTS crm_customer_id uuid REFERENCES crm_customers(id);

CREATE INDEX IF NOT EXISTS idx_crm_customers_segment ON crm_customers(segment);
CREATE INDEX IF NOT EXISTS idx_crm_customers_status ON crm_customers(status);
CREATE INDEX IF NOT EXISTS idx_crm_customers_sage_code ON crm_customers(sage_customer_code);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_customer ON crm_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_customer_date ON crm_activities(customer_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_crm_customer ON sales_orders(crm_customer_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_crm_customer ON dispatch_orders(crm_customer_id);

CREATE OR REPLACE FUNCTION set_crm_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_customers_updated_at ON crm_customers;
CREATE TRIGGER trg_crm_customers_updated_at BEFORE UPDATE ON crm_customers
FOR EACH ROW EXECUTE FUNCTION set_crm_updated_at();
DROP TRIGGER IF EXISTS trg_crm_contacts_updated_at ON crm_contacts;
CREATE TRIGGER trg_crm_contacts_updated_at BEFORE UPDATE ON crm_contacts
FOR EACH ROW EXECUTE FUNCTION set_crm_updated_at();
DROP TRIGGER IF EXISTS trg_crm_activities_updated_at ON crm_activities;
CREATE TRIGGER trg_crm_activities_updated_at BEFORE UPDATE ON crm_activities
FOR EACH ROW EXECUTE FUNCTION set_crm_updated_at();

ALTER TABLE crm_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_customers_authenticated_select ON crm_customers;
CREATE POLICY crm_customers_authenticated_select ON crm_customers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS crm_customers_authenticated_write ON crm_customers;
CREATE POLICY crm_customers_authenticated_write ON crm_customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS crm_contacts_authenticated_all ON crm_contacts;
CREATE POLICY crm_contacts_authenticated_all ON crm_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS crm_activities_authenticated_all ON crm_activities;
CREATE POLICY crm_activities_authenticated_all ON crm_activities FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE crm_customers IS 'HYPERFEEDS CRM customer master; Sage fields are synchronized snapshots and not the system of record for CRM activity.';
