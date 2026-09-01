-- Weigh Bridge Tickets table
-- Stores weigh bridge records BEFORE they are linked to a GRN
CREATE TABLE IF NOT EXISTS weigh_bridge_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no       TEXT NOT NULL UNIQUE,
  vehicle_reg     TEXT,
  haulier_code    TEXT,
  driver_name     TEXT,
  driver_id       TEXT,
  product_code    TEXT,
  trailer_number  TEXT,
  time_in         TIMESTAMPTZ,
  time_out        TIMESTAMPTZ,
  first_mass      NUMERIC(12, 3),
  second_mass     NUMERIC(12, 3),
  nett_mass       NUMERIC(12, 3),
  comment         TEXT,
  driver_signed   BOOLEAN DEFAULT FALSE,
  status          TEXT DEFAULT 'open' CHECK (status IN ('open', 'linked', 'cancelled')),
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Allow GRNs to reference a weigh bridge ticket
ALTER TABLE goods_received_notes ADD COLUMN IF NOT EXISTS weigh_bridge_ticket_id UUID REFERENCES weigh_bridge_tickets(id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_wb_tickets_status ON weigh_bridge_tickets (status);
CREATE INDEX IF NOT EXISTS idx_wb_tickets_ticket_no ON weigh_bridge_tickets (ticket_no);
CREATE INDEX IF NOT EXISTS idx_grns_wb_ticket ON goods_received_notes (weigh_bridge_ticket_id);

-- RLS: all authenticated users can read/insert
ALTER TABLE weigh_bridge_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "WB tickets readable by authenticated" ON weigh_bridge_tickets
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "WB tickets insertable by authenticated" ON weigh_bridge_tickets
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "WB tickets updatable by authenticated" ON weigh_bridge_tickets
  FOR UPDATE USING (auth.role() = 'authenticated');
