$ErrorActionPreference = "Continue"

$launcher = Join-Path $PSScriptRoot "Start-SageSdkApi-Production.ps1"
$apiExe = Join-Path $PSScriptRoot "HyperMes.SageSdkApi\bin\Debug\HyperMes.SageSdkApi.exe"

if (-not (Test-Path $launcher)) {
    throw "Production SDK launcher not found: $launcher"
}

if (-not (Test-Path $apiExe)) {
    throw "SDK API executable not found: $apiExe"
}

$launcherArguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -EnableGrnWrites -EnableFullGrnWorkflow' -f $launcher

while ($true) {
    Start-Process `
        -FilePath "PowerShell.exe" `
        -ArgumentList $launcherArguments `
        -PassThru `
        -Wait `
        -WindowStyle Hidden | Out-Null

    $apiProcess = Get-CimInstance Win32_Process -Filter "Name='HyperMes.SageSdkApi.exe'" |
        Select-Object -First 1

    if ($apiProcess) {
        Wait-Process -Id $apiProcess.ProcessId
    } else {
        Start-Sleep -Seconds 5
    }
}
