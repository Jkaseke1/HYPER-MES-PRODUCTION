const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(require.resolve('@electric-sql/pglite', { paths: ['.tmp/grn-db-tests', process.cwd()] }));
(async () => {
  const db = new PGlite();
  const soya = 'fa6805a7-07af-4e50-b22c-61aa6a020657';
  const feed = '10000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE raw_materials(id uuid PRIMARY KEY, code text, sage_code text, name text, category text, is_active boolean);
      CREATE TABLE formulations(id uuid PRIMARY KEY, code text, sage_code text, name text);
      CREATE TABLE goods_received_notes(id uuid PRIMARY KEY, status text);
      CREATE TABLE grn_items(id uuid PRIMARY KEY, grn_id uuid, raw_material_id uuid);
      INSERT INTO raw_materials VALUES
        ('${soya}', 'FFS0001', '', 'Full Fat Soya Meal', 'protein', true),
        ('${feed}', 'BGC50', 'BGC50', 'Broiler Grower Crumbs 50kg', 'finished_goods', true);
      INSERT INTO formulations VALUES
        ('90d11c8b-c916-47b8-bb8f-703a2ea23b41', 'FFS0001', 'FFS0001', 'Full Fat Soya Meal'),
        ('20000000-0000-0000-0000-000000000001', 'BGC50', 'BGC50', 'Broiler Grower Crumbs 50kg');
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261014120000_guard_grn_input_items.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261014130000_exclude_recycled_feed_grn_inputs.sql', 'utf8'));
    const allowed = async id => (await db.query('SELECT grn_input_allowed($1) AS allowed', [id])).rows[0].allowed;
    assert.equal(await allowed(soya), false, 'Reproduce existing formulation conflict');
    const before = await db.query('SELECT * FROM raw_materials ORDER BY id');
    const migration = fs.readFileSync('supabase/migrations/20261021160000_allow_purchased_full_fat_soya_grn.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await db.query('SELECT * FROM raw_materials ORDER BY id')).rows, before.rows);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM formulations')).rows[0].n, 2);
    assert.equal(await allowed(soya), true);
    assert.equal(await allowed(feed), false);
    await db.exec(`INSERT INTO goods_received_notes VALUES ('${soya}', 'pending_costing');
      INSERT INTO grn_items VALUES ('${soya}', '${soya}', '${soya}');
      UPDATE goods_received_notes SET status='approved' WHERE id='${soya}';`);
    await assert.rejects(db.exec(`INSERT INTO grn_items VALUES ('${feed}', '${soya}', '${feed}')`), /Finished feeds/);
    await db.exec(`UPDATE raw_materials SET is_active=false WHERE id='${soya}'`);
    assert.equal(await allowed(soya), false);
    await db.exec(`UPDATE raw_materials SET is_active=true, category='finished_goods' WHERE id='${soya}'`);
    assert.equal(await allowed(soya), false);
    console.log('PASS: original FFS0001 conflict reproduced; purchase/approval allowed after repair; formulation and material records unchanged; inactive and finished-feed guards retained; migration idempotent. Local fixture only.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
