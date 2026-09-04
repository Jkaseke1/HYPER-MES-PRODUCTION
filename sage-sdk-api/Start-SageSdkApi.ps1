$ErrorActionPreference = "Stop"

# A long-lived PowerShell can retain older process values after connector keys
# are corrected in Windows. Prefer the current User settings for a fresh API.
foreach ($name in @(
  "HYPER_SAGE_COMMON_SERVER",
  "HYPER_SAGE_SDK_SERIAL",
  "HYPER_SAGE_SDK_AUTH_CODE"
)) {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    Set-Item -Path "Env:$name" -Value $value
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

Start-Sleep -Seconds 1
$apiUrl = [Environment]::GetEnvironmentVariable("HYPER_SAGE_API_URL", "User")
if ([string]::IsNullOrWhiteSpace($apiUrl)) { $apiUrl = "http://127.0.0.1:5088/" }
Invoke-RestMethod -Method Get -Uri ($apiUrl.TrimEnd('/') + "/api/v1/health")
