[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
$config = $null
if (Test-Path -LiteralPath $script:CollectorConfigPath) { $config = Get-CollectorConfig }
$process = Get-CollectorProcess

[pscustomobject]@{
  configured = [bool]$config
  collectorRunning = [bool]$process
  collectorPid = if ($process) { $process.Id } else { $null }
  endpoint = if ($config) { $config.endpoint } else { $null }
  sources = if ($config) { $config.sources } else { $null }
  profileDir = if ($config) { $config.profileDir } else { $null }
  credentialPresent = Test-Path -LiteralPath $script:WorkerCredentialPath
} | ConvertTo-Json -Depth 5
