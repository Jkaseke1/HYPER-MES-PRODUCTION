// Run with @electric-sql/pglite available on NODE_PATH; never contacts LIVE.
const { PGlite } = require('@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const db = new PGlite();
  const user = '00000000-0000-0000-0000-000000000001';
  const maize = '00000000-0000-0000-0000-000000000002';
  const salt = '00000000-0000-0000-0000-000000000003';
  const packaging = '00000000-0000-0000-0000-000000000004';
  await db.exec(`CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${user}'::uuid $$;
    CREATE FUNCTION public.has_mes_role(text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY);
    INSERT INTO profiles VALUES('${user}');
    CREATE TABLE raw_materials(id uuid PRIMARY KEY,name text,category text);
    INSERT INTO raw_materials VALUES('${maize}','Maize','raw'),('${salt}','Salt','raw'),('${packaging}','PACKAGING ASSORTED50KG','packaging');`);
  await db.exec(fs.readFileSync('supabase/migrations/20260316214826_create_formulations_tables.sql','utf8'));
  await db.exec(`ALTER TABLE formulations ADD COLUMN sage_code text, ADD COLUMN unit_size_variants jsonb;
    ALTER TABLE formulation_ingredients ADD COLUMN is_active boolean DEFAULT true;`);
  const specs = fs.readFileSync('supabase/migrations/20260918090000_separate_formula_input_from_bom.sql','utf8');
  await db.exec(specs.slice(0,specs.indexOf('ALTER TABLE public.formula_specs ENABLE')));
  const migration = fs.readFileSync('supabase/migrations/20261012120000_atomic_formula_versions.sql','utf8');
  await db.exec(migration);
  await db.exec(migration); // Rerunnable without touching recipes.
  const payload = { name:'Test formula',code:'TEST',sage_code:'TEST',category:'broiler',description:'Recipe',batch_size:1000,batch_unit:'kg',unit_size_variants:null,target_protein:0,target_fat:0,target_fiber:0,target_moisture:0,estimated_cost_per_unit:0 };
  const bom = [
    { raw_material_id:maize,quantity:600,unit:'kg',percentage:60,is_critical:false,notes:'',sort_order:0 },
    { raw_material_id:salt,quantity:400,unit:'kg',percentage:40,is_critical:false,notes:'',sort_order:1 },
    { raw_material_id:packaging,quantity:25,unit:'kg',percentage:0,is_critical:false,notes:'',sort_order:2 },
  ];
  const save = async (source, formula=payload, lines=bom) => (await db.query('select * from save_formula_revision($1,$2,$3)',[source,formula,lines])).rows[0];
  const first = await save(null);
  assert.equal(first.version,1);
  await db.query('select activate_formula_revision($1)',[first.id]);
  assert.equal((await db.query('select is_daily_active from formulations where id=$1',[first.id])).rows[0].is_daily_active,true);
  assert.equal((await save(first.id)).id,first.id,'unchanged saves preserve version');
  const second = await save(first.id,{...payload,description:'Changed recipe'});
  assert.equal(second.version,2);
  assert.equal(second.status,'draft');
  assert.equal(second.approved_by,null);
  assert.equal(second.is_daily_active,false);
  assert.equal((await db.query('select description from formulations where id=$1',[first.id])).rows[0].description,'Recipe');
  assert.equal((await db.query('select count(*)::int as n from formulation_ingredients where formulation_id=$1',[first.id])).rows[0].n,3);
  await assert.rejects(db.query('select activate_formula_revision($1)',[first.id]),/latest formula version/);
  await db.query('select activate_formula_revision($1)',[second.id]);
  assert.equal((await db.query('select is_daily_active from formulations where id=$1',[first.id])).rows[0].is_daily_active,false);
  await assert.rejects(save(second.id,payload,bom.map((b,i)=>i===0?{...b,quantity:601}:b)),/mass must total/);
  await assert.rejects(save(second.id,payload,bom.map((b,i)=>i===0?{...b,unit:'each'}:b)),/kg mass units/);
  // Force a failure after inserting the revision: the entire transaction rolls back.
  await db.exec('ALTER TABLE formula_spec_lines ADD CONSTRAINT test_failure CHECK (quantity < 700)');
  const changed = bom.map((b,i)=>i===0?{...b,quantity:800,percentage:80}:i===1?{...b,quantity:200,percentage:20}:b);
  await assert.rejects(save(second.id,payload,changed),/test_failure/);
  assert.equal((await db.query('select count(*)::int as n from formulations')).rows[0].n,2);
  await db.exec('ALTER TABLE formula_spec_lines DROP CONSTRAINT test_failure');
  const third = await save(second.id,payload,changed);
  assert.equal(third.version,3);
  await db.exec('CREATE OR REPLACE FUNCTION public.has_mes_role(text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$');
  await assert.rejects(save(third.id),/Only Finance/);
  await assert.rejects(db.query('select activate_formula_revision($1)',[third.id]),/Only Finance/);
  await db.close();
  console.log('Formula SQL checks passed: packaging excluded, unchanged saves, sequential revisions, preserved originals, approval reset, latest-version activation, atomic rollback, authorization and rerunnable migration.');
})().catch(error => { console.error(error); process.exit(1); });
