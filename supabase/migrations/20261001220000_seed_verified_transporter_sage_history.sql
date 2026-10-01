-- User-verified SSMS extract from Hyperfeeds 2024, captured 2026-10-01.
-- PlantControl reporting only: no bridge events, claims, payments or Sage writes.
BEGIN;

ALTER TABLE public.inbound_transporters
  ADD COLUMN IF NOT EXISTS sage_supplier_account text,
  ADD COLUMN IF NOT EXISTS sage_supplier_link integer;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_transporters_sage_supplier
  ON public.inbound_transporters (lower(btrim(sage_supplier_account)))
  WHERE sage_supplier_account IS NOT NULL;

DO $$
DECLARE
  seed record;
  matched_ids uuid[];
  matched_id uuid;
BEGIN
  FOR seed IN SELECT * FROM (VALUES
    ('DUMB0001', 23008, 'DUMBARIMWE TRANSPORT'),
    ('LUBL0001', 22992, 'LUBLINE'),
    ('LUL0001', 22998, 'LULO TRANSPORT'),
    ('PAR0001', 189, 'PARACLETE INVESTMENTS'),
    ('SEAR0001', 22991, 'SEARCHCRAFT TRADING')
  ) AS suppliers(account, link, name)
  LOOP
    SELECT array_agg(id) INTO matched_ids
    FROM public.inbound_transporters
    WHERE lower(btrim(sage_supplier_account)) = lower(seed.account)
      OR lower(btrim(transporter_code)) = lower(seed.account)
      OR lower(btrim(account_reference)) = lower(seed.account)
      OR lower(btrim(name)) = lower(seed.name)
      OR lower(btrim(legal_name)) = lower(seed.name);

    IF coalesce(cardinality(matched_ids), 0) > 1 THEN
      RAISE EXCEPTION 'Multiple PlantControl transporters match %. Resolve before import.', seed.account;
    END IF;

    matched_id := matched_ids[1];
    IF matched_id IS NULL THEN
      INSERT INTO public.inbound_transporters (
        transporter_code, name, sage_supplier_account, sage_supplier_link, notes
      ) VALUES (
        seed.account, seed.name, seed.account, seed.link,
        'Supplier identity verified from Sage SSMS extract on 2026-10-01. Confirm local currency, payment terms and legal/contact details before a new claim.'
      );
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.inbound_transporters
        WHERE id = matched_id AND (
          (sage_supplier_account IS NOT NULL AND lower(btrim(sage_supplier_account)) <> lower(seed.account))
          OR (sage_supplier_link IS NOT NULL AND sage_supplier_link <> seed.link)
        )
      ) THEN
        RAISE EXCEPTION 'Conflicting Sage identity on transporter %. Import cancelled.', seed.account;
      END IF;
      UPDATE public.inbound_transporters
      SET sage_supplier_account = seed.account, sage_supplier_link = seed.link
      WHERE id = matched_id;
    END IF;
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS public.inbound_transport_sage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_database text NOT NULL,
  supplier_account text NOT NULL,
  transaction_date date NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('APTx', 'CBAP')),
  description text NOT NULL,
  reference text NOT NULL,
  batch_reference text NOT NULL,
  audit_number text NOT NULL,
  debit numeric(18,2) NOT NULL,
  credit numeric(18,2) NOT NULL,
  outstanding_at_extract numeric(18,2) NOT NULL,
  sage_currency_id integer NOT NULL,
  posting_user text NOT NULL,
  extracted_at timestamptz NOT NULL,
  source_table text NOT NULL DEFAULT 'PostAP' CHECK (source_table = 'PostAP'),
  UNIQUE (company_database, supplier_account, audit_number, transaction_type)
);

ALTER TABLE public.inbound_transport_sage_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbound_transport_sage_history FROM anon, authenticated;
GRANT SELECT ON public.inbound_transport_sage_history TO authenticated;
DROP POLICY IF EXISTS inbound_transport_sage_history_admin_read ON public.inbound_transport_sage_history;
CREATE POLICY inbound_transport_sage_history_admin_read
  ON public.inbound_transport_sage_history FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin']));

