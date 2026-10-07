// Read-only Sage manufacturing master-data readiness inspection.
// This is deliberately separate from the bridge worker: it never writes to
// Sage or Supabase and does not trigger any MES events.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'sage-sdk-api', '.env') });

const sql = require('mssql');

const sageConfig = {
  server: process.env.SAGE_SERVER || process.env.HYPER_SAGE_SERVER || 'localhost',
  port: Number(process.env.SAGE_PORT || process.env.HYPER_SAGE_PORT || 1433),
  database: process.env.SAGE_DATABASE || process.env.HYPER_SAGE_COMPANY_DATABASE,
  user: process.env.SAGE_USER || process.env.HYPER_SAGE_SQL_USERNAME,
  password: process.env.SAGE_PASSWORD || process.env.HYPER_SAGE_SQL_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
};

function configured(value) {
  return value ? 'configured' : 'missing';
}

async function inspect() {
  if (!sageConfig.database || !sageConfig.user || !sageConfig.password) {
    throw new Error('Sage connection settings are incomplete. Check the server bridge .env files.');
  }

  console.log('PlantControl Sage manufacturing-source inspection');
  console.log('Mode: READ ONLY. No Sage, Supabase, or bridge-worker writes are performed.');
  console.table([{
    sage_server: `${sageConfig.server}:${sageConfig.port}`,
    sage_database: sageConfig.database,
    sage_environment: process.env.HYPER_SAGE_ENVIRONMENT || process.env.SAGE_EXPECTED_ENVIRONMENT || 'not set',
    configured_user: configured(sageConfig.user),
    supabase_target: process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : 'not set',
    dry_run: process.env.DRY_RUN || 'not set',
    master_sync_enabled: process.env.SAGE_MASTER_SYNC_ENABLED || 'not set',
  }]);

  const pool = await sql.connect(sageConfig);
  const result = await pool.request().query(`
    ;WITH expected AS (
      SELECT v.table_name
      FROM (VALUES
        ('BomMast'),
        ('BomComp'),
        ('_etblManufProcess'),
        ('_etblManufProcessLine')
      ) AS v(table_name)
    ), present AS (
      SELECT s.name AS schema_name, t.name AS table_name, t.object_id
      FROM sys.tables AS t
      INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
    )
    SELECT
      e.table_name,
      p.schema_name,
      CASE WHEN p.object_id IS NULL THEN 'MISSING' ELSE 'AVAILABLE' END AS availability,
      COUNT(DISTINCT c.column_id) AS column_count,
      COALESCE(MAX(row_count.source_row_count), 0) AS source_row_count
    FROM expected AS e
    LEFT JOIN present AS p ON p.table_name = e.table_name
    LEFT JOIN sys.columns AS c ON c.object_id = p.object_id
    OUTER APPLY (
      SELECT SUM(part.rows) AS source_row_count
      FROM sys.partitions AS part
      WHERE part.object_id = p.object_id
        AND part.index_id IN (0, 1)
    ) AS row_count
    GROUP BY e.table_name, p.schema_name, p.object_id
    ORDER BY e.table_name;

    SELECT
      t.name AS table_name,
      c.column_id,
      c.name AS column_name,
      ty.name AS data_type,
      c.max_length,
      c.is_nullable
    FROM sys.tables AS t
    INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
    INNER JOIN sys.columns AS c ON c.object_id = t.object_id
    INNER JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
    WHERE t.name IN ('BomMast', 'BomComp', '_etblManufProcess', '_etblManufProcessLine')
    ORDER BY t.name, c.column_id;

    SELECT DB_NAME() AS connected_database, @@SERVERNAME AS connected_server;
  `);

  console.log('\nTable availability');
  console.table(result.recordsets[0]);
  console.log('\nColumn map');
  console.table(result.recordsets[1]);
  console.log('\nConnection confirmation');
  console.table(result.recordsets[2]);

  const available = result.recordsets[0].filter((row) => row.availability === 'AVAILABLE');
  if (available.length !== 4) {
    throw new Error('One or more expected Sage manufacturing tables are absent. Do not enable formula or production-history import.');
  }

  console.log('\nPASS: Sage manufacturing source tables are available for read-only mapping.');
}

inspect()
  .catch((error) => {
    console.error(`\nFAIL: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await sql.close(); } catch (_) { /* nothing to close */ }
  });
