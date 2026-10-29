# Enable a blurred background for OpenCode Desktop.
# Quits OpenCode, installs the blur patch, then relaunches the app.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$asar = Join-Path $env:LOCALAPPDATA 'Programs\@opencode-aidesktop\resources\app.asar'
$patcher = Join-Path $here 'desktop\patcher.cjs'
$bootstrap = Join-Path $here 'desktop\bootstrap.mjs'
$themeCjs = Join-Path $here 'desktop\theme.cjs'
$data = Join-Path $env:APPDATA 'opencode-theme-editor'
$themeJson = Join-Path $data 'desktop.json'

if (-not (Test-Path $asar)) { Write-Host "OpenCode Desktop not found at $asar"; exit 1 }

Write-Host 'Quitting OpenCode Desktop...'
Get-Process -Name OpenCode -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
$left = @(Get-Process -Name OpenCode -ErrorAction SilentlyContinue).Count
if ($left -gt 0) { Write-Host "Still running ($left processes). Quit it manually and re-run."; exit 1 }

New-Item -ItemType Directory -Force $data | Out-Null
if (Test-Path $themeJson) {
    $theme = Get-Content $themeJson -Raw | ConvertFrom-Json
} else {
    $theme = Get-Content (Join-Path $here 'desktop\presets\nord-bluish.json') -Raw | ConvertFrom-Json
}
$theme.mode = 'acrylic'
$theme.acrylic = $true
$theme | ConvertTo-Json -Depth 12 | Set-Content $themeJson -Encoding UTF8

$apply = Join-Path $env:TEMP 'oct-apply-blur.cjs'
$js = @"
const p = require(process.argv[2]);
const fs = require('fs');
const r = p.apply(process.argv[3], fs.readFileSync(process.argv[4], 'utf8'), { acrylic: true });
console.log(JSON.stringify(r, null, 2));
"@
[System.IO.File]::WriteAllText($apply, $js, [System.Text.Encoding]::ASCII)
node $apply $patcher $asar $bootstrap
Remove-Item $apply -Force -ErrorAction SilentlyContinue

$css = Join-Path $env:TEMP 'oct-gen-css.cjs'
$js2 = @"
const fs = require('fs');
const t = require(process.argv[2]);
const j = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
fs.writeFileSync(process.argv[4], t.generateCss(t.normalize(j)));
"@
[System.IO.File]::WriteAllText($css, $js2, [System.Text.Encoding]::ASCII)
node $css $themeCjs $themeJson (Join-Path $data 'desktop.css')
Remove-Item $css -Force -ErrorAction SilentlyContinue

Write-Host 'Starting OpenCode Desktop...'
Start-Process (Join-Path $env:LOCALAPPDATA 'Programs\@opencode-aidesktop\OpenCode.exe')
Write-Host 'Done. Background is now acrylic-blurred.'