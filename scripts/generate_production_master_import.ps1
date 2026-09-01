param(
  [Parameter(Mandatory = $true)]
  [string]$SourceCsv,

  [Parameter(Mandatory = $true)]
  [string]$OutputSql
)

$ErrorActionPreference = 'Stop'
$culture = [System.Globalization.CultureInfo]::InvariantCulture

function SqlText($value) {
  if ($null -eq $value) { return 'NULL' }
  return "'" + ([string]$value).Replace("'", "''") + "'"
}

function SqlUuid($value) {
  if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { return 'NULL' }
  return (SqlText ([string]$value)) + '::uuid'
}

function SqlNumber($value) {
  if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { return 'NULL' }
  return ([decimal]$value).ToString($culture)
}

function SqlBoolean($value) {
  if ($value -eq $true) { return 'true' }
  return 'false'
}

function AddInsertStatement($builder, $table, $columns, $valueRows) {
  [void]$builder.AppendLine("INSERT INTO public.$table ($($columns -join ', '))")
  [void]$builder.AppendLine('VALUES')
  for ($index = 0; $index -lt $valueRows.Count; $index++) {
    $suffix = if ($index -eq $valueRows.Count - 1) { ';' } else { ',' }
    [void]$builder.AppendLine('  (' + ($valueRows[$index] -join ', ') + ')' + $suffix)
  }
  [void]$builder.AppendLine()
}

$approvedBranchCodes = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@('AMT','BYO','CGV','CHK','CHR','DEB','DGM','DMK','DOM','EPW','FSH','GLD','GWR','HTC','KGV','MBR','MKN','MRD','MSA','MSV','MTR','NGZ','SHG','STW','SYM','ZVS')
)
$approvedWarehouseCodes = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@('AMT','BAK','BIN','BUFFER','BUL','CHI','CHK','CHR','CON','DAN','DEB','DG','DOM','DSP','EPW','FCS','GIT','GLE','GRA','GWE','HAT','KAG','KEN','MAIN','MAK','MAK002','MAR','MAS','MAZ','MBU','MP','MSA','MSTR','MUT','NGE','PD','PLU','PRO','PRODUCTION','RET','RM','SHO','SOU','VG','ZVI')
)

$rows = Import-Csv -LiteralPath $SourceCsv | ForEach-Object {
  [pscustomobject]@{
    source_table = $_.source_table
    data = $_.row_data | ConvertFrom-Json
  }
}

$branches = @($rows | Where-Object {
  $_.source_table -eq 'branches' -and $approvedBranchCodes.Contains([string]$_.data.code)
} | Sort-Object { $_.data.code })

$warehouses = @($rows | Where-Object {
  $_.source_table -eq 'warehouses' -and $approvedWarehouseCodes.Contains([string]$_.data.code)
} | Sort-Object { $_.data.code })

$suppliers = @($rows | Where-Object {
  $_.source_table -eq 'suppliers' -and
  $_.data.is_active -eq $true -and
  ([string]$_.data.code -ceq ([string]$_.data.code).Trim())
} | Sort-Object { $_.data.code })

$materials = @($rows | Where-Object {
  $_.source_table -eq 'raw_materials' -and $_.data.is_active -eq $true
} | Sort-Object { $_.data.code })

if ($branches.Count -ne 26) { throw "Expected 26 branches, found $($branches.Count)." }
if ($warehouses.Count -ne 45) { throw "Expected 45 warehouses, found $($warehouses.Count)." }
if ($suppliers.Count -ne 668) { throw "Expected 668 suppliers, found $($suppliers.Count)." }
if ($materials.Count -ne 426) { throw "Expected 426 raw materials, found $($materials.Count)." }

foreach ($group in @(
  [pscustomobject]@{ name = 'branches'; rows = $branches },
  [pscustomobject]@{ name = 'warehouses'; rows = $warehouses },
  [pscustomobject]@{ name = 'suppliers'; rows = $suppliers },
  [pscustomobject]@{ name = 'raw_materials'; rows = $materials }
)) {
  $duplicateCodes = @($group.rows | Group-Object { ([string]$_.data.code).Trim().ToUpperInvariant() } | Where-Object Count -gt 1)
  if ($duplicateCodes.Count -gt 0) {
    throw "Duplicate normalized code in $($group.name): $($duplicateCodes.Name -join ', ')."
  }
}

$approvedBranchIds = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@($branches | ForEach-Object { [string]$_.data.id })
)
$approvedWarehouseIds = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@($warehouses | ForEach-Object { [string]$_.data.id })
)
$sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $SourceCsv).Hash

$sql = [System.Text.StringBuilder]::new()
[void]$sql.AppendLine('-- Controlled PlantControl Production master-data import.')
[void]$sql.AppendLine('-- Approved: 2026-09-01. Source SHA256: ' + $sourceHash)
[void]$sql.AppendLine('-- Imports masters only. Stock and cost values are explicitly zeroed.')
[void]$sql.AppendLine('-- This transaction aborts unless all four target master tables are empty.')
[void]$sql.AppendLine()
[void]$sql.AppendLine('BEGIN;')
[void]$sql.AppendLine()
[void]$sql.AppendLine('DO $empty_guard$')
[void]$sql.AppendLine('BEGIN')
[void]$sql.AppendLine("  IF EXISTS (SELECT 1 FROM public.branches) OR")
[void]$sql.AppendLine("     EXISTS (SELECT 1 FROM public.warehouses) OR")
[void]$sql.AppendLine("     EXISTS (SELECT 1 FROM public.suppliers) OR")
[void]$sql.AppendLine("     EXISTS (SELECT 1 FROM public.raw_materials) THEN")
[void]$sql.AppendLine("    RAISE EXCEPTION 'Master-data import stopped: a target table is not empty.';")
[void]$sql.AppendLine('  END IF;')
[void]$sql.AppendLine('END')
[void]$sql.AppendLine('$empty_guard$;')
[void]$sql.AppendLine()

