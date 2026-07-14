[CmdletBinding()]
param(
  [string]$Branch = 'codex/windows-job-worker-handoff',
  [string]$ExpectedCommit = '',
  [switch]$SkipStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$commonScript = Join-Path $PSScriptRoot 'job-worker-common.ps1'
. $commonScript
Initialize-WorkerDirectories

$existingConfig = Get-WorkerConfig
$existingCredential = Get-WorkerCredential
if ($existingCredential.GetNetworkCredential().Password.Length -lt 32) {
  throw 'The protected Windows worker credential is invalid.'
}

$status = & git -C $repositoryRoot status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Windows repository.' }
if ($status) { throw 'The Windows repository has local changes. Update stopped without modifying them.' }

& (Join-Path $PSScriptRoot 'stop-job-worker.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Unable to stop the existing Windows worker.' }

& git -C $repositoryRoot fetch origin $Branch
if ($LASTEXITCODE -ne 0) { throw "Unable to fetch origin/$Branch." }
& git -C $repositoryRoot checkout $Branch
if ($LASTEXITCODE -ne 0) { throw "Unable to check out $Branch." }
& git -C $repositoryRoot merge --ff-only "origin/$Branch"
if ($LASTEXITCODE -ne 0) { throw "Unable to fast-forward to origin/$Branch." }

$actualCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to read the updated commit.' }
if ($ExpectedCommit -and $actualCommit -ne $ExpectedCommit) {
  throw "Updated commit $actualCommit does not match expected commit $ExpectedCommit."
}

$updatedSetupScript = Join-Path $repositoryRoot 'scripts\windows\setup-job-worker.ps1'
& $updatedSetupScript `
  -Endpoint $existingConfig.endpoint `
  -NodePath $existingConfig.nodePath `
  -LlamaServerPath $existingConfig.llamaServerPath `
  -ModelPath $existingConfig.modelPath `
  -RegisterScheduledTask
if ($LASTEXITCODE -ne 0) { throw 'Unable to update the Windows worker configuration.' }

if (-not $SkipStart) {
  & (Join-Path $repositoryRoot 'scripts\windows\start-job-worker.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'The updated Windows worker did not start.' }
}

[pscustomobject]@{
  updated = $true
  branch = $Branch
  commit = $actualCommit
  credentialReused = $true
  modelReused = $true
  scheduledTaskRegistered = $true
  started = (-not $SkipStart)
} | Format-List
