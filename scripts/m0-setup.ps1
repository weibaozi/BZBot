# M0: sets up Cortico with stock corti-soulmate on the server.
# Run in Windows PowerShell from the myBot folder:  powershell -ExecutionPolicy Bypass -File scripts\m0-setup.ps1
# It only touches the myBot folder and the deployment root; it changes no system settings.
param(
  # Deployment root (data and secrets); keep it outside the myBot folder.
  [string]$CorticoHome = "D:\mybot-data",
  # Name of the first bot's deployment.
  [string]$BotName = "yuki",
  # Cortico commit this project is pinned to (tested 2026-10-23).
  [string]$CorticoCommit = "e3b214e",
  [string]$ProviderCooVersion = "0.3.1"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cortico = Join-Path $root "vendor\cortico"

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
# Windows PowerShell's Set-Content -Encoding utf8 adds a BOM, which pnpm rejects in package.json.
function Write-Utf8($path, $text) { [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false)) }
# $ErrorActionPreference does not cover native commands; stop on their exit codes too.
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed with exit code $LASTEXITCODE" } }

Step "Checking Node.js (>= 22) and git"
$nodeVersion = (node -v) -replace '^v', ''
if ([int]($nodeVersion.Split('.')[0]) -lt 22) { throw "Node.js $nodeVersion is too old; install Node 22 or newer." }
git --version | Out-Null
corepack --version | Out-Null
Write-Host "Node $nodeVersion OK"

Step "Fetching Cortico at $CorticoCommit"
# A plain clone, not a submodule: inside a submodule Cortico resolves its repo root from
# `git rev-parse --git-common-dir` to <superproject>\.git\modules\vendor and cannot find bots\.
if (-not (Test-Path (Join-Path $cortico ".git"))) {
  git clone https://github.com/Pal-AI-Lab/Cortico $cortico; Check "git clone"
}
git -C $cortico fetch --quiet origin; Check "git fetch"
git -C $cortico checkout --quiet $CorticoCommit; Check "git checkout"
Write-Host "Cortico at $(git -C $cortico log -1 --format='%h %cd')"

Step "Installing Cortico dependencies"
Push-Location $cortico
corepack pnpm install --frozen-lockfile; Check "pnpm install"
Pop-Location

Step "Pointing Cortico at the deployment root $CorticoHome"
New-Item -ItemType Directory -Force $CorticoHome | Out-Null
Write-Utf8 (Join-Path $cortico ".env") "CORTICO_HOME=`"$CorticoHome`"`n"

Step "Creating deployment '$BotName' (corti-soulmate)"
$dep = Join-Path $CorticoHome $BotName
New-Item -ItemType Directory -Force $dep | Out-Null
$depJson = Join-Path $dep "deployment.json"
if (-not (Test-Path $depJson)) {
  Write-Utf8 $depJson "{ `"bot`": `"corti-soulmate`" }`n"
  Write-Host "wrote $depJson"
} else {
  Write-Host "$depJson already exists; left as is"
}

Step "Installing the model provider extension cortico-provider-coo@$ProviderCooVersion"
$ext = Join-Path $cortico "extensions"
New-Item -ItemType Directory -Force $ext | Out-Null
$ws = Join-Path $ext "pnpm-workspace.yaml"
if (-not (Test-Path $ws)) { Write-Utf8 $ws "" }
$pkg = Join-Path $ext "package.json"
if (-not (Test-Path $pkg)) { Write-Utf8 $pkg "{ `"private`": true }`n" }
Push-Location $ext
corepack pnpm add "cortico-provider-coo@$ProviderCooVersion"; Check "pnpm add cortico-provider-coo"
Pop-Location

Step "Done"
Write-Host "Start it with:  cd `"$cortico`"; node bin\cortico.mjs $BotName"
Write-Host "Then open http://127.0.0.1:7777/ and continue with docs\m0-checklist.md (steps 5-8)."
