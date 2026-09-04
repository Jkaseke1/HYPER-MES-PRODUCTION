$ErrorActionPreference = "Stop"

$companyDatabase = [Environment]::GetEnvironmentVariable("HYPER_SAGE_COMPANY_DATABASE", "User")
$liveDatabase = [Environment]::GetEnvironmentVariable("HYPER_SAGE_LIVE_COMPANY_DATABASE", "User")
if ([string]::IsNullOrWhiteSpace($liveDatabase)) { $liveDatabase = "Hyperfeeds 2024" }

if ([string]::IsNullOrWhiteSpace($companyDatabase)) {
  throw "Set the UAT HYPER_SAGE_COMPANY_DATABASE user variable first."
}
if ($companyDatabase -eq $liveDatabase) {
  throw "UAT start blocked: the configured company database is the live database."
}

$env:HYPER_SAGE_ENVIRONMENT = "UAT"
$env:HYPER_SAGE_API_URL = "http://127.0.0.1:5088/"
$env:HYPER_SAGE_LIVE_COMPANY_DATABASE = $liveDatabase
$env:HYPER_SAGE_WRITE_MODE = "Enabled"
$env:HYPER_SAGE_ALLOWED_OPERATIONS = "goods-receipts,warehouse-transfers,material-issues,finished-goods-receipts,manufacturing-processes"

& (Join-Path $PSScriptRoot "Start-SageSdkApi.ps1")
