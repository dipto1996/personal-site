[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
$config = $null
if (Test-Path -LiteralPath $script:WorkerConfigPath) { $config = Get-WorkerConfig }
$process = Get-WorkerProcess
$modelHealth = $false
try {
  if ($config) { $modelHealth = (Invoke-WebRequest -UseBasicParsing -Uri ($config.modelBaseUrl -replace '/v1$', '/health') -TimeoutSec 3).StatusCode -eq 200 }
} catch { $modelHealth = $false }

$resources = $null
if ($config -and (Test-Path -LiteralPath $config.nodePath)) {
  try { $resources = (& $config.nodePath $config.resourceGuardScript --startup | ConvertFrom-Json).evaluation } catch { $resources = $null }
}

[pscustomobject]@{
  configured = [bool]$config
  workerRunning = [bool]$process
  workerPid = if ($process) { $process.Id } else { $null }
  modelHealthy = $modelHealth
  endpoint = if ($config) { $config.endpoint } else { $null }
  model = if ($config) { $config.modelName } else { $null }
  contextTokens = if ($config) { $config.contextTokens } else { $null }
  concurrency = if ($config) { $config.concurrency } else { $null }
  resourceGuard = $resources
  credentialPresent = Test-Path -LiteralPath $script:WorkerCredentialPath
  publicListener = $false
} | ConvertTo-Json -Depth 6
