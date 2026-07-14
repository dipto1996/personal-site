[CmdletBinding()]
param(
  [string]$Endpoint = 'https://tradegraph-india-site.vercel.app',
  [string]$NodePath = 'C:\Users\Riju\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe',
  [Parameter(Mandatory = $true)][string]$LlamaServerPath,
  [Parameter(Mandatory = $true)][string]$ModelPath,
  [switch]$ReplaceCredential,
  [switch]$SkipScheduledTask,
  [switch]$RegisterScheduledTask
)

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
Initialize-WorkerDirectories

if ($Endpoint -notmatch '^https://') { throw 'The worker endpoint must use HTTPS.' }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node.js was not found at $NodePath" }
if (-not (Test-Path -LiteralPath $LlamaServerPath -PathType Leaf)) { throw "llama-server.exe was not found at $LlamaServerPath" }
if (-not (Test-Path -LiteralPath $ModelPath -PathType Leaf)) { throw "The model was not found at $ModelPath" }
Assert-ApprovedModelPath $ModelPath

$credential = $null
if ($ReplaceCredential -or -not (Test-Path -LiteralPath $script:WorkerCredentialPath)) {
  $secureToken = Read-Host 'Paste JOBSEARCH_WORKER_TOKEN (stored with Windows DPAPI for this user)' -AsSecureString
  $credential = [pscredential]::new('job-worker', $secureToken)
  $credential | Export-Clixml -LiteralPath $script:WorkerCredentialPath -Force
} else {
  $credential = Get-WorkerCredential
}
$plainLength = $credential.GetNetworkCredential().Password.Length
if ($plainLength -lt 32) { throw 'JOBSEARCH_WORKER_TOKEN must contain at least 32 characters.' }

$config = [ordered]@{
  protocolVersion = 'job-worker-2026-07-v3'
  repositoryRoot = $script:RepositoryRoot
  endpoint = $Endpoint.TrimEnd('/')
  nodePath = (Resolve-Path -LiteralPath $NodePath).Path
  workerScript = Join-Path $script:RepositoryRoot 'scripts\job-search-windows-worker.mjs'
  resourceGuardScript = Join-Path $script:RepositoryRoot 'scripts\job-search-windows-resource-guard.mjs'
  llamaServerPath = (Resolve-Path -LiteralPath $LlamaServerPath).Path
  modelPath = (Resolve-Path -LiteralPath $ModelPath).Path
  modelName = 'Qwen3-4B-Q4_K_M'
  modelBaseUrl = 'http://127.0.0.1:8080/v1'
  workerId = "$($env:COMPUTERNAME.ToLowerInvariant()):windows-job-worker"
  contextTokens = 8192
  gpuLayers = 20
  cpuThreads = 4
  concurrency = 1
  idleShutdownSeconds = 300
  activeMinutes = 120
  cooldownMinutes = 60
  configuredAt = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $script:WorkerConfigPath -Encoding utf8

if ($RegisterScheduledTask -and -not $SkipScheduledTask) {
  $startScript = Join-Path $PSScriptRoot 'start-job-worker.ps1'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$startScript`" -Wait"
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $script:WorkerTaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Outbound-only local Qwen3-4B job intelligence worker.' -Force | Out-Null
}

[pscustomobject]@{
  configured = $true
  endpoint = $config.endpoint
  model = $config.modelName
  contextTokens = $config.contextTokens
  concurrency = $config.concurrency
  activeMinutes = $config.activeMinutes
  cooldownMinutes = $config.cooldownMinutes
  credentialProtection = 'Windows DPAPI, current user'
  scheduledTask = ($RegisterScheduledTask -and -not $SkipScheduledTask)
  publicListener = $false
} | Format-List
