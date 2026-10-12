<#
.SYNOPSIS
  XPlain: one-shot setup from sources on Windows.
  Installs Node.js LTS (winget) if node >= 20 is missing, installs dependencies,
  builds the bundles and packages dist\xplain-<platform>-<version>.vsix.
.PARAMETER NoPackage
  Skip creating the .vsix (development only).
.PARAMETER Install
  Also install the .vsix into Cursor / VS Code (calls scripts\install.ps1).
#>
[CmdletBinding()]
param(
  [switch]$NoPackage,
  [switch]$Install
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Log($msg) { Write-Host "[xplain] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[xplain] $msg" -ForegroundColor Red; exit 1 }

function Test-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $major = [int](& node -p 'process.versions.node.split(".")[0]')
  return $major -ge 20
}

if (-not (Test-Node)) {
  Log 'Node >= 20 not found; installing Node.js LTS'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
  } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
    choco install nodejs-lts -y
  } else {
    Fail 'Neither winget nor chocolatey is available. Install Node.js LTS from https://nodejs.org and re-run.'
  }
  # Refresh PATH for the current session.
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Test-Node)) { Fail 'Node installation finished but node is not on PATH. Open a new terminal and re-run.' }
}
Log "node $(node --version) found"

Log 'installing dependencies'
if (Test-Path package-lock.json) { npm ci --no-audit --no-fund --ignore-scripts } else { npm install --no-audit --no-fund --ignore-scripts }
if ($LASTEXITCODE -ne 0) { Fail 'npm install failed' }

Log 'building'
npm run build
if ($LASTEXITCODE -ne 0) { Fail 'build failed' }

if (-not $NoPackage) {
  Log 'packaging .vsix'
  npm run package
  if ($LASTEXITCODE -ne 0) { Fail 'packaging failed' }
  $vsix = Get-ChildItem dist\*.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  Log "created $($vsix.FullName)"
}

if ($Install) {
  & "$PSScriptRoot\install.ps1"
}
Log 'done'
