const { sql, sageConfig, supabase } = require('./lib/db');

const parseList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
const SYNC_CODES = parseList(process.env.SAGE_MASTER_SYNC_CODES);
const SYNC_PREFIXES = parseList(process.env.SAGE_MASTER_SYNC_PREFIXES);

function isInSyncScope(code) {
  const normalized = String(code || '').trim().toUpperCase();
  return SYNC_CODES.includes(normalized) || SYNC_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

async function syncRawMaterials() {
  console.log('📦 Syncing Sage inventory items into PlantControl...');
  const pool = await sql.connect(sageConfig);
  const result = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(StockLink)) AS code,
      LTRIM(RTRIM(Description_1)) AS name,
      LTRIM(RTRIM(Description_2)) AS description
    FROM StkItem
    WHERE StockLink IS NOT NULL AND LTRIM(RTRIM(StockLink)) <> ''
    ORDER BY StockLink
  `);

  if (SYNC_CODES.length === 0 && SYNC_PREFIXES.length === 0) {
    console.warn('  Sage master sync skipped: configure SAGE_MASTER_SYNC_CODES or SAGE_MASTER_SYNC_PREFIXES; no items will be imported.');
    return { synced: 0, sourceCount: result.recordset.length, skipped: true };
  }

  const items = result.recordset.filter((row) => isInSyncScope(row.code)).map((row) => ({
    code: String(row.code || '').trim(),
    sage_code: String(row.code || '').trim(),
    name: String(row.name || row.code || '').trim(),
    description: String(row.description || '').trim(),
    unit: 'kg',
    is_active: true,
    updated_at: new Date().toISOString(),
  })).filter((item) => item.code && item.name);

  let synced = 0;
  for (let index = 0; index < items.length; index += 500) {
    const { error } = await supabase
      .from('raw_materials')
      .upsert(items.slice(index, index + 500), {
        onConflict: 'code',
        ignoreDuplicates: false,
      });

    if (error) throw error;
    synced += Math.min(500, items.length - index);
    console.log(`  Synced ${synced}/${items.length} inventory items`);
  }

  console.log(`  ✓ Sage inventory items in scope: ${items.length}/${result.recordset.length}. Existing PlantControl items were updated; missing items were added. No items were deleted.`);
  return { synced, sourceCount: result.recordset.length, skipped: false };
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

async function syncMasterData() {
  console.log('🚀 Starting master data sync from Sage to Supabase...\n');
  const rawMaterials = await syncRawMaterials();
  return { rawMaterials };
}

module.exports = { syncRawMaterials, syncSuppliers, syncMasterData };

if (require.main === module) {
  syncMasterData()
    .then(() => console.log('\n✅ Master data sync complete!'))
    .catch((error) => {
      console.error('\n❌ Sync failed:', error.message);
      console.error(error);
      process.exitCode = 1;
    });
}
