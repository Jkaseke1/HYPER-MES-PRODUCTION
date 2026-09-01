-- Sage Posting Review Queue
-- Allows finance to review and approve/reject transactions before they post to Sage

CREATE TABLE IF NOT EXISTS sage_posting_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_event_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  event_description VARCHAR(200),
  sequence_no INT DEFAULT 0,
  
  -- Transaction details (what will be posted to Sage)
  sage_code VARCHAR(50) NOT NULL,
  transaction_type VARCHAR(20) NOT NULL,
  sage_tx_code VARCHAR(10) NOT NULL,
  quantity DECIMAL(18,4) NOT NULL,
  unit_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
  total_value DECIMAL(18,4) NOT NULL DEFAULT 0,
  warehouse_id INT NOT NULL,
  warehouse_code VARCHAR(10),
  reference VARCHAR(50),
  reference2 VARCHAR(50),
  description VARCHAR(255),
  transaction_date TIMESTAMPTZ DEFAULT now(),
  
  -- Review status
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Posting status
  posted_at TIMESTAMPTZ,
  sage_result JSONB,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_sage_posting_reviews_status ON sage_posting_reviews(status);
CREATE INDEX idx_sage_posting_reviews_sync_event ON sage_posting_reviews(sync_event_id);
CREATE INDEX idx_sage_posting_reviews_pending ON sage_posting_reviews(status, posted_at);

-- Enable RLS
ALTER TABLE sage_posting_reviews ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "All authenticated users can view posting reviews"
  ON sage_posting_reviews FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Finance and admin can update posting reviews"
  ON sage_posting_reviews FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('finance', 'admin')
    )
  );

CREATE POLICY "Service role can manage posting reviews"
  ON sage_posting_reviews FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Add new status to sync_log (if not already present)
-- sync_log.status can now be: pending, processing, pending_finance_review, success, failed
