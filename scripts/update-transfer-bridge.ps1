param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{7,40}$')][string]$SourceCommit,
  [switch]$IncludeGrnGuard
)
$ErrorActionPreference = 'Stop'
$bridge = 'C:\PlantControl\Production\bridge'
$taskName = 'PlantControl Sage Bridge'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $env:TEMP "transfer-bridge-$stamp"
$backup = "C:\PlantControl\Production\backups\transfer-bridge-$stamp"
$files = @('bridgeWorker.js', 'materialTransferSdkAuto.js', 'sageStockSync.js', 'lib/sdkHttp.js')
if ($IncludeGrnGuard) { $files += 'goodsReceiptAuto.js' }
$settings = @{}
foreach ($line in Get-Content -LiteralPath "$bridge\.env") {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    $settings[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
  }
}
$url = $settings['SUPABASE_URL']
if (!$url) { $url = $settings['VITE_SUPABASE_URL'] }
$key = $settings['SUPABASE_SERVICE_KEY']
if (!$key) { $key = $settings['SUPABASE_SERVICE_ROLE_KEY'] }
if (!$url -or !$key) { throw 'Bridge Supabase configuration is missing.' }
$headers = @{ apikey = $key }
# Secret keys are not JWTs; legacy service-role keys still use Bearer auth.
if (!$key.StartsWith('sb_secret_')) { $headers['Authorization'] = "Bearer $key" }
$userAgent = 'PlantControl-Server-Installer/1.0'
if ($IncludeGrnGuard) {
  # This RPC is a STABLE SELECT-only eligibility check. NULL matches no material.
  $eligibility = Invoke-RestMethod -Method Post -Uri "$($url.TrimEnd('/'))/rest/v1/rpc/grn_input_allowed" -Headers $headers -UserAgent $userAgent -ContentType 'application/json' -Body '{"p_material_id":null}'
  if ($eligibility -ne $false) { throw 'GRN input eligibility guard could not be verified. Apply its Supabase migrations first.' }
}
# Assign directly: wrapping Invoke-RestMethod in @() can count an empty JSON array as one object.
$active = Invoke-RestMethod -Uri "$($url.TrimEnd('/'))/rest/v1/sync_log?status=in.(pending,processing)&select=id,event_type,status&limit=1" -Headers $headers -UserAgent $userAgent
if (@($active).Count) {
  $active | Select-Object id, event_type, status | Format-Table | Out-Host
  throw 'A Sage event is queued or processing. Wait for an idle queue; no services or files were changed.'
}
$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -eq 'Disabled') { throw 'Bridge task is disabled; investigate before deployment.' }
New-Item -ItemType Directory -Force -Path $stage, "$stage\lib", $backup, "$backup\lib" | Out-Null
foreach ($file in $files) {
  $relative = $file.Replace('\', '/')
  Invoke-WebRequest "https://raw.githubusercontent.com/Jkaseke1/HYPER-MES-PRODUCTION/$SourceCommit/bridge/$relative" -OutFile (Join-Path $stage $file)
  & node --check (Join-Path $stage $file)
  if ($LASTEXITCODE -ne 0) { throw "Syntax validation failed: $file" }
  $target = Join-Path $bridge $file
  if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination (Join-Path $backup $file) }
}
# Resolve existing worker dependencies without loading .env or running handlers.
& node -e 'const fs=require("fs"),path=require("path");for(const m of fs.readFileSync(process.argv[1],"utf8").matchAll(/require\(["\x27](\.\/[^"\x27]+)["\x27]\)/g)){require.resolve(path.resolve(process.argv[2],m[1]));}' "$stage\bridgeWorker.js" $bridge
if ($LASTEXITCODE -ne 0) { throw 'A required bridge module is missing; no services were changed.' }
$stopped = $false
$installed = $false
$restartRequested = $false
try {
  Disable-ScheduledTask -TaskName $taskName | Out-Null
  $stopped = $true
  # Recheck after staging. Keep PD receipts paused during this brief maintenance window.
  $active = Invoke-RestMethod -Uri "$($url.TrimEnd('/'))/rest/v1/sync_log?status=in.(pending,processing)&select=id,event_type,status&limit=1" -Headers $headers -UserAgent $userAgent
  if (@($active).Count) {
    $active | Select-Object id, event_type, status | Format-Table | Out-Host
    throw 'A Sage event started during staging. Update aborted.'
  }
  Stop-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 3
  $remaining = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'bridgeWorker\.js' })
  if ($remaining.Count) { throw 'A bridge worker remains running. Files were not replaced; do not force-stop a posting.' }
  $installed = $true
  foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $stage $file) -Destination (Join-Path $bridge $file) -Force }
  Enable-ScheduledTask -TaskName $taskName | Out-Null
  Start-ScheduledTask -TaskName $taskName
  $restartRequested = $true
  Start-Sleep -Seconds 5
  Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
  Write-Host "Bridge files updated. Backup: $backup. Verify the bridge log and next transfer. SDK API was not restarted."
} catch {
  if ($installed -and !$restartRequested) {
    foreach ($file in $files) {
      $saved = Join-Path $backup $file
      if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination (Join-Path $bridge $file) -Force }
    }
  }
  if ($stopped) {
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    $workers = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'bridgeWorker\.js' })
    if (!$workers.Count) { Start-ScheduledTask -TaskName $taskName }
  }
  throw
}
