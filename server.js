'use strict';

// OpenCode Theme Editor - local backend server.
// Node stdlib only: http, fs, path, os, url, child_process. Zero dependencies.
// noqa: SIZE_OK - deliberately one self-contained file: the installer and uninstaller
// copy/remove exactly this file, so a single file keeps install and removal trivial.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');
const { spawn, execFileSync } = require('child_process');
const desktopTheme = require('./desktop/theme.cjs');
const desktopPatcher = require('./desktop/patcher.cjs');

const VERSION = '1.0.0';
const DEFAULT_PORT = 4288;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_NAME_LEN = 64;
const NAME_RE = /^[A-Za-z0-9._-]+$/;
const SCHEMA_URL = 'https://opencode.ai/theme.json';

function parseArgs(argv) {
  const opts = { port: DEFAULT_PORT, open: true, configDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') {
      opts.open = false;
    } else if (a === '--port') {
      opts.port = parseInt(argv[++i], 10);
    } else if (a.startsWith('--port=')) {
      opts.port = parseInt(a.slice('--port='.length), 10);
    } else if (a === '--config-dir') {
      opts.configDir = argv[++i];
    } else if (a.startsWith('--config-dir=')) {
      opts.configDir = a.slice('--config-dir='.length);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    opts.port = DEFAULT_PORT;
  }
  return opts;
}

function resolveConfigDir(override) {
  if (override) return path.resolve(override);
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'opencode');
}

const opts = parseArgs(process.argv.slice(2));
const configDir = resolveConfigDir(opts.configDir);
const themesDir = path.join(configDir, 'themes');
const tuiConfigPath = path.join(configDir, 'tui.json');
const presetsDir = path.join(__dirname, 'presets');
const desktopDataDir = path.join(process.env.OPENCODE_THEME_EDITOR_HOME || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'opencode-theme-editor');
const desktopConfigPath = path.join(desktopDataDir, 'desktop.json');
const desktopCssPath = path.join(desktopDataDir, 'desktop.css');
const desktopPresetsDir = path.join(__dirname, 'desktop', 'presets');
const desktopIndex = path.join(__dirname, 'desktop', 'index.html');
const bootstrapPath = path.join(__dirname, 'desktop', 'bootstrap.mjs');
const desktopAsar = process.env.OPENCODE_DESKTOP_ASAR || desktopPatcher.defaultAsar();

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function validateName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LEN) return false;
  if (!NAME_RE.test(name)) return false;
  if (name === '.' || name === '..') return false;
  return true;
}

// Resolve <themesDir>/<name>.json and assert it stays inside themesDir.
function themePathFor(name) {
  const root = path.resolve(themesDir) + path.sep;
  const p = path.resolve(themesDir, name + '.json');
  if (!p.startsWith(root)) return null;
  return p;
}

function isValidThemeObj(t) {
  return (
    t !== null &&
    typeof t === 'object' &&
    !Array.isArray(t) &&
    t.theme !== null &&
    typeof t.theme === 'object' &&
    !Array.isArray(t.theme)
  );
}

// Copy <p> to <p>.bak.<unix-ms-timestamp>; returns the backup path.
function backupFile(p) {
  const bak = p + '.bak.' + Date.now();
  fs.copyFileSync(p, bak);
  return bak;
}