INSERT INTO public.inbound_transport_sage_history (
  company_database, supplier_account, transaction_date, transaction_type,
  description, reference, batch_reference, audit_number, debit, credit,
  outstanding_at_extract, sage_currency_id, posting_user, extracted_at
) VALUES
  ('Hyperfeeds 2024', 'DUMB0001', '2026-09-22', 'APTx', 'NAT FOODS W/BRAN FREIGHT GRV10383', 'INV318', 'APBR810', '223533.0001', 0, 1000, 1000, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'DUMB0001', '2026-09-22', 'APTx', 'NAT FOODS W/BRAN FREIGHT GRV10379', 'INV318', 'APBR810', '223533.0002', 0, 1000, 1000, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUBL0001', '2026-09-03', 'CBAP', 'LUBLINE S/MEAL FREIGHT 11043', 'HFPR23411', 'CBR09848', '221672.0113', 300, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUBL0001', '2026-09-03', 'CBAP', 'LUBLINE W/BRAN FREIGHT11046', 'HFPR23410', 'CBR09848', '221672.0115', 300, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUBL0001', '2026-09-03', 'APTx', 'NAT FOODS W/BRAN FREIGHT GRV10328', '0017', 'APBR799', '222488.0002', 0, 300, 300, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUBL0001', '2026-09-11', 'CBAP', 'LUBLINE NAT FOODS W/BRAN FREIGHT GRV11038', 'HFPR23289', 'CBR09985', '222597.0049', 300, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUBL0001', '2026-09-17', 'APTx', 'ZIMGOLD S/MEAL FREIGHT GRV10358', '0019', 'APBR807', '223001.0001', 0, 300, 300, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUBL0001', '2026-09-21', 'APTx', 'ZIMGOLD S/MEAL FREIGHT GRV10375', '0020', 'APBR813', '223859.0016', 0, 300, 300, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUL0001', '2026-09-01', 'APTx', 'NAT FOODS W/BRAN FREIGHT GRV11074', 'LT2824', 'APBR809', '223379.0002', 0, 300, 300, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUL0001', '2026-09-04', 'CBAP', 'LULO TRANSP NAT FOODS W/BRAN 11042', 'HFPR23436', 'CBR09848', '221672.0116', 300, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUL0001', '2026-09-07', 'APTx', 'NAT FOODS W/BRAN FREIGHT GRV10342', 'LT2829', 'APBR809', '223379.0003', 0, 300, 300, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUL0001', '2026-09-07', 'APTx', 'NAT FOODS W/BRAN FREIGHT GRV10346', 'LT2830', 'APBR809', '223379.0004', 0, 300, 300, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'LUL0001', '2026-09-11', 'CBAP', 'LULO TRANSP NAT FOODS W/BRAN 11039', 'HFPR23437', 'CBR09985', '222597.0050', 300, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'PAR0001', '2026-09-01', 'APTx', 'PARACLETE TARMOOD W/BRAN GRV11032 18/8', 'DOC20260818', 'APBR801', '222627.0002', 0, 260, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'PAR0001', '2026-09-11', 'APTx', 'S/WILMAR, Z/GOLD, RIVERTON FREIGHT', 'DOC20260911', 'APBR801', '222627.0001', 0, 1700, 1115.5, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'PAR0001', '2026-09-21', 'CBAP', 'PARACLETE FREIGHT', 'HFPR23557', 'CBR10103', '223765.0004', 200, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'PAR0001', '2026-09-22', 'CBAP', 'PARACLETE FREIGHT', 'HFPR24067', 'CBR10103', '223765.0003', 650, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'PAR0001', '2026-09-23', 'APTx', 'PARACLETE B/RIBBON, MUTARE, CHEGUTU FARM', 'DOC20260923', 'APBR812', '223761.0002', 0, 1900, 1900, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'PAR0001', '2026-09-23', 'CBAP', 'PARACLETE FREIGHT', 'HFPR24456', 'CBR10103', '223765.0002', 620, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'PAR0001', '2026-09-25', 'CBAP', 'PARACLETE FREIGHT', 'HFPR24551', 'CBR10103', '223765.0005', 620, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'PAR0001', '2026-09-28', 'CBAP', 'PARACLETE FREIGHT', 'HFPR24462', 'CBR10103', '223765.0001', 350, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'SEAR0001', '2026-09-03', 'CBAP', 'SEARCHCRAFT TRADING S/MEAL FREIGHT 11056/66', 'HFPR23453', 'CBR09848', '221672.0158', 520, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'SEAR0001', '2026-09-08', 'APTx', 'SURFACE S/MEAL FRHT GRV10338/10336/10341', '636', 'APBR809', '223379.0001', 0, 780, 780, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'SEAR0001', '2026-09-09', 'APTx', 'SURFACE SOYA MEAL FREIGHT GRV10347/10350', '637', 'APBR799', '222488.0001', 0, 520, 520, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'SEAR0001', '2026-09-09', 'CBAP', 'SEARCHCRAFT TRADING S/MEAL FREIGHT GRV11067', 'HFPR23453', 'CBR09985', '222597.0029', 260, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00'),
  ('Hyperfeeds 2024', 'SEAR0001', '2026-09-09', 'CBAP', 'SEARCRAFT TRADING S/MEAL FREIGHT GRV11028', 'HFPR23253', 'CBR09985', '222597.0030', 260, 0, 0, 0, 'OwenC', '2026-10-01T21:23:45.848802+02:00')
ON CONFLICT (company_database, supplier_account, audit_number, transaction_type) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;

