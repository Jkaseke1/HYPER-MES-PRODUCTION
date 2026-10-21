// Isolated PostgreSQL only. Does not connect to Supabase or Sage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(require.resolve('@electric-sql/pglite', { paths: ['.tmp/grn-db-tests', process.cwd()] }));
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
        SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
      CREATE FUNCTION public.has_mes_role(text[]) RETURNS boolean LANGUAGE sql AS $$
        SELECT current_setting('test.role', true) = ANY($1) $$;
      CREATE TABLE public.inbound_transporters(id uuid PRIMARY KEY, transporter_code text,
        name text, default_currency text, is_active boolean);
      ALTER TABLE public.inbound_transporters ENABLE ROW LEVEL SECURITY;
      INSERT INTO public.inbound_transporters VALUES
        ('10000000-0000-0000-0000-000000000001','LUBL0001','LUBLINE','USD',true),
        ('10000000-0000-0000-0000-000000000002','NEW-002','Another Haulier','USD',true),
        ('10000000-0000-0000-0000-000000000003','OLD','Inactive Haulier','USD',false);
      SET test.uid = '20000000-0000-0000-0000-000000000001';
    `);
    const migration = fs.readFileSync('supabase/migrations/20261021130000_receiving_transporter_list_access.sql', 'utf8');
    await db.exec(migration);
    await db.exec('SET ROLE authenticated');
    for (const role of ['admin', 'raw_material_manager', 'rm_manager', 'weighbridge', 'weigh_bridge']) {
      await db.exec(`SET test.role = '${role}'`);
      const rows = (await db.query('SELECT * FROM list_inbound_transporters_for_weighbridge()')).rows;
      assert.equal(rows.length, 2);
      assert.equal(rows[0].name, 'Another Haulier');
      assert.equal(rows[1].transporter_code, 'LUBL0001');
      assert.deepEqual(Object.keys(rows[0]).sort(), ['default_currency', 'id', 'name', 'transporter_code']);
    }
    await assert.rejects(db.query('SELECT * FROM inbound_transporters'), /permission denied/);
    for (const role of ['finance', 'operator', 'warehouse_clerk']) {
      await db.exec(`SET test.role = '${role}'`);
      await assert.rejects(db.query('SELECT * FROM list_inbound_transporters_for_weighbridge()'), /Only Weighbridge/);
    }
    await db.exec(`SET test.role = 'raw_material_manager'; SET test.uid = ''`);
    await assert.rejects(db.query('SELECT * FROM list_inbound_transporters_for_weighbridge()'), /Only Weighbridge/);
    await db.exec(`RESET ROLE; SET test.uid = '20000000-0000-0000-0000-000000000001';
      ALTER TABLE inbound_transporters ADD COLUMN sage_registration_status text, ADD COLUMN sage_supplier_account text;
      UPDATE inbound_transporters SET sage_registration_status='verified', sage_supplier_account='SAGE-LUBL' WHERE transporter_code='LUBL0001';`);
    await db.exec(migration);
    assert.equal((await db.query('SELECT * FROM list_inbound_transporters_for_weighbridge()')).rows[1].transporter_code, 'SAGE-LUBL');
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM list_inbound_transporters_for_weighbridge()'), /permission denied/);
    console.log('PASS: RM/Admin/Weighbridge list access; no direct table access; active-only sorted operational fields; unauthorised/anonymous blocked; legacy and verified Sage codes preserved.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