$branchValues = @($branches | ForEach-Object {
  $item = $_.data
  ,@(
    (SqlUuid $item.id), (SqlText $item.name), (SqlText $item.code),
    (SqlText $item.sage_code), (SqlText $item.sage_warehouse_code), (SqlNumber $item.sage_warehouse_id),
    (SqlText $item.address), (SqlText $item.contact_person), (SqlText $item.phone), 'true'
  )
})
AddInsertStatement $sql 'branches' @('id','name','code','sage_code','sage_warehouse_code','sage_warehouse_id','address','contact_person','phone','is_active') $branchValues

$warehouseValues = @($warehouses | ForEach-Object {
  $item = $_.data
  $branchId = if ($item.branch_id -and $approvedBranchIds.Contains([string]$item.branch_id)) { $item.branch_id } else { $null }
  ,@(
    (SqlUuid $item.id), (SqlText $item.name), (SqlText $item.code), (SqlText $item.type),
    (SqlUuid $branchId), (SqlText $item.location), (SqlText $item.sage_warehouse_code),
    (SqlNumber $item.sage_warehouse_id), 'true'
  )
})
AddInsertStatement $sql 'warehouses' @('id','name','code','type','branch_id','location','sage_warehouse_code','sage_warehouse_id','is_active') $warehouseValues

$supplierValues = @($suppliers | ForEach-Object {
  $item = $_.data
  ,@(
    (SqlUuid $item.id), (SqlText $item.name), (SqlText ([string]$item.code).Trim()),
    (SqlText $item.sage_code), (SqlText $item.contact_person), (SqlText $item.email),
    (SqlText $item.phone), (SqlText $item.address), (SqlText $item.payment_terms), 'true'
  )
})
AddInsertStatement $sql 'suppliers' @('id','name','code','sage_code','contact_person','email','phone','address','payment_terms','is_active') $supplierValues

$materialValues = @($materials | ForEach-Object {
  $item = $_.data
  $warehouseId = if ($item.warehouse_id -and $approvedWarehouseIds.Contains([string]$item.warehouse_id)) { $item.warehouse_id } else { $null }
  ,@(
    (SqlUuid $item.id), (SqlText $item.name), (SqlText $item.code), (SqlText $item.category),
    (SqlText $item.unit), '0', (SqlText 'USD'), '0', (SqlNumber $item.reorder_level),
    '0', '0', (SqlUuid $warehouseId), (SqlText $item.description), 'true'
  )
})
AddInsertStatement $sql 'raw_materials' @('id','name','code','category','unit','cost_per_unit','currency_code','cost_per_unit_usd','reorder_level','production_reorder_level','current_stock','warehouse_id','description','is_active') $materialValues

[void]$sql.AppendLine('DO $result_guard$')
[void]$sql.AppendLine('BEGIN')
[void]$sql.AppendLine("  IF (SELECT count(*) FROM public.branches) <> 26 OR")
[void]$sql.AppendLine("     (SELECT count(*) FROM public.warehouses) <> 45 OR")
[void]$sql.AppendLine("     (SELECT count(*) FROM public.suppliers) <> 668 OR")
[void]$sql.AppendLine("     (SELECT count(*) FROM public.raw_materials) <> 426 THEN")
[void]$sql.AppendLine("    RAISE EXCEPTION 'Master-data import validation failed: row counts differ from approval.';")
[void]$sql.AppendLine('  END IF;')
[void]$sql.AppendLine("  IF EXISTS (SELECT 1 FROM public.raw_materials WHERE current_stock <> 0 OR cost_per_unit <> 0 OR cost_per_unit_usd <> 0) THEN")
[void]$sql.AppendLine("    RAISE EXCEPTION 'Master-data import validation failed: stock or cost is non-zero.';")
[void]$sql.AppendLine('  END IF;')
[void]$sql.AppendLine('END')
[void]$sql.AppendLine('$result_guard$;')
[void]$sql.AppendLine()
[void]$sql.AppendLine('COMMIT;')
[void]$sql.AppendLine()
[void]$sql.AppendLine("NOTIFY pgrst, 'reload schema';")
[void]$sql.AppendLine()
[void]$sql.AppendLine("SELECT 'branches' AS check_name, count(*)::numeric AS result FROM public.branches")
[void]$sql.AppendLine("UNION ALL SELECT 'warehouses', count(*)::numeric FROM public.warehouses")
[void]$sql.AppendLine("UNION ALL SELECT 'suppliers', count(*)::numeric FROM public.suppliers")
[void]$sql.AppendLine("UNION ALL SELECT 'raw_materials', count(*)::numeric FROM public.raw_materials")
[void]$sql.AppendLine("UNION ALL SELECT 'raw_material_stock_total', COALESCE(sum(current_stock), 0) FROM public.raw_materials")
[void]$sql.AppendLine("UNION ALL SELECT 'raw_material_cost_total', COALESCE(sum(cost_per_unit), 0) FROM public.raw_materials")
[void]$sql.AppendLine('ORDER BY check_name;')

$outputDirectory = Split-Path -Parent $OutputSql
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }
[System.IO.File]::WriteAllText($OutputSql, $sql.ToString(), [System.Text.UTF8Encoding]::new($false))

Write-Output "Generated $OutputSql"
Write-Output "Branches=$($branches.Count) Warehouses=$($warehouses.Count) Suppliers=$($suppliers.Count) RawMaterials=$($materials.Count)"
Write-Output "SourceSHA256=$sourceHash"
