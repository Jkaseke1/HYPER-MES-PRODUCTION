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
    console.log('PASS: RM roles, full receipt edits, costs, line replacement, totals, audit, stale/empty/invalid/approved/queued rejection and atomic rollback.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
