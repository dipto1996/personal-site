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
$thermalCycle = $null
if ($config -and (Test-Path -LiteralPath $config.nodePath)) {
  try {
    $guardArgs = if ($process) { @() } else { @('--startup') }
    $resources = (& $config.nodePath $config.resourceGuardScript @guardArgs | ConvertFrom-Json).evaluation
  } catch { $resources = $null }
}
try {
  $thermalPath = Join-Path $script:WorkerHome 'thermal-cycle.json'
  if (Test-Path -LiteralPath $thermalPath) { $thermalCycle = Get-Content -Raw -LiteralPath $thermalPath | ConvertFrom-Json }
} catch { $thermalCycle = $null }

[pscustomobject]@{
  configured = [bool]$config
  workerRunning = [bool]$process
  workerPid = if ($process) { $process.Id } else { $null }
  modelHealthy = $modelHealth
  endpoint = if ($config) { $config.endpoint } else { $null }
  model = if ($config) { $config.modelName } else { $null }
  thermalProfile = if ($config -and $null -ne $config.thermalProfile) { $config.thermalProfile } else { 'legacy' }
  gpuLayers = if ($config -and $null -ne $config.gpuLayers) { $config.gpuLayers } else { $null }
  cpuThreads = if ($config -and $null -ne $config.cpuThreads) { $config.cpuThreads } else { $null }
  contextTokens = if ($config) { $config.contextTokens } else { $null }
  concurrency = if ($config) { $config.concurrency } else { $null }
  activeMinutes = if ($config -and $null -ne $config.activeMinutes) { $config.activeMinutes } else { 120 }
  cooldownMinutes = if ($config -and $null -ne $config.cooldownMinutes) { $config.cooldownMinutes } else { 60 }
  thermalCycle = $thermalCycle
  resourceGuard = $resources
  credentialPresent = Test-Path -LiteralPath $script:WorkerCredentialPath
  publicListener = $false
} | ConvertTo-Json -Depth 6
