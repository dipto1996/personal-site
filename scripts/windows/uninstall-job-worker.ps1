[CmdletBinding()]
param([switch]$RemoveRuntime)

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
& (Join-Path $PSScriptRoot 'stop-job-worker.ps1')
Unregister-ScheduledTask -TaskName $script:WorkerTaskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $script:WorkerConfigPath -Force -ErrorAction SilentlyContinue
if (-not (Test-Path -LiteralPath $script:CollectorConfigPath)) {
  Remove-Item -LiteralPath $script:WorkerCredentialPath -Force -ErrorAction SilentlyContinue
}

if ($RemoveRuntime -and (Test-Path -LiteralPath $script:WorkerHome)) {
  $resolved = (Resolve-Path -LiteralPath $script:WorkerHome).Path
  $allowedRoot = (Resolve-Path -LiteralPath $env:LOCALAPPDATA).Path
  if (-not $resolved.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove a runtime directory outside LOCALAPPDATA.'
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Output 'Scheduled task and protected worker configuration removed.'
