'use strict';

// Writes a fresh OpenCode Desktop CSS theme from the editor into
// %APPDATA%\opencode-theme-editor\desktop.css and desktop.json.
// Safe to run while OpenCode is running: it only touches theme files.

const fs = require('fs');
const path = require('path');
const theme = require('./theme.cjs');
const patcher = require('./patcher.cjs');

const DATA = path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'), 'opencode-theme-editor');
const PRESETS = path.join(__dirname, 'presets');

function loadPreset(name) {
  const file = path.join(PRESETS, name + '.json');
  if (!fs.existsSync(file)) throw new Error('Preset not found: ' + name);
  return theme.normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function writeTheme(t) {
  fs.mkdirSync(DATA, { recursive: true });
  const normalized = theme.normalize(t);
  fs.writeFileSync(path.join(DATA, 'desktop.json'), JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(DATA, 'desktop.css'), theme.generateCss(normalized), 'utf8');
  return normalized;
}

const args = process.argv.slice(2);
const command = args[0] || 'status';

if (command === 'status') {
  const info = patcher.inspect(patcher.defaultAsar());
  console.log(JSON.stringify({
    app: info.version,
    installed: info.patched,
    transparent: info.nativeTransparency,
    blurred: !!info.acrylic,
    backup: info.backup,
    themeFile: path.join(DATA, 'desktop.json'),
    cssFile: path.join(DATA, 'desktop.css')
  }, null, 2));
} else if (command === 'apply') {
  const preset = args[1] || 'nord-bluish';
  const written = writeTheme(loadPreset(preset));
  console.log('Wrote ' + written.name + ' to ' + DATA);
} else if (command === 'install') {
  const preset = args[1] || 'nord-bluish';
  const written = writeTheme(loadPreset(preset));
  const source = fs.readFileSync(path.join(__dirname, 'bootstrap.mjs'), 'utf8');
  const result = patcher.apply(patcher.defaultAsar(), source, {
    acrylic: written.acrylic === true && written.mode !== 'opaque'
  });
  console.log(JSON.stringify({
    theme: written.name,
    mode: written.mode,
    blurred: written.acrylic === true && written.mode !== 'opaque',
    installed: true,
    alreadyInstalled: !!result.alreadyInstalled,
    backup: result.backup
  }, null, 2));
} else if (command === 'blur') {
  const current = JSON.parse(fs.readFileSync(path.join(DATA, 'desktop.json'), 'utf8'));
  current.mode = 'acrylic';
  current.acrylic = true;
  const written = writeTheme(current);
  const source = fs.readFileSync(path.join(__dirname, 'bootstrap.mjs'), 'utf8');
  const result = patcher.apply(patcher.defaultAsar(), source, { acrylic: true, force: true });
  console.log(JSON.stringify({
    theme: written.name,
    mode: written.mode,
    blurred: true,
    installed: true,
    alreadyInstalled: !!result.alreadyInstalled,
    backup: result.backup
  }, null, 2));
} else if (command === 'restore') {
  console.log(JSON.stringify(patcher.restore(patcher.defaultAsar()), null, 2));
} else {
  console.log('Usage: node desktop/cli.cjs [status|apply <preset>|install <preset>|blur|restore]');
  process.exitCode = 1;
}
