[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][uri]$LlamaArchiveUrl,
  [Parameter(Mandatory = $true)][uri]$ModelUrl,
  [string]$LlamaSha256 = '',
  [string]$ModelSha256 = '',
  [switch]$ApproveModelDownload
)

. (Join-Path $PSScriptRoot 'job-worker-common.ps1')
Initialize-WorkerDirectories
if (-not $ApproveModelDownload) { throw 'Pass -ApproveModelDownload after reviewing the hardware report and Qwen3-4B selection.' }
if ($ModelUrl.Host -notin @('huggingface.co', 'cdn-lfs.huggingface.co')) { throw 'Model downloads are restricted to Hugging Face.' }
if ($LlamaArchiveUrl.Host -ne 'github.com') { throw 'llama.cpp downloads are restricted to GitHub releases.' }
Assert-ApprovedModelPath $ModelUrl.AbsolutePath

$nodePath = 'C:\Users\Riju\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'The bundled Codex Node.js runtime is unavailable.' }
& $nodePath (Join-Path $script:RepositoryRoot 'scripts\job-search-windows-resource-guard.mjs') --startup
if ($LASTEXITCODE -ne 0) { throw 'The resource guard blocked model installation.' }

$toolsDir = Join-Path $script:WorkerHome 'llama.cpp'
$modelsDir = Join-Path $script:WorkerHome 'models'
New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null
$archive = Join-Path $script:WorkerHome 'llama.cpp.zip'
$model = Join-Path $modelsDir ([IO.Path]::GetFileName($ModelUrl.AbsolutePath))

function Invoke-ResumableDownload([uri]$Uri, [string]$OutFile) {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { throw 'curl.exe is required for resumable verified downloads.' }
  & $curl.Source --fail --location --retry 4 --retry-delay 5 --continue-at - --output $OutFile $Uri.AbsoluteUri
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $($Uri.AbsoluteUri)" }
}

Invoke-ResumableDownload $LlamaArchiveUrl $archive
if ($LlamaSha256 -and (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash -ne $LlamaSha256) { throw 'llama.cpp archive checksum mismatch.' }
Expand-Archive -LiteralPath $archive -DestinationPath $toolsDir -Force
Remove-Item -LiteralPath $archive -Force
$llamaServer = Get-ChildItem -LiteralPath $toolsDir -Recurse -Filter 'llama-server.exe' | Select-Object -First 1
if (-not $llamaServer) { throw 'llama-server.exe was not found in the approved archive.' }

Invoke-ResumableDownload $ModelUrl $model
if ($ModelSha256 -and (Get-FileHash -Algorithm SHA256 -LiteralPath $model).Hash -ne $ModelSha256) { throw 'Model checksum mismatch.' }
Assert-ApprovedModelPath $model

[pscustomobject]@{
  installed = $true
  llamaServerPath = $llamaServer.FullName
  modelPath = $model
  nextStep = "Run setup-job-worker.ps1 -LlamaServerPath '$($llamaServer.FullName)' -ModelPath '$model'"
} | Format-List
