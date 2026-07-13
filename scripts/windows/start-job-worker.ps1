[CmdletBinding()]
param(
  [switch]$Once,
  [switch]$Wait,
  [ValidateRange(0, 20)][int]$MaxTasks = 0
)

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
Initialize-WorkerDirectories
$existing = Get-WorkerProcess
if ($existing) {
  Write-Output "Worker is already running with PID $($existing.Id)."
  exit 0
}

$config = Get-WorkerConfig
$credential = Get-WorkerCredential
Assert-ApprovedModelPath $config.modelPath

& $config.nodePath $config.resourceGuardScript --startup
if ($LASTEXITCODE -ne 0) { throw 'The resource guard blocked worker startup.' }

$env:JOBSEARCH_WORKER_BASE_URL = $config.endpoint
$env:JOBSEARCH_WORKER_TOKEN = $credential.GetNetworkCredential().Password
$env:JOBSEARCH_WORKER_ID = $config.workerId
$env:JOBSEARCH_WORKER_RUNTIME_DIR = $script:WorkerHome
$env:JOBSEARCH_LLAMA_SERVER_PATH = $config.llamaServerPath
$env:JOBSEARCH_LOCAL_MODEL_PATH = $config.modelPath
$env:JOBSEARCH_LOCAL_LLM_MODEL = $config.modelName
$env:JOBSEARCH_LOCAL_LLM_BASE_URL = $config.modelBaseUrl

$workerArgs = @("`"$($config.workerScript)`"")
if ($Once) { $workerArgs += '--once' }
if ($MaxTasks -gt 0) { $workerArgs += "--max-tasks=$MaxTasks" }
$stdout = Join-Path $script:WorkerLogsPath 'worker.stdout.log'
$stderr = Join-Path $script:WorkerLogsPath 'worker.stderr.log'
$process = Start-Process -FilePath $config.nodePath -ArgumentList $workerArgs -WorkingDirectory $config.repositoryRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$process.Id | Set-Content -LiteralPath $script:WorkerPidPath -Encoding ascii

Remove-Item Env:JOBSEARCH_WORKER_TOKEN -ErrorAction SilentlyContinue
Write-Output "Worker started with PID $($process.Id)."
if ($Wait) {
  $process.WaitForExit()
  Remove-Item -LiteralPath $script:WorkerPidPath -Force -ErrorAction SilentlyContinue
  if ($process.ExitCode -ne 0) { exit $process.ExitCode }
}
