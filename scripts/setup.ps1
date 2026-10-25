# Sets up myBot from a fresh clone: patched Cortico, every extension, and a deployment configured like
# deploy-template/ (same Worlds and settings as the author's bot, with no whitelists, QQ numbers or persona prompt).
# Run in Windows PowerShell from the myBot folder:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# It only touches the myBot folder and the deployment root; it changes no system settings.
param(
  # Deployment root (data and secrets); keep it outside the myBot folder. Default: myBot-data next to myBot.
  [string]$CorticoHome = "",
  # Name of the deployment to create.
  [string]$BotName = "yuki",
  # WebUI port for a new deployment; 0 keeps the template's.
  [int]$Port = 0,
  # Cortico commit this project is pinned to.
  [string]$CorticoCommit = "e3b214e"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cortico = Join-Path $root "vendor\cortico"
if (-not $CorticoHome) { $CorticoHome = Join-Path (Split-Path -Parent $root) "myBot-data" }

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

Step "Applying myBot's patches to Cortico (patches\cortico\*.patch)"
# Later patches edit lines earlier ones added, so the series is applied as a whole to a clean checkout and
# recorded in a marker inside .git; a run with the same series skips it.
$patched = $false
$patches = @(Get-ChildItem (Join-Path $root "patches\cortico") -Filter *.patch -ErrorAction SilentlyContinue | Sort-Object Name)
$series = ($patches | ForEach-Object { "$($_.Name) $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" }) -join "`n"
$marker = Join-Path $cortico ".git\mybot-patches"
if ((Test-Path $marker) -and ([System.IO.File]::ReadAllText($marker) -eq $series)) {
  Write-Host "already applied: $($patches.Count) patches"
} else {
  if (git -C $cortico status --porcelain --untracked-files=no) {
    throw "vendor\cortico has local changes or an older patch series. Run: git -C vendor\cortico checkout . ; git -C vendor\cortico clean -fd -e extensions   then run this script again."
  }
  foreach ($patch in $patches) {
    git -C $cortico apply $patch.FullName; Check "git apply $($patch.Name)"
    Write-Host "applied: $($patch.Name)"
  }
  Write-Utf8 $marker $series
  $patched = $true
}

Step "Installing Cortico dependencies"
Push-Location $cortico
corepack pnpm install --frozen-lockfile; Check "pnpm install"
# The WebUI build is served as is; rebuild it whenever the patch series changed or no build exists yet.
if ($patched -or -not (Test-Path (Join-Path $cortico "dist\web"))) { corepack pnpm run build:web; Check "pnpm run build:web" }
Pop-Location

Step "Pointing Cortico at the deployment root $CorticoHome"
New-Item -ItemType Directory -Force $CorticoHome | Out-Null
Write-Utf8 (Join-Path $cortico ".env") "CORTICO_HOME=`"$CorticoHome`"`n"

Step "Preparing myBot's packages (packages\*)"
foreach ($pkg in Get-ChildItem (Join-Path $root "packages") -Directory) {
  # Packages with their own dependencies carry a lockfile; linked packages do not get them from the extensions install.
  if (Test-Path (Join-Path $pkg.FullName "pnpm-lock.yaml")) {
    Push-Location $pkg.FullName
    corepack pnpm install --frozen-lockfile; Check "pnpm install in $($pkg.Name)"
    Pop-Location
  }
  $build = Join-Path $pkg.FullName "scripts\build-webui.mjs"
  if (Test-Path $build) { node $build; Check "build-webui in $($pkg.Name)"; Write-Host "built: $($pkg.Name)" }
}

Step "Installing extensions (deploy-template\extensions)"
$ext = Join-Path $cortico "extensions"
New-Item -ItemType Directory -Force (Join-Path $ext "patches") | Out-Null
Copy-Item (Join-Path $root "deploy-template\extensions\package.json") $ext -Force
Copy-Item (Join-Path $root "deploy-template\extensions\pnpm-workspace.yaml") $ext -Force
# Third-party extensions we changed: pnpm applies these patches on install (see patches\extensions\README.md).
Copy-Item (Join-Path $root "patches\extensions\*.patch") (Join-Path $ext "patches") -Force
Push-Location $ext
corepack pnpm install; Check "pnpm install in extensions"
Pop-Location

Step "Creating deployment '$BotName' from deploy-template"
$portArg = @()
if ($Port -gt 0) { $portArg = @("$Port") }
node (Join-Path $root "scripts\new-deployment.mjs") $CorticoHome $BotName @portArg; Check "new-deployment"

Step "Done"
Write-Host "Start it with:  cd `"$cortico`"; node bin\cortico.mjs $BotName"
Write-Host "Then open the WebUI and fill in what the template leaves empty:"
Write-Host "  - Model providers: sign in to ChatGPT / Codex, set API keys for the others"
Write-Host "  - QQ: connection address, token, and which chats to listen to"
Write-Host "  - Settings > Persona > Global variables: trusted QQ numbers"
Write-Host "  - Proactive chat target, agenda entries, and the persona prompt (constitution) if wanted"
