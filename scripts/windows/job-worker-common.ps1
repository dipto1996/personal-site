Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:WorkerHome = Join-Path $env:LOCALAPPDATA 'DiptopalJobWorker'
$script:WorkerConfigPath = Join-Path $script:WorkerHome 'config.json'
$script:CollectorConfigPath = Join-Path $script:WorkerHome 'collector-config.json'
$script:WorkerCredentialPath = Join-Path $script:WorkerHome 'worker-token.clixml'
$script:WorkerPidPath = Join-Path $script:WorkerHome 'worker.pid'
$script:CollectorPidPath = Join-Path $script:WorkerHome 'collector.pid'
$script:WorkerLogsPath = Join-Path $script:WorkerHome 'logs'
$script:CollectorLogsPath = Join-Path $script:WorkerHome 'collector-logs'
$script:WorkerTaskName = 'Diptopal Job Intelligence Worker'
$script:CollectorTaskName = 'Diptopal Job Intelligence Collector'
$script:RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:CollectorProfilePath = Join-Path $script:WorkerHome 'collector-profile'

function Initialize-WorkerDirectories {
  New-Item -ItemType Directory -Path $script:WorkerHome -Force | Out-Null
  New-Item -ItemType Directory -Path $script:WorkerLogsPath -Force | Out-Null
  New-Item -ItemType Directory -Path $script:CollectorLogsPath -Force | Out-Null
  New-Item -ItemType Directory -Path $script:CollectorProfilePath -Force | Out-Null
}

function Get-WorkerConfig {
  if (-not (Test-Path -LiteralPath $script:WorkerConfigPath)) {
    throw "Worker configuration is missing. Run setup-job-worker.ps1 first."
  }
  return Get-Content -Raw -LiteralPath $script:WorkerConfigPath | ConvertFrom-Json
}

function Get-CollectorConfig {
  if (-not (Test-Path -LiteralPath $script:CollectorConfigPath)) {
    throw "Collector configuration is missing. Run setup-job-collector.ps1 first."
  }
  return Get-Content -Raw -LiteralPath $script:CollectorConfigPath | ConvertFrom-Json
}

function Get-WorkerCredential {
  if (-not (Test-Path -LiteralPath $script:WorkerCredentialPath)) {
    throw "Protected worker credential is missing. Run setup-job-worker.ps1 first."
  }
  return Import-Clixml -LiteralPath $script:WorkerCredentialPath
}

function Get-WorkerProcess {
  if (-not (Test-Path -LiteralPath $script:WorkerPidPath)) { return $null }
  $workerPid = [int](Get-Content -Raw -LiteralPath $script:WorkerPidPath)
  return Get-Process -Id $workerPid -ErrorAction SilentlyContinue
}

function Get-CollectorProcess {
  if (-not (Test-Path -LiteralPath $script:CollectorPidPath)) { return $null }
  $collectorPid = [int](Get-Content -Raw -LiteralPath $script:CollectorPidPath)
  return Get-Process -Id $collectorPid -ErrorAction SilentlyContinue
}

function Assert-ApprovedModelPath([string]$ModelPath) {
  if ($ModelPath -match '(?i)qwen3.*14b|14b.*qwen3') { throw 'Qwen3-14B is prohibited on this worker.' }
  if ($ModelPath -notmatch '(?i)qwen3[-_. ]?4b') { throw 'This Windows host is approved only for Qwen3-4B.' }
  if ($ModelPath -notmatch '(?i)q4[_-]?k[_-]?m') { throw 'The approved quantization is Q4_K_M.' }
}
