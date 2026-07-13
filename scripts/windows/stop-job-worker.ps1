[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
$process = Get-WorkerProcess
if (-not $process) {
  Remove-Item -LiteralPath $script:WorkerPidPath -Force -ErrorAction SilentlyContinue
  Write-Output 'Worker is not running.'
  exit 0
}

$descendants = @()
$frontier = @($process.Id)
while ($frontier.Count -gt 0) {
  $next = @()
  foreach ($parentId in $frontier) {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
      $descendants += [int]$child.ProcessId
      $next += [int]$child.ProcessId
    }
  }
  $frontier = $next
}
foreach ($childId in ($descendants | Sort-Object -Descending)) {
  Stop-Process -Id $childId -Force -ErrorAction SilentlyContinue
}
Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $script:WorkerPidPath -Force -ErrorAction SilentlyContinue
Write-Output "Worker process tree stopped (PID $($process.Id))."
