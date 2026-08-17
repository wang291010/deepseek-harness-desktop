# Emergency switch: disable dsh-workbench and restore the native desktop UI.
# Run: powershell -ExecutionPolicy Bypass -File .\disable-workbench.ps1
# Restart DSH Desktop after this script. Restore with enable-workbench.ps1.

$ErrorActionPreference = "Stop"
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\desktop"
$backupDir  = Join-Path $PSScriptRoot "backup"

if (-not (Test-Path $profileDir)) { Write-Host "Desktop profile not found: $profileDir"; exit 1 }

# 1) Back up the exact current profile.
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
foreach ($name in @("package.json", "cordis.patch.yml")) {
  $src = Join-Path $profileDir $name
  if (Test-Path $src) { Copy-Item $src (Join-Path $backupDir "$name.$stamp.bak") -Force }
}
Write-Host "Backup created in $backupDir"

# 2) Remove only workbench entries; preserve every other plugin and setting.
$packagePath = Join-Path $profileDir "package.json"
$patchPath = Join-Path $profileDir "cordis.patch.yml"
$pkg = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne "dsh-workbench" })
if ($pkg.dependencies) { $pkg.dependencies.PSObject.Properties.Remove("dsh-workbench") }

$safePackage = $pkg | ConvertTo-Json -Depth 20
$safePatch = Get-Content -LiteralPath $patchPath -Raw
# Remove only the two top-level YAML entries (nested arrays are indented).
$safePatch = [regex]::Replace($safePatch, '(?ms)^- id: ui-layout\r?\n(?:(?!^- ).)*(?=^- |\z)', '')
$safePatch = [regex]::Replace($safePatch, '(?ms)^- id: ui-sidebar\r?\n(?:(?!^- ).)*(?=^- |\z)', '')

# Windows PowerShell 5.1 writes a BOM for Set-Content UTF8; DSH rejects it.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($packagePath, $safePackage + "`n", $utf8NoBom)
[IO.File]::WriteAllText($patchPath, $safePatch, $utf8NoBom)
Write-Host "dsh-workbench disabled. Restart DSH Desktop to load the native UI."
Write-Host "Restore with: .\enable-workbench.ps1"
