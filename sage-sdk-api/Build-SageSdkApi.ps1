$ErrorActionPreference = "Stop"

$project = Join-Path $PSScriptRoot "HyperMes.SageSdkApi\HyperMes.SageSdkApi.csproj"
$msbuild = "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe"

& $msbuild $project /p:Configuration=Debug /p:Platform=AnyCPU /m
