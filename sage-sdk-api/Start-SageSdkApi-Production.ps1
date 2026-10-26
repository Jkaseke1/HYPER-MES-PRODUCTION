param(
  [switch]$EnableGrnWrites,
  [switch]$EnableFullGrnWorkflow,
  [switch]$EnableManufacturingWrites,
  [switch]$ConfirmFinanceReady
)

$ErrorActionPreference = "Stop"

function Get-SavedSetting([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "User")
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Machine")
  }
  return $value
}

$companyDatabase = Get-SavedSetting "HYPER_SAGE_COMPANY_DATABASE"
$liveDatabase = Get-SavedSetting "HYPER_SAGE_LIVE_COMPANY_DATABASE"
if ([string]::IsNullOrWhiteSpace($liveDatabase)) { $liveDatabase = "Hyperfeeds 2024" }

if ($companyDatabase -ne $liveDatabase) {
  throw "Production start blocked: HYPER_SAGE_COMPANY_DATABASE must equal $liveDatabase."
}

if ($EnableGrnWrites -and -not $EnableFullGrnWorkflow) {
  throw "Production GRN posting requires both -EnableGrnWrites and -EnableFullGrnWorkflow."
}
if ($EnableFullGrnWorkflow -and -not $EnableGrnWrites) {
  throw "-EnableFullGrnWorkflow requires -EnableGrnWrites."
}

if ($EnableManufacturingWrites -and -not $ConfirmFinanceReady) {
  throw "Manufacturing writes remain blocked until Finance is ready. Pass -ConfirmFinanceReady only after Finance approves the live manufacturing workflow."
}

$env:HYPER_SAGE_ENVIRONMENT = "Production"
$env:HYPER_SAGE_API_URL = "http://127.0.0.1:5090/"
$env:HYPER_SAGE_LIVE_COMPANY_DATABASE = $liveDatabase
$env:HYPER_SAGE_WRITE_MODE = if ($EnableGrnWrites -or $EnableManufacturingWrites) { "Enabled" } else { "Disabled" }
$allowedOperations = @()
if ($EnableGrnWrites -and $EnableFullGrnWorkflow) {
  $allowedOperations += @("goods-receipts", "warehouse-transfers", "returns")
}
if ($EnableManufacturingWrites -and $ConfirmFinanceReady) {
  $allowedOperations += @("warehouse-transfers", "material-issues", "finished-goods-receipts", "manufacturing-processes")
}
$env:HYPER_SAGE_ALLOWED_OPERATIONS = ($allowedOperations | Select-Object -Unique) -join ","
$env:HYPER_SAGE_FULL_GRN_WORKFLOW = if ($EnableFullGrnWorkflow) { "true" } else { "false" }
$env:HYPER_SAGE_PRODUCTION_GRN_WRITES = if ($EnableGrnWrites -and $EnableFullGrnWorkflow) { "true" } else { "false" }

& (Join-Path $PSScriptRoot "Start-SageSdkApi.ps1")
