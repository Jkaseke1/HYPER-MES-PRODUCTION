// Isolated PostgreSQL tests. No Supabase connection or production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || require.resolve('@electric-sql/pglite', { paths: ['.tmp/grn-db-tests', process.cwd()] }));

(async () => {
  const db = new PGlite();
  const uid = '10000000-0000-0000-0000-000000000001';
  const grn = '20000000-0000-0000-0000-000000000001';
  const material = '30000000-0000-0000-0000-000000000001';
  const ticket = '40000000-0000-0000-0000-000000000001';
  const lineId = '50000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${uid}'::uuid $$;
      CREATE FUNCTION public.has_mes_role(text[]) RETURNS boolean LANGUAGE sql AS $$
        SELECT current_setting('test.role', true) = ANY($1) $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY);
      INSERT INTO profiles VALUES ('${uid}');
      CREATE TABLE suppliers(id uuid PRIMARY KEY);
      CREATE TABLE raw_materials(id uuid PRIMARY KEY, is_active boolean);
      INSERT INTO raw_materials VALUES ('${material}', true);
      CREATE FUNCTION public.grn_input_allowed(uuid) RETURNS boolean LANGUAGE sql AS $$
        SELECT EXISTS(SELECT 1 FROM raw_materials WHERE id=$1 AND is_active) $$;
      CREATE TABLE weigh_bridge_tickets(id uuid PRIMARY KEY, status text, supplier_id uuid,
        unregistered_supplier_name text, updated_at timestamptz);
      INSERT INTO weigh_bridge_tickets VALUES ('${ticket}', 'in_grn', NULL, 'Original', now());
      CREATE TABLE goods_received_notes(id uuid PRIMARY KEY, grn_number text, status text,
        received_by uuid, approved_at timestamptz, updated_at timestamptz,
        supplier_id uuid REFERENCES suppliers(id), unregistered_supplier_name text,
        weigh_bridge_ticket_id uuid REFERENCES weigh_bridge_tickets(id), received_date date,
        manual_grv_number text, notes text, total_value numeric,
        supplier_invoice_no text, supplier_delivery_note_no text, supplier_order_no text,
        external_reference text, costing_completed_by uuid, costing_completed_at timestamptz);
      INSERT INTO goods_received_notes(id,grn_number,status,received_by,updated_at,weigh_bridge_ticket_id)
        VALUES ('${grn}','TEST-GRV','pending_finance','${uid}',now(),'${ticket}');
      CREATE TABLE grn_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        grn_id uuid REFERENCES goods_received_notes(id), raw_material_id uuid REFERENCES raw_materials(id),
        ordered_qty numeric, received_qty numeric, unit_cost numeric, batch_number text,
        expiry_date date, line_total numeric);
      INSERT INTO grn_items VALUES ('${lineId}','${grn}','${material}',10,10,0,'',NULL,0);
      CREATE TABLE sync_log(reference_id uuid, event_type text);
      CREATE TABLE inbound_transport_claims(grn_id uuid);
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261020120000_atomic_grn_corrections.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261020133000_allow_empty_draft_grn_recovery.sql', 'utf8'));
    await db.exec(`SET test.role = 'raw_material_manager'`);
    const header = { supplier_id: null, unregistered_supplier_name: 'Correct supplier',
      weigh_bridge_ticket_id: ticket, received_date: '2026-10-13', manual_grv_number: 'HFGRV10406',
      notes: 'Corrected cost', supplier_invoice_no: 'INV-1' };
    const original = [{ id: lineId, raw_material_id: material, ordered_qty: 10, received_qty: 10,
      unit_cost: 0, batch_number: null, expiry_date: null }];
    const edited = original.map(x => ({ ...x, unit_cost: 2.5 }));
    const stamp = (await db.query('SELECT updated_at::text AS stamp FROM goods_received_notes')).rows[0].stamp;
    const save = (h = header, lines = edited, expected = original, time = stamp) => db.query(
      'SELECT save_grn_correction($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)',
      [grn, time, JSON.stringify(expected), JSON.stringify(h), JSON.stringify(lines)]);
    await db.exec(`SET test.role = 'operator'`);
    await assert.rejects(save(), /authorised manager/);
    await db.exec(`SET test.role = 'raw_material_manager'`);
    await assert.rejects(save(header, [{ ...edited[0], unit_cost: -1 }]), /Invalid/);
    await assert.rejects(save(header, []), /between 1 and 500/);
    await assert.rejects(save(header, [...edited, ...edited]), /Invalid/);
    await assert.rejects(save(header, edited, []), /not fully loaded/);
    await assert.rejects(save(header, edited, original, '2020-01-01'), /changed since opening/);
    await db.exec(`INSERT INTO sync_log VALUES ('${grn}','grn_confirmed')`);
    await assert.rejects(save(), /Sage queue history/);
    await db.exec('DELETE FROM sync_log');
    await db.exec(`UPDATE goods_received_notes SET status='approved'`);
    await assert.rejects(save(), /locked/);
    await db.exec(`UPDATE goods_received_notes SET status='pending_finance'`);
    // Force a failure after ticket changes: everything, including the ticket, must roll back.
    await assert.rejects(save({ ...header, supplier_id: '90000000-0000-0000-0000-000000000001' }), /foreign key/);
    assert.equal((await db.query('SELECT unregistered_supplier_name FROM weigh_bridge_tickets')).rows[0].unregistered_supplier_name, 'Original');
    assert.equal((await db.query('SELECT count(*)::int n FROM grn_correction_audit')).rows[0].n, 0);
    await save();
    const saved = (await db.query('SELECT * FROM goods_received_notes')).rows[0];
    assert.equal(saved.total_value, '25.0');
    assert.equal(saved.received_by, uid);
    assert.equal(saved.status, 'pending_costing');
    assert.equal(saved.supplier_invoice_no, 'INV-1');
    assert.equal((await db.query('SELECT count(*)::int n FROM grn_correction_audit')).rows[0].n, 1);
    await assert.rejects(save(), /changed since opening/);
    const newStamp = (await db.query('SELECT updated_at::text AS stamp FROM goods_received_notes')).rows[0].stamp;
    await db.exec(`SET test.role='rm_manager'`);
    await save(header, [{ ...edited[0], id: null, received_qty: 20 }], edited, newStamp);
    assert.equal((await db.query('SELECT count(*)::int n FROM grn_items')).rows[0].n, 1);
    assert.notEqual((await db.query('SELECT id FROM grn_items')).rows[0].id, lineId);
    await db.query('SELECT submit_grn_for_finance($1)', [grn]);
    assert.equal((await db.query('SELECT status FROM goods_received_notes')).rows[0].status, 'pending_finance');
    // An incomplete draft can be repaired, but cannot be saved/submitted without real lines.
    await db.exec(`DELETE FROM grn_items; UPDATE goods_received_notes SET status='pending_costing'`);
    await assert.rejects(db.query('SELECT submit_grn_for_finance($1)', [grn]), /positive unit cost/);
    const emptyStamp = (await db.query('SELECT updated_at::text AS stamp FROM goods_received_notes')).rows[0].stamp;
    await assert.rejects(save(header, [], [], emptyStamp), /between 1 and 500/);
    await save(header, [{ ...edited[0], id: null, received_qty: 30 }], [], emptyStamp);
    assert.equal((await db.query('SELECT total_value FROM goods_received_notes')).rows[0].total_value, '75.0');
    assert.equal((await db.query('SELECT count(*)::int n FROM grn_items')).rows[0].n, 1);
    const recoveredStamp = (await db.query('SELECT updated_at::text AS stamp FROM goods_received_notes')).rows[0].stamp;
    await assert.rejects(save(header, [{ ...edited[0], id: null }], [], recoveredStamp), /not fully loaded/);
    console.log('PASS: empty draft recovery preserves receipt identity; zero-line submission and hidden/stale line overwrite remain blocked.');
    await db.exec(`
      ALTER TABLE weigh_bridge_tickets ADD COLUMN inbound_transport_mode text DEFAULT 'company_hired',
        ADD COLUMN driver_signed boolean DEFAULT true, ADD COLUMN nett_mass numeric DEFAULT 20000,
        ADD COLUMN inbound_transporter_id uuid DEFAULT '${material}';
      CREATE TABLE inbound_transporters(id uuid PRIMARY KEY, is_active boolean);
      INSERT INTO inbound_transporters VALUES ('${material}', true);
      ALTER TABLE inbound_transport_claims ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ADD COLUMN claim_number text, ADD COLUMN weigh_bridge_ticket_id uuid UNIQUE,
        ADD COLUMN transporter_id uuid, ADD COLUMN net_mass_kg numeric,
        ADD COLUMN rate_per_tonne numeric(14,4) NOT NULL DEFAULT 0,
        ADD COLUMN calculated_amount numeric(14,2), ADD COLUMN currency_code text NOT NULL,
        ADD COLUMN invoice_number text, ADD COLUMN waybill_reference text,
        ADD COLUMN notes text, ADD COLUMN status text DEFAULT 'draft', ADD COLUMN created_by uuid,
        ADD COLUMN review_note text, ADD COLUMN updated_at timestamptz;
      CREATE UNIQUE INDEX test_claim_grn ON inbound_transport_claims(grn_id);
      CREATE TABLE inbound_transport_claim_history(claim_id uuid, action text, from_status text,
        to_status text, note text, changed_by uuid);
      CREATE FUNCTION next_inbound_transport_claim_number() RETURNS text LANGUAGE sql AS $$ SELECT 'TEST-FREIGHT' $$;
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261019170000_guard_grn_transport_detail_edits.sql', 'utf8'));
    await db.exec(fs.readFileSync('docs/sql/apply-live-grv-editor-flat-transport.sql', 'utf8'));
    const freight = (id, amount = 125) => db.query('SELECT save_inbound_transport_flat_claim($1,$2,$3,$4,$5,$6,$7,$8) id',
      [id, ticket, material, amount, 'USD', 'FREIGHT-1', 'WB-1', 'Flat delivery']);
    for (const role of ['admin', 'raw_material_manager', 'rm_manager']) {
      await db.exec(`SET test.role = '${role}'`);
      const snapshot = (await db.query('SELECT get_grn_correction($1) snapshot', [grn])).rows[0].snapshot;
      assert.equal(snapshot.lines.length, 1);
      assert.equal(snapshot.header.received_by, uid);
    }
    await db.exec(`SET test.role = 'warehouse_clerk'`);
    await assert.rejects(freight(null), /Only Raw Materials/);
    await assert.rejects(db.query('SELECT get_grn_correction($1)', [grn]), /permission/);
    await db.exec(`SET test.role = 'raw_material_manager'`);
    await assert.rejects(freight(null, 0), /positive flat/);
    await assert.rejects(freight(null, 'NaN'), /positive flat/);
    const claimId = (await freight(null)).rows[0].id;
    let claim = (await db.query('SELECT * FROM inbound_transport_claims')).rows[0];
    assert.equal(claim.calculated_amount, '125.00'); // 20 tonnes must NOT multiply the delivery amount.
    assert.equal(claim.rate_per_tonne, '0.0000');
    assert.equal(claim.pricing_basis, 'flat');
    await assert.rejects(freight(null), /claim changed/);
    await db.exec(`SET test.role = 'admin'`);
    await freight(claimId, 200);
    assert.equal((await db.query('SELECT calculated_amount FROM inbound_transport_claims')).rows[0].calculated_amount, '200.00');
    assert.equal((await db.query('SELECT count(*)::int n FROM inbound_transport_claim_history')).rows[0].n, 1);
    await db.exec(`UPDATE inbound_transport_claims SET status='submitted'`);
    await assert.rejects(freight(claimId), /Only draft or rejected/);
    await assert.rejects(db.exec(`UPDATE inbound_transport_claims SET pricing_basis='per_tonne', rate_per_tonne=5`), /locked/);
    await db.exec(`UPDATE inbound_transport_claims SET status='draft'; UPDATE goods_received_notes SET status='approved'`);
    await assert.rejects(freight(claimId), /locked after GRN/);
    await db.exec(`UPDATE goods_received_notes SET status='pending_costing'; INSERT INTO sync_log VALUES ('${grn}', 'grn_confirmed')`);
    await assert.rejects(freight(claimId), /Sage queue history/);
    await db.exec(`DELETE FROM sync_log; UPDATE inbound_transport_claims SET pricing_basis='per_tonne', rate_per_tonne=7, calculated_amount=140`);
    // Applying the additive migration again must not reinterpret legacy freight.
    await db.exec(fs.readFileSync('supabase/migrations/20261021110000_flat_grv_transport_and_editor_access.sql', 'utf8'));
    claim = (await db.query('SELECT * FROM inbound_transport_claims')).rows[0];
    assert.equal(claim.pricing_basis, 'per_tonne');
    assert.equal(claim.calculated_amount, '140.00');
    await db.exec(`ALTER TABLE grn_items ENABLE ROW LEVEL SECURITY; GRANT SELECT ON grn_items TO authenticated;
      GRANT USAGE ON SCHEMA public TO authenticated; SET ROLE authenticated`);
    assert.equal((await db.query('SELECT * FROM grn_items')).rows.length, 0);
    assert.equal((await db.query('SELECT get_grn_correction($1) snapshot', [grn])).rows[0].snapshot.lines.length, 1);
    await db.exec('RESET ROLE');
    console.log('PASS: admin/RM editor snapshot bypasses hidden-line ambiguity; flat freight, legacy preservation, audit, roles, duplicate claim and approval/Sage locks.');
    console.log('PASS: RM roles, full receipt edits, costs, line replacement, totals, audit, stale/empty/invalid/approved/queued rejection and atomic rollback.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
