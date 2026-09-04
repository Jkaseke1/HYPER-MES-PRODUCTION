param(
  [switch]$EnableGrnWrites
)

$ErrorActionPreference = "Stop"

$companyDatabase = [Environment]::GetEnvironmentVariable("HYPER_SAGE_COMPANY_DATABASE", "User")
$liveDatabase = [Environment]::GetEnvironmentVariable("HYPER_SAGE_LIVE_COMPANY_DATABASE", "User")
if ([string]::IsNullOrWhiteSpace($liveDatabase)) { $liveDatabase = "Hyperfeeds 2024" }

if ($companyDatabase -ne $liveDatabase) {
  throw "Production start blocked: HYPER_SAGE_COMPANY_DATABASE must equal $liveDatabase."
}

$env:HYPER_SAGE_ENVIRONMENT = "Production"
$env:HYPER_SAGE_API_URL = "http://127.0.0.1:5090/"
$env:HYPER_SAGE_LIVE_COMPANY_DATABASE = $liveDatabase
$env:HYPER_SAGE_WRITE_MODE = if ($EnableGrnWrites) { "Enabled" } else { "Disabled" }
$env:HYPER_SAGE_ALLOWED_OPERATIONS = "goods-receipts"

& (Join-Path $PSScriptRoot "Start-SageSdkApi.ps1")
