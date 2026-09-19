# OpenCode Theme Editor - installer (PowerShell 5.1, no admin required)
$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$dest = Join-Path $env:LOCALAPPDATA 'opencode-theme-editor'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'OpenCode Theme Editor.lnk'
$uninstallScript = Join-Path $src 'uninstall.ps1'

# 1. Verify node exists
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'ERROR: Node.js was not found on PATH.' -ForegroundColor Red
    Write-Host 'Install Node.js from https://nodejs.org/ and then re-run this installer.'
    exit 1
}

# 2. Copy app files (idempotent: -Force overwrites)
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item -Path (Join-Path $src 'server.js') -Destination $dest -Force
if (Test-Path (Join-Path $src 'index.html')) {
    Copy-Item -Path (Join-Path $src 'index.html') -Destination $dest -Force
}
if (Test-Path (Join-Path $src 'presets')) {
    Copy-Item -Path (Join-Path $src 'presets') -Destination $dest -Recurse -Force
}

# 3. Write start.cmd into the install folder (CRLF, pure ASCII)
$startCmd = "@echo off`r`nnode `"%~dp0server.js`" %*`r`n"
[System.IO.File]::WriteAllText((Join-Path $dest 'start.cmd'), $startCmd, [System.Text.Encoding]::ASCII)

# 4. Create the Desktop shortcut via WScript.Shell COM
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($shortcutPath)
$sc.TargetPath = Join-Path $dest 'start.cmd'
$sc.WorkingDirectory = $dest
$sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
$sc.Description = 'OpenCode Theme Editor'
$sc.Save()

# 5. Report
Write-Host "Installed to: $dest"
Write-Host "Shortcut: $shortcutPath"
Write-Host "Uninstall: powershell -ExecutionPolicy Bypass -File `"$uninstallScript`""