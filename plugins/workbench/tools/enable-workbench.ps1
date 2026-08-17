# Restore the exact profile backup made by disable-workbench.ps1.
# Run: powershell -ExecutionPolicy Bypass -File .\enable-workbench.ps1
# Restart DSH Desktop after this script.

$ErrorActionPreference = "Stop"
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\desktop"
$backupDir  = Join-Path $PSScriptRoot "backup"

$pkg = Get-ChildItem $backupDir -Filter "package.json.*.bak" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$patch = Get-ChildItem $backupDir -Filter "cordis.patch.yml.*.bak" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($pkg)   { Copy-Item $pkg.FullName (Join-Path $profileDir "package.json") -Force;  Write-Host "Restored package.json ($($pkg.Name))" }
else        { Write-Host "Warning: package.json backup not found; skipped" }
if ($patch) { Copy-Item $patch.FullName (Join-Path $profileDir "cordis.patch.yml") -Force; Write-Host "Restored cordis.patch.yml ($($patch.Name))" }
else        { Write-Host "Warning: cordis.patch.yml backup not found; skipped" }

Write-Host "dsh-workbench restored. Restart DSH Desktop to apply it."
