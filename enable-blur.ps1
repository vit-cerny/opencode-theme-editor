# Enable blurred (acrylic) background for OpenCode Desktop.
# Quits OpenCode, switches the installed window mode from sharp transparency
# to Windows 11 acrylic blur, then relaunches the app.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:APPDATA 'opencode-theme-editor'
$asar = Join-Path $env:LOCALAPPDATA 'Programs\@opencode-aidesktop\resources\app.asar'
$patcher = Join-Path $PSScriptRoot 'desktop\patcher.cjs'
$bootstrap = Join-Path $PSScriptRoot 'desktop\bootstrap.mjs'

Write-Host 'Quitting OpenCode Desktop...'
Get-Process -Name OpenCode -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
$left = @(Get-Process -Name OpenCode -ErrorAction SilentlyContinue).Count
if ($left -gt 0) { Write-Host "Still running: $left. Quit it manually and re-run."; exit 1 }

$themeJson = Join-Path $root 'desktop.json'
$themeObj = Get-Content $themeJson -Raw | ConvertFrom-Json
$themeObj.mode = 'acrylic'
$themeObj.acrylic = $true
$themeObj | ConvertTo-Json -Depth 12 | Set-Content $themeJson -Encoding UTF8

$source = Get-Content $bootstrap -Raw
$js = @"
const p = require(process.argv[1]);
const fs = require('fs');
const r = p.apply(process.argv[2], fs.readFileSync(process.argv[3], 'utf8'), { acrylic: true, force: true });
console.log(JSON.stringify({ applied: r.applied, alreadyInstalled: !!r.alreadyInstalled, backup: r.backup }, null, 2));
"@
$tmpJs = Join-Path $env:TEMP 'oct-blur-apply.cjs'
[System.IO.File]::WriteAllText($tmpJs, $js, [System.Text.Encoding]::ASCII)
node $tmpJs $patcher $asar $bootstrap
Remove-Item $tmpJs -Force -ErrorAction SilentlyContinue

$node = node -e "const fs=require('fs');const t=require(process.argv[1]);const j=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],t.generateCss(t.normalize(j)));" (Join-Path $PSScriptRoot 'desktop\theme.cjs') $themeJson (Join-Path $root 'desktop.css')
Write-Host 'Theme CSS regenerated.'

Write-Host 'Starting OpenCode Desktop...'
Start-Process (Join-Path $env:LOCALAPPDATA 'Programs\@opencode-aidesktop\OpenCode.exe')
Write-Host 'Done. The window background is now blurred.'