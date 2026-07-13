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

function ConvertTo-ProcessArgument([string]$Value) {
  return '"' + ($Value -replace '"', '\"') + '"'
}
$collectorArgs = @(
  (ConvertTo-ProcessArgument $config.collectorScript),
  (ConvertTo-ProcessArgument '--headless'),
  (ConvertTo-ProcessArgument "--sources=$($config.sources)"),
  (ConvertTo-ProcessArgument "--profile=$($config.profileDir)"),
  (ConvertTo-ProcessArgument "--chrome=$($config.chromePath)"),
  (ConvertTo-ProcessArgument "--max-queries=$($config.maxQueries)"),
  (ConvertTo-ProcessArgument "--max-pages=$($config.maxPages)"),
  (ConvertTo-ProcessArgument "--max-jobs=$($config.maxJobs)"),
  (ConvertTo-ProcessArgument '--run-label=Scheduled Windows collector')
)
$stdout = Join-Path $script:CollectorLogsPath 'collector.stdout.log'
$stderr = Join-Path $script:CollectorLogsPath 'collector.stderr.log'
$process = Start-Process -FilePath $config.nodePath -ArgumentList $collectorArgs -WorkingDirectory $config.repositoryRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$process.Id | Set-Content -LiteralPath $script:CollectorPidPath -Encoding ascii
Remove-Item Env:JOBSEARCH_WORKER_TOKEN -ErrorAction SilentlyContinue
Write-Output "Collector started with PID $($process.Id)."
