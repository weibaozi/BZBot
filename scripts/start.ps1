param([string]$BotName = "yuki")
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$cortico = Join-Path $repo "vendor\cortico"
if (-not (Test-Path (Join-Path $cortico "node_modules"))) { throw "Run scripts\setup.ps1 first." }
if ($BotName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw "Invalid deployment name" }
Push-Location $cortico
try { node bin/cortico.mjs $BotName --paused; if ($LASTEXITCODE -ne 0) { throw "Bot exited with code $LASTEXITCODE" } }
finally { Pop-Location }
