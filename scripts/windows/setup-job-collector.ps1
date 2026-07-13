[CmdletBinding()]
param(
  [string]$Endpoint = 'https://tradegraph-india-site.vercel.app',
  [string]$NodePath = 'C:\Users\Riju\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe',
  [string]$ChromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe',
  [string]$Sources = 'linkedin',
  [string]$MorningTime = '06:15',
  [string]$EveningTime = '18:15',
  [switch]$SkipScheduledTask,
  [switch]$RegisterScheduledTask
)

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
Initialize-WorkerDirectories

if ($Endpoint -notmatch '^https://') { throw 'The collector endpoint must use HTTPS.' }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node.js was not found at $NodePath" }
if (-not (Test-Path -LiteralPath $ChromePath -PathType Leaf)) { throw "Chrome was not found at $ChromePath" }

if (-not (Test-Path -LiteralPath $script:WorkerCredentialPath)) {
  $secureToken = Read-Host 'Paste JOBSEARCH_WORKER_TOKEN for the collector (stored with Windows DPAPI for this user)' -AsSecureString
  $credential = [pscredential]::new('job-worker', $secureToken)
  if ($credential.GetNetworkCredential().Password.Length -lt 32) { throw 'JOBSEARCH_WORKER_TOKEN must contain at least 32 characters.' }
  $credential | Export-Clixml -LiteralPath $script:WorkerCredentialPath -Force
}

$config = [ordered]@{
  protocolVersion = 'job-worker-2026-07-v1'
  repositoryRoot = $script:RepositoryRoot
  endpoint = $Endpoint.TrimEnd('/')
  nodePath = (Resolve-Path -LiteralPath $NodePath).Path
  collectorScript = Join-Path $script:RepositoryRoot 'scripts\job-search-local-collector.mjs'
  chromePath = (Resolve-Path -LiteralPath $ChromePath).Path
  profileDir = $script:CollectorProfilePath
  sources = $Sources
  headless = $true
  maxQueries = 8
  maxPages = 3
  maxJobs = 80
  morningTime = $MorningTime
  eveningTime = $EveningTime
  configuredAt = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $script:CollectorConfigPath -Encoding utf8

if ($RegisterScheduledTask -and -not $SkipScheduledTask) {
  $startScript = Join-Path $PSScriptRoot 'start-job-collector.ps1'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$startScript`""
  $triggerMorning = New-ScheduledTaskTrigger -Daily -At $MorningTime
  $triggerEvening = New-ScheduledTaskTrigger -Daily -At $EveningTime
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
  Register-ScheduledTask -TaskName $script:CollectorTaskName -Action $action -Trigger @($triggerMorning, $triggerEvening) -Settings $settings -Description 'Persistent Chromium Windows collector for the job-search worker boundary.' -Force | Out-Null
}

[pscustomobject]@{
  configured = $true
  endpoint = $config.endpoint
  sources = $config.sources
  profileDir = $config.profileDir
  scheduledTask = ($RegisterScheduledTask -and -not $SkipScheduledTask)
  startAutomatically = $false
} | Format-List
