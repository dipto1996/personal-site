[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
& (Join-Path $PSScriptRoot 'stop-job-collector.ps1')
Unregister-ScheduledTask -TaskName $script:CollectorTaskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $script:CollectorConfigPath -Force -ErrorAction SilentlyContinue
Write-Output 'Collector configuration and scheduled task removed.'
