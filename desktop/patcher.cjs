'use strict';

// Reversible, verified ASAR patcher. It never starts, stops, or inspects processes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAIN_PATH = 'out/main/index.js';
const BOOTSTRAP_PATH = 'out/main/theme-studio-bootstrap.mjs';
const VERSION = '2.0.32';
const ARCHIVE_SHA256 = '2be5af3416f974209e992190dd480e260fecbf0319d3565ca87ce3731398f460';
const MAIN_SHA256 = 'a43fc9bd7ce7e27cc215d1f1b630087a93b4e7b889075860ae6864c76429c9fc';
const PACKAGE_SHA256 = '1da7aa46042c71f57195e8c29c27f58ec9592cde28227d71afddcbe6a51346f7';
const SNIPPET = 'backgroundColor:k9(),...process.platform===`darwin`?';
const NATIVE_OLD = 'backgroundColor:k9(),';
const NATIVE_NEW = 'backgroundColor:k9(),transparent:!0,';
const OLD_IMPORT = 'import r,{BrowserWindow as i,app as a,ipcMain as o,nativeTheme as s,net as c,protocol as l,screen as u,shell as d}from"electron";';
const NEW_IMPORT = 'import r,{app as a,ipcMain as o,nativeTheme as s,net as c,protocol as l,screen as u,shell as d}from"electron";import{BrowserWindow as i}from"./theme-studio-bootstrap.mjs";';

