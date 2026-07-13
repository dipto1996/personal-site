[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
Initialize-WorkerDirectories
$existing = Get-CollectorProcess
if ($existing) {
  Write-Output "Collector is already running with PID $($existing.Id)."
  exit 0
}

$config = Get-CollectorConfig
$credential = Get-WorkerCredential
$env:JOBSEARCH_WORKER_BASE_URL = $config.endpoint
$env:JOBSEARCH_WORKER_TOKEN = $credential.GetNetworkCredential().Password

$collectorArgs = @(
  "`"$($config.collectorScript)`"",
  "--headless",
  "--sources=$($config.sources)",
  "--profile=$($config.profileDir)",
  "--chrome=$($config.chromePath)",
  "--max-queries=$($config.maxQueries)",
  "--max-pages=$($config.maxPages)",
  "--max-jobs=$($config.maxJobs)",
  "--run-label=Scheduled Windows collector"
)
$stdout = Join-Path $script:CollectorLogsPath 'collector.stdout.log'
$stderr = Join-Path $script:CollectorLogsPath 'collector.stderr.log'
$process = Start-Process -FilePath $config.nodePath -ArgumentList $collectorArgs -WorkingDirectory $config.repositoryRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$process.Id | Set-Content -LiteralPath $script:CollectorPidPath -Encoding ascii
Remove-Item Env:JOBSEARCH_WORKER_TOKEN -ErrorAction SilentlyContinue
Write-Output "Collector started with PID $($process.Id)."
