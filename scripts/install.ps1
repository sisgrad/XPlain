<#
.SYNOPSIS
  XPlain: install the packaged .vsix into Cursor / VS Code on Windows.
.PARAMETER Vsix
  Path to the .vsix (defaults to the newest file in dist\).
.PARAMETER Cli
  Explicit CLI to use ('cursor', 'code' or a full path). Default: every CLI found.
.NOTES
  For Remote-SSH workspaces run scripts/install.sh on the remote machine instead:
  the extension runs on the server side (extensionKind: workspace).
#>
[CmdletBinding()]
param(
  [string]$Vsix,
  [string]$Cli
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Log($msg) { Write-Host "[xplain] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[xplain] $msg" -ForegroundColor Red; exit 1 }

if (-not $Vsix) {
  $file = Get-ChildItem dist\*.vsix -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $file) { Fail 'no .vsix found in dist\. Run: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1' }
  $Vsix = $file.FullName
}
if (-not (Test-Path $Vsix)) { Fail "file not found: $Vsix" }

$candidates = @()
if ($Cli) {
  $candidates += $Cli
} else {
  foreach ($c in 'cursor', 'code', 'code-insiders') {
    if (Get-Command $c -ErrorAction SilentlyContinue) { $candidates += $c }
  }
}
if ($candidates.Count -eq 0) {
  Fail "no Cursor/VS Code CLI found on PATH. Install manually: Extensions view -> '...' -> Install from VSIX -> $Vsix"
}

$ok = $false
foreach ($c in $candidates) {
  Log "installing into: $c"
  & $c --install-extension $Vsix --force
  if ($LASTEXITCODE -eq 0) { $ok = $true } else { Log "failed for $c (continuing)" }
}
if (-not $ok) { Fail 'installation failed for every CLI candidate' }
Log 'installed. Reload the window (Developer: Reload Window) to activate XPlain.'