// Write a theme file: pretty JSON, 2-space indent, trailing newline,
// $schema first, then defs (only if non-empty), then theme.
function writeThemeFile(name, themeObj) {
  const p = themePathFor(name);
  if (!p) throw httpError(400, 'Invalid theme name');
  let backup = null;
  if (fs.existsSync(p)) backup = backupFile(p);

  const out = {};
  out['$schema'] = typeof themeObj['$schema'] === 'string' ? themeObj['$schema'] : SCHEMA_URL;
  if (
    themeObj.defs !== null &&
    typeof themeObj.defs === 'object' &&
    !Array.isArray(themeObj.defs) &&
    Object.keys(themeObj.defs).length > 0
  ) {
    out.defs = themeObj.defs;
  }
  out.theme = themeObj.theme;

  fs.mkdirSync(themesDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return { path: p, backup };
}

// Set "theme" in tui.json, preserving all other keys and 2-space indent.
// Missing tui.json -> create { "theme": "<name>" }.
// Invalid JSON -> refuse, never clobber.
function applyThemeToTui(name) {
  const backups = [];
  let tui;
  if (fs.existsSync(tuiConfigPath)) {
    let raw;
    try {
      raw = fs.readFileSync(tuiConfigPath, 'utf8');
    } catch (e) {
      throw httpError(500, 'Cannot read tui.json: ' + e.message);
    }
    try {
      tui = JSON.parse(raw);
    } catch (e) {
      throw httpError(500, 'tui.json exists but is invalid JSON; refusing to overwrite it: ' + e.message);
    }
    if (tui === null || typeof tui !== 'object' || Array.isArray(tui)) {
      throw httpError(500, 'tui.json is not a JSON object; refusing to overwrite it');
    }
    backups.push(backupFile(tuiConfigPath));
  } else {
    tui = {};
  }
  tui.theme = name;
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(tuiConfigPath, JSON.stringify(tui, null, 2) + '\n', 'utf8');
  return backups;
}

function readDesktopConfig() {
  try {
    const raw = fs.readFileSync(desktopConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeDesktopFile(filePath, content) {
  fs.mkdirSync(desktopDataDir, { recursive: true });
  let backup = null;
  if (fs.existsSync(filePath)) backup = backupFile(filePath);
  fs.writeFileSync(filePath, content, 'utf8');
  return backup;
}

function listDesktopPresets() {
  const names = [];
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(desktopPresetsDir, 'index.json'), 'utf8'));
    if (idx && Array.isArray(idx.presets)) names.push.apply(names, idx.presets);
  } catch (e) {
    // Missing index is not fatal; fall through to scanning.
  }
  if (!names.length) {
    try {
      names = fs.readdirSync(desktopPresetsDir).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => f.slice(0, -'.json'.length)).sort();
    } catch (e) {
      names = [];
    }
  }
  const out = [];
  for (const name of names) {
    try {
      const raw = fs.readFileSync(path.join(desktopPresetsDir, name + '.json'), 'utf8');
      out.push(desktopTheme.normalize(JSON.parse(raw)));
    } catch (e) {
      // Skip malformed presets rather than breaking the whole list.
    }
  }
  return out;
}

function desktopAppInfo() {
  const info = desktopPatcher.inspect(desktopAsar);
  return {
    asarPath: info.asarPath,
    exists: info.exists,
    version: info.version,
    supported: info.supported,
    patched: info.patched,
    nativeTransparency: info.nativeTransparency,
    backup: info.backup,
    error: info.error || null,
    writable: info.writable !== false
  };
}

function desktopState() {
  const config = readDesktopConfig();
  const presets = listDesktopPresets();
  const theme = Object.keys(config).length ? desktopTheme.normalize(config) : (presets.length ? desktopTheme.normalize(presets[0]) : desktopTheme.normalize({}));
  return {
    ok: true,
    configDir: configDir,
    desktopDataDir: desktopDataDir,
    desktopConfigPath: desktopConfigPath,
    desktopCssPath: desktopCssPath,
    presets: presets,
    theme: theme,
    patch: desktopAppInfo(),
    version: VERSION
  };
}

function desktopPreset(name) {
  if (!validateName(name)) throw httpError(400, 'Invalid preset name');
  const p = path.join(desktopPresetsDir, name + '.json');
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { throw httpError(404, 'Preset not found: ' + name); }
  try { return desktopTheme.normalize(JSON.parse(raw)); } catch (e) { throw httpError(500, 'Preset is invalid JSON: ' + p); }
}

function handleDesktopState(res) {
  sendJson(res, 200, desktopState());
}

function handleDesktopPreset(res, query) {
  const theme = desktopPreset(query.name);
  sendJson(res, 200, { ok: true, name: query.name, theme: theme });
}

function handleDesktopPreview(res, req) {
  return readBody(req).then(parseJsonBody).then((body) => {
    const theme = desktopTheme.normalize(body);
    sendJson(res, 200, { ok: true, css: desktopTheme.generateCss(theme), theme: theme });
  });
}

function handleDesktopApply(res, req) {
  return readBody(req).then(parseJsonBody).then((body) => {
    const theme = desktopTheme.normalize(body);
    const configBackup = writeDesktopFile(desktopConfigPath, JSON.stringify(theme, null, 2) + '\n');
    const css = desktopTheme.generateCss(theme);
    const cssBackup = writeDesktopFile(desktopCssPath, css);
    sendJson(res, 200, {
      ok: true,
      configPath: desktopConfigPath,
      cssPath: desktopCssPath,
      backups: [configBackup, cssBackup].filter(Boolean)
    });
  });
}

function assertDesktopClosed() {
  if (process.env.OPENCODE_THEME_EDITOR_ALLOW_RUNNING === '1') return;
  if (process.platform !== 'win32') return;
  let out = '';
  try {
    out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq OpenCode.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  } catch (e) {
    return;
  }
  if (/OpenCode\.exe/i.test(out)) {
    throw httpError(409, 'Close every OpenCode Desktop window before patching or restoring');
  }
}

