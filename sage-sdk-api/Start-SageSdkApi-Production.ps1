param(
  [switch]$EnableGrnWrites,
  [switch]$EnableFullGrnWorkflow
)

$ErrorActionPreference = "Stop"

$companyDatabase = [Environment]::GetEnvironmentVariable("HYPER_SAGE_COMPANY_DATABASE", "User")
$liveDatabase = [Environment]::GetEnvironmentVariable("HYPER_SAGE_LIVE_COMPANY_DATABASE", "User")
if ([string]::IsNullOrWhiteSpace($liveDatabase)) { $liveDatabase = "Hyperfeeds 2024" }

if ($companyDatabase -ne $liveDatabase) {
  throw "Production start blocked: HYPER_SAGE_COMPANY_DATABASE must equal $liveDatabase."
}

if ($EnableGrnWrites -and -not $EnableFullGrnWorkflow) {
  throw "Production GRN posting requires both -EnableGrnWrites and -EnableFullGrnWorkflow."
}

$env:HYPER_SAGE_ENVIRONMENT = "Production"
$env:HYPER_SAGE_API_URL = "http://127.0.0.1:5090/"
$env:HYPER_SAGE_LIVE_COMPANY_DATABASE = $liveDatabase
$env:HYPER_SAGE_WRITE_MODE = if ($EnableGrnWrites) { "Enabled" } else { "Disabled" }
$env:HYPER_SAGE_ALLOWED_OPERATIONS = "goods-receipts,warehouse-transfers"
$env:HYPER_SAGE_FULL_GRN_WORKFLOW = if ($EnableFullGrnWorkflow) { "true" } else { "false" }
$env:HYPER_SAGE_PRODUCTION_GRN_WRITES = if ($EnableGrnWrites -and $EnableFullGrnWorkflow) { "true" } else { "false" }

& (Join-Path $PSScriptRoot "Start-SageSdkApi.ps1")
