import { BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// opencode-theme-studio-bootstrap
const CONFIG_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'opencode-theme-editor');
const CONFIG_FILE = path.join(CONFIG_DIR, 'desktop.json');
const CSS_FILE = path.join(CONFIG_DIR, 'desktop.css');

function readConfig() {
  try {
    const value = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function inject(win, config) {
  if (win.isDestroyed() || config.enabled === false) return;
  try {
    const css = fs.existsSync(CSS_FILE) ? fs.readFileSync(CSS_FILE, 'utf8') : '';
    if (css) {
      const promise = win.webContents.insertCSS(css, { cssOrigin: 'user' });
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    }
  } catch {}
}

function apply(win) {
  const config = readConfig();
  if (config.enabled === false) return;
  if (process.platform === 'win32' && config.acrylic && config.mode !== 'opaque') {
    try { win.setBackgroundMaterial('acrylic'); } catch {}
  }
  const opacity = Number(config.opacity);
  if (Number.isFinite(opacity) && opacity >= 0.2 && opacity < 1) {
    try { win.setOpacity(opacity); } catch {}
  }
  win.webContents.on('did-finish-load', () => inject(win, readConfig()));
  if (!win.webContents.isLoading()) inject(win, config);
}

app.on('browser-window-created', (_event, win) => {
  try { apply(win); } catch {}
});

export { BrowserWindow, CONFIG_DIR, CONFIG_FILE, CSS_FILE };
