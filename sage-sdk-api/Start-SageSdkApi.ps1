$ErrorActionPreference = "Stop"

# A long-lived PowerShell can retain stale values. Refresh saved server settings
# without overriding the environment/URL/write scope chosen by the UAT or
# Production launcher that called this script.
$launcherOwnedNames = @(
  "HYPER_SAGE_ENVIRONMENT",
  "HYPER_SAGE_API_URL",
  "HYPER_SAGE_LIVE_COMPANY_DATABASE",
  "HYPER_SAGE_WRITE_MODE",
  "HYPER_SAGE_ALLOWED_OPERATIONS",
  "HYPER_SAGE_FULL_GRN_WORKFLOW",
  "HYPER_SAGE_PRODUCTION_GRN_WRITES"
)
$userSettings = [Environment]::GetEnvironmentVariables("User")
$machineSettings = [Environment]::GetEnvironmentVariables("Machine")
$settingNames = @($userSettings.Keys) + @($machineSettings.Keys) | Select-Object -Unique

foreach ($name in $settingNames) {
  if (-not $name.StartsWith("HYPER_SAGE_", [StringComparison]::OrdinalIgnoreCase)) { continue }
  if ($launcherOwnedNames -contains $name) { continue }

  $value = $userSettings[$name]
  if ([string]::IsNullOrWhiteSpace([string]$value)) { $value = $machineSettings[$name] }
  if (-not [string]::IsNullOrWhiteSpace([string]$value)) {
    Set-Item -Path "Env:$name" -Value ([string]$value)
  }
}

$apiExe = Join-Path $PSScriptRoot "HyperMes.SageSdkApi\bin\Debug\HyperMes.SageSdkApi.exe"
$apiDir = Split-Path $apiExe -Parent

if (-not (Test-Path $apiExe)) {
  throw "SDK API executable not found. Run sage-sdk-api\Build-SageSdkApi.ps1 first."
}

Start-Process `
  -FilePath $apiExe `
  -WorkingDirectory $apiDir `
  -WindowStyle Hidden

$apiUrl = $env:HYPER_SAGE_API_URL
if ([string]::IsNullOrWhiteSpace($apiUrl)) {
  $apiUrl = [Environment]::GetEnvironmentVariable("HYPER_SAGE_API_URL", "User")
}
if ([string]::IsNullOrWhiteSpace($apiUrl)) { $apiUrl = "http://127.0.0.1:5088/" }

$healthUri = $apiUrl.TrimEnd('/') + "/api/v1/health"
$lastError = $null
for ($attempt = 1; $attempt -le 30; $attempt++) {
  try {
    $headers = @{}
    $apiKey = [Environment]::GetEnvironmentVariable("HYPER_SAGE_API_KEY", "User")
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
      $apiKey = [Environment]::GetEnvironmentVariable("HYPER_SAGE_API_KEY", "Machine")
    }
    if (-not [string]::IsNullOrWhiteSpace($apiKey)) {
      $headers["X-Hyper-Api-Key"] = $apiKey
    }
    Invoke-RestMethod -Method Get -Uri $healthUri -Headers $headers -TimeoutSec 3
    exit 0
  } catch {
    $lastError = $_
    Start-Sleep -Seconds 1
  }
}

throw "SDK API did not become healthy at $healthUri after 30 seconds. Last error: $lastError"