class PatchError extends Error { constructor(message) { super(message); this.name = 'PatchError'; } }
function fail(message) { throw new PatchError(message); }
function hash(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function fileHash(file) { return hash(fs.readFileSync(file)); }
function readAt(fd, size, position) { const b = Buffer.alloc(size); let n = 0; while (n < size) { const k = fs.readSync(fd, b, n, size - n, position + n); if (!k) fail('Unexpected end of ASAR'); n += k; } return b; }
function writeAt(fd, b, position) { let n = 0; while (n < b.length) n += fs.writeSync(fd, b, n, b.length - n, position + n); }
function equal(a, b) { return a.length === b.length && crypto.timingSafeEqual(a, b); }
function backupPath(asarPath) { return path.resolve(asarPath) + '.bak.' + new Date().toISOString().replace(/[:.]/g, '-'); }
function unique(file) { if (!fs.existsSync(file)) return file; let i = 1; while (fs.existsSync(file + '.' + i)) i++; return file + '.' + i; }

function openArchive(file) {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size < 20) fail('Invalid ASAR path: ' + resolved);
  const fd = fs.openSync(resolved, 'r');
  try {
    const h = readAt(fd, 16, 0);
    const headerSize = h.readUInt32LE(4);
    const jsonSize = h.readUInt32LE(12);
    if (h.readUInt32LE(0) !== 4 || h.readUInt32LE(8) !== headerSize - 4 || jsonSize > headerSize - 8 || headerSize + 8 > stat.size) fail('Unsupported ASAR header');
    const header = JSON.parse(readAt(fd, jsonSize, 16).toString('utf8'));
    if (!header.files) fail('ASAR header has no files');
    return { path: resolved, fd, stat, header, contentStart: 8 + headerSize };
  } catch (e) { fs.closeSync(fd); throw e; }
}
function entry(a, name, optional) {
  let n = a.header;
  for (const part of name.split('/')) { n = n && n.files && n.files[part]; if (!n) { if (optional) return null; fail('Missing ASAR entry: ' + name); } }
  if (n.link || n.unpacked || !Number.isSafeInteger(n.size) || typeof n.offset !== 'string' || !/^\d+$/.test(n.offset)) fail('Unsupported ASAR entry: ' + name);
  const position = a.contentStart + Number(n.offset);
  if (position + n.size > a.stat.size) fail('ASAR entry outside archive: ' + name);
  return { node: n, position, size: n.size };
}
function readEntry(a, name) { const e = entry(a, name); const data = readAt(a.fd, e.size, e.position); if (e.node.integrity && (e.node.integrity.algorithm !== 'SHA256' || e.node.integrity.hash !== hash(data))) fail('Integrity mismatch: ' + name); return { entry: e, data }; }
function readMain(file) { const a = openArchive(file); try { const pkg = JSON.parse(readEntry(a, 'package.json').data.toString('utf8')); const name = String(pkg.main).replace(/^\.\//, ''); const m = readEntry(a, name); return { pkg, entry: name, source: m.data.toString('utf8'), mainSha256: hash(m.data) }; } finally { fs.closeSync(a.fd); } }
function latestBackup(file) { const p = path.resolve(file), base = path.basename(p) + '.bak.'; if (!fs.existsSync(path.dirname(p))) return null; const names = fs.readdirSync(path.dirname(p)).filter(n => n.startsWith(base)).sort(); return names.length ? path.join(path.dirname(p), names[names.length - 1]) : null; }

function inspect(file) {
  const a = openArchive(file);
  try {
    const out = { asarPath: a.path, exists: true, version: null, supported: false, patched: false, nativeTransparency: false, backup: latestBackup(a.path), sha256: fileHash(a.path), archiveSha256: null, expectedArchiveSha256: ARCHIVE_SHA256, state: 'unknown', reason: null, error: null };
    out.archiveSha256 = out.sha256;
    try { const fd = fs.openSync(a.path, 'r+'); fs.closeSync(fd); out.writable = true; } catch (_) { out.writable = false; }
    try {
      const p = readEntry(a, 'package.json'); const pkg = JSON.parse(p.data.toString('utf8')); out.version = pkg.version;
      if (String(pkg.main).replace(/^\.\//, '') !== MAIN_PATH) fail('Unexpected main entry');
      const m = readEntry(a, MAIN_PATH); out.mainSha256 = hash(m.data); out.mainBytes = m.data.length;
      out.snippetFound = m.data.includes(SNIPPET); out.nativeTransparency = m.data.includes(NATIVE_NEW);
      if (entry(a, BOOTSTRAP_PATH, true)) { out.patched = true; out.state = 'patched'; out.dryRun = { action: 'none', writes: false }; return out; }
      if (out.version !== VERSION || out.sha256 !== ARCHIVE_SHA256 || out.mainSha256 !== MAIN_SHA256 || hash(p.data) !== PACKAGE_SHA256) out.reason = 'Unknown version or SHA256; refusing to patch';
      else if (!out.snippetFound || m.data.indexOf(SNIPPET) !== m.data.lastIndexOf(SNIPPET)) out.reason = 'Expected one native-window snippet';
      else if (m.data.indexOf(OLD_IMPORT) !== m.data.lastIndexOf(OLD_IMPORT) || !m.data.includes(OLD_IMPORT)) out.reason = 'Expected one electron import marker';
      else { out.supported = true; out.state = 'unpatched'; out.dryRun = { action: 'repack', backupPattern: a.path + '.bak.<timestamp>', writes: false }; }
      if (!out.supported) { out.state = 'unsupported'; out.dryRun = { action: 'refuse', reason: out.reason, writes: false }; }
    } catch (e) { out.state = 'unsupported'; out.reason = e.message; out.error = e.message; out.dryRun = { action: 'refuse', reason: e.message, writes: false }; }
    return out;
  } finally { fs.closeSync(a.fd); }
}
function status(file) { return inspect(file); }
function integrity(data) { return { algorithm: 'SHA256', hash: hash(data), blockSize: 4194304, blocks: [hash(data)] }; }
function validateSource(source) { if (typeof source !== 'string' && !Buffer.isBuffer(source)) fail('bootstrapSource must be string or Buffer'); const b = Buffer.isBuffer(source) ? Buffer.from(source) : Buffer.from(source, 'utf8'); if (!b.length || b.length > 1024 * 1024 || b.includes(0)) fail('Invalid bootstrap source'); if (!/from\s*["']electron["']/.test(b.toString('utf8'))) fail('Bootstrap must import electron'); return b; }

function repack(a, source, output) {
  const originalMain = readEntry(a, MAIN_PATH);
  const oldImport = Buffer.from(OLD_IMPORT, 'ascii');
  const index = originalMain.data.indexOf(oldImport);
  if (index === -1 || originalMain.data.indexOf(oldImport, index + 1) !== -1) fail('Electron import marker is not unique');
  const replacement = Buffer.from(NEW_IMPORT, 'ascii');
  const mainText = Buffer.concat([
    originalMain.data.subarray(0, index),
    replacement,
    originalMain.data.subarray(index + oldImport.length),
  ]).toString('ascii');
  const nativeCount = mainText.split(NATIVE_OLD).length - 1;
  if (nativeCount !== 1) fail('Native window option marker is not unique');
  const patchedMain = Buffer.from(mainText.replace(NATIVE_OLD, NATIVE_NEW), 'ascii');
  const entries = [];
  function walk(node, prefix) {
    for (const [name, child] of Object.entries(node.files || {})) {
      const full = prefix ? prefix + '/' + name : name;
      if (child.files) { walk(child, full); continue; }
      if (child.unpacked || child.link) { entries.push({ node: child, full, unpacked: true }); continue; }
      entries.push({ node: child, full, oldOffset: Number(child.offset), data: full === MAIN_PATH ? patchedMain : null, size: full === MAIN_PATH ? patchedMain.length : child.size });
    }
  }
  walk(a.header, '');
  const bootstrapNode = { size: source.length, offset: '0', integrity: integrity(source) };
  a.header.files.out.files.main.files['theme-studio-bootstrap.mjs'] = bootstrapNode;
  entries.push({ node: bootstrapNode, full: BOOTSTRAP_PATH, data: source, size: source.length });
  let offset = 0;
  for (const e of entries) { if (e.unpacked) continue; e.node.offset = String(offset); e.node.size = e.size; if (e.data) e.node.integrity = integrity(e.data); offset += e.size; }
  const text = Buffer.from(JSON.stringify(a.header), 'utf8');
  const jsonLength = text.length + 1;
  const paddedLength = (jsonLength + 3) & ~3;
  const json = Buffer.alloc(paddedLength);
  text.copy(json, 0);
  const head = Buffer.alloc(16); head.writeUInt32LE(4, 0); head.writeUInt32LE(json.length + 10, 4); head.writeUInt32LE(json.length + 6, 8); head.writeUInt32LE(text.length, 12);
  const out = fs.openSync(output, 'w');
  try {
    writeAt(out, head, 0); writeAt(out, json, 16);
    let position = 8 + head.readUInt32LE(4);
    for (const e of entries) {
      if (e.unpacked) continue;
      const data = e.data || readAt(a.fd, e.size, a.contentStart + e.oldOffset);
      writeAt(out, data, position); position += data.length;
    }
    fs.fsyncSync(out);
  } finally { fs.closeSync(out); }
  return { patchedMain, source };
}
function verify(file, plan) {
  const a = openArchive(file);
  try {
    const m = readEntry(a, MAIN_PATH);
    const b = readEntry(a, BOOTSTRAP_PATH);
    if (!equal(m.data, plan.patchedMain) || !equal(b.data, plan.source)) fail('Post-write verification failed');
    if (!m.data.includes(NATIVE_NEW)) fail('Native window option missing after patch');
    return inspect(file);
  } finally { fs.closeSync(a.fd); }
}

function apply(file, bootstrapSource) {
  const before = inspect(file);
  if (before.patched) {
    return {
      ok: true,
      applied: false,
      alreadyInstalled: true,
      refused: false,
      asarPath: path.resolve(file),
      backup: before.backup,
      backupPath: before.backup,
      version: before.version,
      before: before.archiveSha256,
      after: before.archiveSha256
    };
  }
  if (!before.supported) return { ok: false, applied: false, refused: true, reason: before.reason, asarPath: path.resolve(file), backup: before.backup, dryRun: before.dryRun };
  const source = validateSource(bootstrapSource);
  const backup = unique(backupPath(file));
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  if (fileHash(backup) !== before.archiveSha256) fail('Backup verification failed');
  const temp = unique(path.resolve(file) + '.patch.' + process.pid + '.tmp');
  const a = openArchive(file);
  try {
    try {
      const plan = repack(a, source, temp);
      const check = openArchive(temp); fs.closeSync(check.fd);
      fs.copyFileSync(temp, file);
      const after = verify(file, plan);
      return { ok: true, applied: true, refused: false, asarPath: path.resolve(file), backup, backupPath: backup, version: VERSION, before: before.archiveSha256, after: after.archiveSha256, strategy: 'repack', bootstrapPath: BOOTSTRAP_PATH, bootstrapBytes: source.length, verification: after };
    } catch (e) {
      try { fs.copyFileSync(backup, file); } catch (rollback) { throw new PatchError('Patch and rollback failed: ' + e.message + '; backup: ' + backup + '; ' + rollback.message); }
      throw new PatchError('Patch failed; original restored from backup: ' + backup + '; cause: ' + e.message);
    }
  } finally { fs.closeSync(a.fd); if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function restore(file) {
  const resolved = path.resolve(file); const before = inspect(resolved);
  if (!before.patched) return { ok: true, restored: false, alreadyRestored: true, asarPath: resolved, backup: before.backup };
  const prefix = path.basename(resolved) + '.bak.';
  const backups = fs.readdirSync(path.dirname(resolved)).filter(n => n.startsWith(prefix)).map(n => path.join(path.dirname(resolved), n)).filter(n => fs.statSync(n).isFile()).filter(n => fileHash(n) === ARCHIVE_SHA256).sort().reverse();
  if (!backups.length) fail('No known-original backup; refusing restore');
  fs.copyFileSync(backups[0], resolved);
  if (fileHash(resolved) !== ARCHIVE_SHA256) fail('Restore verification failed');
  const after = inspect(resolved);
  return { ok: true, restored: true, asarPath: resolved, backup: backups[0], backupPath: backups[0], sha256: after.archiveSha256, status: after };
}
module.exports = { SUPPORTED: { [VERSION]: MAIN_SHA256 }, ANCHOR: SNIPPET, TRANSPARENT: NEW_IMPORT, MARKER: 'theme-studio-bootstrap.mjs', BOOTSTRAP: BOOTSTRAP_PATH, PatchError, inspect, status, readMain, apply, restore, backupPath, defaultAsar: () => path.join(process.env.LOCALAPPDATA || '', 'Programs', '@opencode-aidesktop', 'resources', 'app.asar'), sha256: fileHash };
