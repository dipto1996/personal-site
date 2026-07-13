[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
$process = Get-CollectorProcess
if (-not $process) {
  Remove-Item -LiteralPath $script:CollectorPidPath -Force -ErrorAction SilentlyContinue
  Write-Output 'Collector is not running.'
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
Remove-Item -LiteralPath $script:CollectorPidPath -Force -ErrorAction SilentlyContinue
Write-Output "Collector process tree stopped (PID $($process.Id))."
