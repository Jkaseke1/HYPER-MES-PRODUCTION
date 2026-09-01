const { sql, sageConfig, supabase } = require('./lib/db');

async function syncRawMaterials() {
  console.log('📦 Syncing raw materials from Sage...');
  
  const pool = await sql.connect(sageConfig);
  const result = await pool.request().query(`
    SELECT 
      StockLink AS code,
      Description_1 AS name,
      Description_2 AS description
    FROM StkItem
    WHERE StockLink IS NOT NULL
    ORDER BY StockLink
  `);

  let inserted = 0;
  let updated = 0;

  for (const row of result.recordset) {
    const { data, error } = await supabase
      .from('raw_materials')
      .upsert({
        code: row.code,
        name: row.name || row.code,
        description: row.description || '',
        unit: 'kg',
        reorder_level: 0,
        current_stock: 0
      }, { 
        onConflict: 'code',
        ignoreDuplicates: false 
      })
      .select();

    if (error) {
      console.error(`  ❌ Error syncing ${row.code}:`, error.message);
    } else {
      if (data && data.length > 0) {
        inserted++;
      } else {
        updated++;
      }
    }
  }
  
  console.log(`  ✓ Synced ${result.recordset.length} raw materials (${inserted} new, ${updated} updated)`);
}

async function syncSuppliers() {
  console.log('🏢 Syncing suppliers from Sage...');
  
  const pool = await sql.connect(sageConfig);
  const result = await pool.request().query(`
    SELECT 
      Account AS code,
      Name AS name,
      Physical1 AS address_line1,
      Physical2 AS address_line2,
      Physical3 AS address_line3,
      Physical4 AS city,
      Physical5 AS postal_code,
      Telephone AS phone
    FROM Vendor
    WHERE Account IS NOT NULL
    ORDER BY Account
  `);

  let inserted = 0;
  let updated = 0;

  for (const row of result.recordset) {
    const address = [row.address_line1, row.address_line2, row.address_line3]
      .filter(Boolean)
      .join(', ');

    const { data, error } = await supabase
      .from('suppliers')
      .upsert({
        code: row.code,
        name: row.name || row.code,
        address: address || '',
        phone: row.phone || ''
      }, { 
        onConflict: 'code',
        ignoreDuplicates: false 
      })
      .select();

    if (error) {
      console.error(`  ❌ Error syncing ${row.code}:`, error.message);
    } else {
      if (data && data.length > 0) {
        inserted++;
      } else {
        updated++;
      }
    }
  }
  
  console.log(`  ✓ Synced ${result.recordset.length} suppliers (${inserted} new, ${updated} updated)`);
}

async function main() {
  console.log('🚀 Starting master data sync from Sage to Supabase...\n');
  
  try {
    await syncRawMaterials();
    console.log('');
    await syncSuppliers();
    console.log('\n✅ Master data sync complete!');
  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);
    console.error(error);
    process.exit(1);
  }
  
  process.exit(0);
}

main();