function handleDesktopPatch(res, req) {
  return readBody(req).then(parseJsonBody).then((body) => {
    if (!body || body.confirm !== true) throw httpError(400, 'confirm must be true');
    assertDesktopClosed();
    const theme = body.theme ? desktopTheme.normalize(body.theme) : null;
    if (theme) {
      writeDesktopFile(desktopConfigPath, JSON.stringify(theme, null, 2) + '\n');
      writeDesktopFile(desktopCssPath, desktopTheme.generateCss(theme));
    }
    const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
    const result = desktopPatcher.apply(desktopAsar, bootstrapSource, { nativeTransparency: !!(theme && theme.nativeTransparency) });
    sendJson(res, 200, { ok: true, theme: theme, patch: result });
  });
}

function handleDesktopRestore(res, req) {
  return readBody(req).then(parseJsonBody).then((body) => {
    if (!body || body.confirm !== true) throw httpError(400, 'confirm must be true');
    assertDesktopClosed();
    const result = desktopPatcher.restore(desktopAsar);
    sendJson(res, 200, { ok: true, restore: result });
  });
}

function handleDesktopInstall(res, req) {
  return readBody(req).then(parseJsonBody).then((body) => {
    if (!body || body.confirm !== true) throw httpError(400, 'confirm must be true');
    assertDesktopClosed();
    const theme = desktopTheme.normalize(body.theme);
    writeDesktopFile(desktopConfigPath, JSON.stringify(theme, null, 2) + '\n');
    writeDesktopFile(desktopCssPath, desktopTheme.generateCss(theme));
    const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
    const result = desktopPatcher.apply(desktopAsar, bootstrapSource);
    sendJson(res, 200, {
      ok: true,
      theme: theme,
      installed: true,
      backup: result.backup || null,
      version: result.version || null,
      configPath: desktopConfigPath,
      cssPath: desktopCssPath
    });
  });
}

function listThemeNames(dir) {
  let names = [];
  try {
    names = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
  } catch (e) {
    // Directory may not exist yet; that is fine.
  }
  return names;
}

function getActiveTheme() {
  try {
    const tui = JSON.parse(fs.readFileSync(tuiConfigPath, 'utf8'));
    return tui !== null && typeof tui === 'object' && typeof tui.theme === 'string' ? tui.theme : null;
  } catch (e) {
    return null;
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];
    const fail = (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    };
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        fail(httpError(413, 'Request body exceeds 2 MB limit'));
        req.resume(); // drain the rest so the 413 response can still be delivered
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', (e) => fail(httpError(400, 'Failed to read request body: ' + e.message)));
  });
}

function parseJsonBody(raw) {
  if (!raw) throw httpError(400, 'Request body is required');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw httpError(400, 'Invalid JSON body: ' + e.message);
  }
}

function getState() {
  return {
    ok: true,
    configDir: configDir,
    themesDir: themesDir,
    tuiConfigPath: tuiConfigPath,
    presets: listThemeNames(presetsDir),
    userThemes: listThemeNames(themesDir),
    activeTheme: getActiveTheme(),
    version: VERSION
  };
}

function resolveSourceDir(source) {
  if (source === 'preset') return presetsDir;
  if (source === 'user') return themesDir;
  throw httpError(400, 'source must be "preset" or "user"');
}

function themePathIn(source, name) {
  if (!validateName(name)) throw httpError(400, 'Invalid theme name');
  const dir = resolveSourceDir(source);
  if (dir !== themesDir) return path.join(dir, name + '.json');
  const p = themePathFor(name);
  if (!p) throw httpError(400, 'Invalid theme name');
  return p;
}

function readThemeRaw(source, name) {
  const p = themePathIn(source, name);
  try {
    return { path: p, raw: fs.readFileSync(p, 'utf8') };
  } catch (e) {
    throw httpError(404, 'Theme not found: ' + name);
  }
}

function handleGetTheme(res, query) {
  const r = readThemeRaw(query.source, query.name);
  let parsed;
  try {
    parsed = JSON.parse(r.raw);
  } catch (e) {
    throw httpError(500, 'Theme file is invalid JSON: ' + r.path);
  }
  sendJson(res, 200, { ok: true, name: query.name, source: query.source, theme: parsed });
}

function handleSave(res, req) {
  return readBody(req)
    .then(parseJsonBody)
    .then((body) => {
      const name = body.name;
      if (!validateName(name)) throw httpError(400, 'Invalid theme name');
      if (!isValidThemeObj(body.theme)) {
        throw httpError(400, 'theme must be a non-null object with a non-null "theme" object property');
      }
      const r = writeThemeFile(name, body.theme);
      sendJson(res, 200, { ok: true, path: r.path, backup: r.backup });
    });
}

