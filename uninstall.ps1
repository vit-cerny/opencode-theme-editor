# OpenCode Theme Editor - uninstaller (PowerShell 5.1, no admin required)
$ErrorActionPreference = 'Stop'

$dest = Join-Path $env:LOCALAPPDATA 'opencode-theme-editor'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'OpenCode Theme Editor.lnk'

# Guard: never delete anything outside %LOCALAPPDATA%\opencode-theme-editor
$localAppDataFull = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA)
$destFull = [System.IO.Path]::GetFullPath($dest)
$expected = [System.IO.Path]::GetFullPath((Join-Path $localAppDataFull 'opencode-theme-editor'))
if ($destFull -ne $expected) {
    Write-Host "Refusing to remove unexpected path: $destFull" -ForegroundColor Red
    exit 1
}

if (Test-Path -LiteralPath $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
    Write-Host "Removed shortcut: $shortcutPath"
} else {
    Write-Host "Shortcut not found (nothing to remove): $shortcutPath"
}

if (Test-Path -LiteralPath $destFull) {
    Remove-Item -LiteralPath $destFull -Recurse -Force
    Write-Host "Removed install folder: $destFull"
} else {
    Write-Host "Install folder not found (nothing to remove): $destFull"
}