function handleApply(res, req) {
  return readBody(req)
    .then(parseJsonBody)
    .then((body) => {
      const name = body.name;
      if (!validateName(name)) throw httpError(400, 'Invalid theme name');
      if (!isValidThemeObj(body.theme)) {
        throw httpError(400, 'theme must be a non-null object with a non-null "theme" object property');
      }
      const r = writeThemeFile(name, body.theme);
      const backups = [];
      if (r.backup) backups.push(r.backup);
      const tuiBackups = applyThemeToTui(name);
      backups.push.apply(backups, tuiBackups);
      sendJson(res, 200, {
        ok: true,
        themePath: r.path,
        tuiConfigPath: tuiConfigPath,
        backups: backups
      });
    });
}

function handleDelete(res, req) {
  return readBody(req)
    .then(parseJsonBody)
    .then((body) => {
      const name = body.name;
      if (!validateName(name)) throw httpError(400, 'Invalid theme name');
      const p = themePathFor(name);
      if (!p) throw httpError(400, 'Invalid theme name');
      if (!fs.existsSync(p)) throw httpError(404, 'Theme not found: ' + name);
      const backup = backupFile(p);
      fs.unlinkSync(p);
      sendJson(res, 200, { ok: true, backup: backup });
    });
}

function handleExport(res, query) {
  const name = query.name;
  const r = readThemeRaw(query.source, name);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="' + name + '.json"',
    'Content-Length': Buffer.byteLength(r.raw)
  });
  res.end(r.raw);
}

function serveIndex(res) {
  const p = path.join(__dirname, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) {
      sendJson(res, 404, { ok: false, error: 'index.html not found next to server.js' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': data.length
    });
    res.end(data);
  });
}

function serveDesktop(res) {
  const p = desktopIndex;
  fs.readFile(p, (err, data) => {
    if (err) {
      sendJson(res, 404, { ok: false, error: 'desktop/index.html not found next to server.js' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': data.length
    });
    res.end(data);
  });
}

function fail(res, err) {
  const status = err.status || 500;
  sendJson(res, status, { ok: false, error: err.message });
}

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname;
  try {
    if (req.method === 'GET' && p === '/') return serveIndex(res);
    if (req.method === 'GET' && p === '/desktop') return serveDesktop(res);
    if (req.method === 'GET' && p === '/api/state') return sendJson(res, 200, getState());
    if (req.method === 'GET' && p === '/api/desktop/state') return handleDesktopState(res);
    if (req.method === 'GET' && p === '/api/desktop/preset') return handleDesktopPreset(res, u.query);
    if (req.method === 'POST' && p === '/api/desktop/preview') return handleDesktopPreview(res, req).catch((e) => fail(res, e));
    if (req.method === 'POST' && p === '/api/desktop/apply') return handleDesktopApply(res, req).catch((e) => fail(res, e));
    if (req.method === 'POST' && p === '/api/desktop/patch') return handleDesktopPatch(res, req).catch((e) => fail(res, e));
    if (req.method === 'POST' && p === '/api/desktop/install') return handleDesktopInstall(res, req).catch((e) => fail(res, e));
    if (req.method === 'POST' && p === '/api/desktop/restore') return handleDesktopRestore(res, req).catch((e) => fail(res, e));
    if (req.method === 'GET' && p === '/api/theme') return handleGetTheme(res, u.query);
    if (req.method === 'GET' && p === '/api/export') return handleExport(res, u.query);
    if (req.method === 'POST' && p === '/api/save') return handleSave(res, req).catch((e) => fail(res, e));
    if (req.method === 'POST' && p === '/api/apply') return handleApply(res, req).catch((e) => fail(res, e));
    if (req.method === 'POST' && p === '/api/delete') return handleDelete(res, req).catch((e) => fail(res, e));
    sendJson(res, 404, { ok: false, error: 'Not found: ' + req.method + ' ' + p });
  } catch (e) {
    fail(res, e);
  }
});

function openBrowser(urlStr) {
  let cmd;
  let args;
  if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', urlStr];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [urlStr];
  } else {
    cmd = 'xdg-open';
    args = [urlStr];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) {
    // Opening the browser is best-effort; never crash the server over it.
  }
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('Port ' + opts.port + ' is already in use. Use --port <number> to pick another.');
  } else {
    console.error('Server error: ' + e.message);
  }
  process.exit(1);
});

server.listen(opts.port, '127.0.0.1', () => {
  const addr = server.address();
  const urlStr = 'http://127.0.0.1:' + addr.port + '/';
  console.log('OpenCode Theme Editor running at ' + urlStr);
  console.log('configDir: ' + configDir);
  console.log('themesDir: ' + themesDir);
  if (opts.open) openBrowser(urlStr);
});