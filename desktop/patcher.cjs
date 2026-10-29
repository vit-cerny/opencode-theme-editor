'use strict';

// Reversible ASAR patcher for OpenCode Desktop.
// Matches the window constructor by shape instead of a fixed build hash, so a
// new OpenCode release does not silently break it. Every write is backed up,
// verified, and rolled back on failure.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BOOTSTRAP_PATH = 'out/main/theme-studio-bootstrap.mjs';
const BOOTSTRAP_FILE = 'theme-studio-bootstrap.mjs';

// Adds the loader for side effects only; no binding changes.
const IMPORT_AFTER = 'from"electron";import"./theme-studio-bootstrap.mjs";';
const ELECTRON_FROM = 'from"electron";';

// Window background anchors. Group 1 is the colour resolver call.
const BG_RE = /backgroundColor:([A-Za-z_$][\w$]*)\(\),/;
const ACRYLIC_OPTS = 'backgroundColor:"#00000000",backgroundMaterial:"acrylic",';
const SHARP_OPTS = 'backgroundColor:"#00000000",transparent:!0,';

class PatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PatchError';
  }
}
function fail(message) {
  throw new PatchError(message);
}

function hash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function fileHash(file) {
  return hash(fs.readFileSync(file));
}
function readAt(fd, size, pos) {
  const b = Buffer.alloc(size);
  let n = 0;
  while (n < size) {
    const k = fs.readSync(fd, b, n, size - n, pos + n);
    if (!k) fail('Unexpected end of ASAR');
    n += k;
  }
  return b;
}
function writeAt(fd, b, pos) {
  let n = 0;
  while (n < b.length) n += fs.writeSync(fd, b, n, b.length - n, pos + n);
}
function equal(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function backupPath(file) {
  return path.resolve(file) + '.bak.' + new Date().toISOString().replace(/[:.]/g, '-');
}
function unique(file) {
  if (!fs.existsSync(file)) return file;
  let i = 1;
  while (fs.existsSync(file + '.' + i)) i++;
  return file + '.' + i;
}

function openArchive(file) {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size < 20) fail('Invalid ASAR path: ' + resolved);
  const fd = fs.openSync(resolved, 'r');
  try {
    const h = readAt(fd, 16, 0);
    const headerSize = h.readUInt32LE(4);
    const jsonSize = h.readUInt32LE(12);
    if (h.readUInt32LE(0) !== 4) fail('Unsupported ASAR header');
    if (jsonSize > headerSize - 8 || headerSize + 8 > stat.size) fail('Unsupported ASAR header sizes');
    const header = JSON.parse(readAt(fd, jsonSize, 16).toString('utf8'));
    if (!header.files) fail('ASAR header has no files');
    return { path: resolved, fd, stat, header, contentStart: 8 + headerSize };
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
}

function entry(a, name, optional) {
  let n = a.header;
  for (const part of name.split('/')) {
    n = n && n.files && n.files[part];
    if (!n) {
      if (optional) return null;
      fail('Missing ASAR entry: ' + name);
    }
  }
  if (n.link || n.unpacked || !Number.isSafeInteger(n.size) || typeof n.offset !== 'string' || !/^\d+$/.test(n.offset)) {
    fail('Unsupported ASAR entry: ' + name);
  }
  const position = a.contentStart + Number(n.offset);
  if (position + n.size > a.stat.size) fail('ASAR entry outside archive: ' + name);
  return { node: n, position, size: n.size };
}

function readEntry(a, name) {
  const e = entry(a, name);
  const data = readAt(a.fd, e.size, e.position);
  if (e.node.integrity && (e.node.integrity.algorithm !== 'SHA256' || e.node.integrity.hash !== hash(data))) {
    fail('Integrity mismatch: ' + name);
  }
  return { entry: e, data };
}

function readMain(file) {
  const a = openArchive(file);
  try {
    const pkg = JSON.parse(readEntry(a, 'package.json').data.toString('utf8'));
    const name = String(pkg.main).replace(/^\.\//, '');
    const m = readEntry(a, name);
    return { pkg, entry: name, source: m.data.toString('utf8'), mainSha256: hash(m.data) };
  } finally {
    fs.closeSync(a.fd);
  }
}

function latestBackup(file) {
  const p = path.resolve(file);
  const prefix = path.basename(p) + '.bak.';
  if (!fs.existsSync(path.dirname(p))) return null;
  const names = fs.readdirSync(path.dirname(p)).filter((n) => n.startsWith(prefix)).sort();
  return names.length ? path.join(path.dirname(p), names[names.length - 1]) : null;
}

function counts(src) {
  const bg = src.match(BG_RE);
  return {
    electron: src.split(ELECTRON_FROM).length - 1,
    bg: bg ? src.split(bg[0]).length - 1 : 0
  };
}

function inspect(file) {
  const out = {
    asarPath: path.resolve(file),
    exists: fs.existsSync(file),
    version: null,
    supported: false,
    patched: false,
    nativeTransparency: false,
    acrylic: false,
    backup: null,
    sha256: null,
    reason: null,
    error: null
  };
  if (!out.exists) {
    out.error = 'OpenCode Desktop app.asar was not found';
    return out;
  }
  out.sha256 = fileHash(file);
  out.backup = latestBackup(file);
  try {
    const fd = fs.openSync(file, 'r+');
    fs.closeSync(fd);
    out.writable = true;
  } catch {
    out.writable = false;
  }
  try {
    const main = readMain(file);
    out.version = main.pkg.version;
    out.mainSha256 = main.mainSha256;
    const c = counts(main.source);
    out.electronImports = c.electron;
    out.backgroundAnchors = c.bg;
    out.patched = !!entry(openArchiveCached(file), BOOTSTRAP_PATH, true);
    out.nativeTransparency = main.source.includes(SHARP_OPTS);
    out.acrylic = main.source.includes(ACRYLIC_OPTS);
    out.supported = c.electron === 1 && c.bg === 1;
    if (!out.supported) {
      out.reason =
        'Window constructor pattern not recognised (electron import matches: ' +
        c.electron +
        ', background anchors: ' +
        c.bg +
        ')';
    }
  } catch (e) {
    out.error = e.message;
    out.reason = e.message;
  }
  return out;
}

function openArchiveCached(file) {
  return openArchive(file);
}

function integrity(data) {
  return { algorithm: 'SHA256', hash: hash(data), blockSize: 4194304, blocks: [hash(data)] };
}

function validateSource(source) {
  const b = Buffer.isBuffer(source) ? Buffer.from(source) : Buffer.from(String(source), 'utf8');
  if (!b.length || b.length > 1024 * 1024 || b.includes(0)) fail('Invalid bootstrap source');
  if (!/from\s*["']electron["']/.test(b.toString('utf8'))) fail('Bootstrap must import electron');
  return b;
}

function buildMain(source, acrylic) {
  const c = counts(source);
  if (c.electron !== 1) fail('Expected exactly one electron import, found ' + c.electron);
  if (c.bg !== 1) fail('Expected exactly one window background option, found ' + c.bg);

  let text = source.replace(ELECTRON_FROM, IMPORT_AFTER);
  const m = BG_RE.exec(text);
  if (!m) fail('Window background option vanished after import edit');
  text = text.replace(m[0], acrylic ? ACRYLIC_OPTS : SHARP_OPTS);
  return Buffer.from(text, 'utf8');
}

function repack(a, source, output, acrylic) {
  const originalMain = readEntry(a, MAIN_PATH_OF(a));
  const patchedMain = buildMain(originalMain.data.toString('utf8'), acrylic);

  const entries = [];
  function walk(node, prefix) {
    for (const [name, child] of Object.entries(node.files || {})) {
      const full = prefix ? prefix + '/' + name : name;
      if (child.files) {
        walk(child, full);
        continue;
      }
      if (child.unpacked || child.link) {
        entries.push({ node: child, full, unpacked: true });
        continue;
      }
      const isMain = full === MAIN_PATH_OF(a);
      entries.push({
        node: child,
        full,
        oldOffset: Number(child.offset),
        data: isMain ? patchedMain : null,
        size: isMain ? patchedMain.length : child.size
      });
    }
  }
  walk(a.header, '');

  const bootstrapNode = { size: source.length, offset: '0', integrity: integrity(source) };
  const mainDir = a.header.files.out.files.main.files;
  mainDir[BOOTSTRAP_FILE] = bootstrapNode;
  entries.push({ node: bootstrapNode, full: BOOTSTRAP_PATH, data: source, size: source.length });

  let offset = 0;
  for (const e of entries) {
    if (e.unpacked) continue;
    e.node.offset = String(offset);
    if (!e.node.files) e.node.size = e.size;
    if (e.data) e.node.integrity = integrity(e.data);
    offset += e.size;
  }

  const text = Buffer.from(JSON.stringify(a.header), 'utf8');
  const padded = (text.length + 1 + 3) & ~3;
  const json = Buffer.alloc(padded);
  text.copy(json, 0);
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(json.length + 10, 4);
  head.writeUInt32LE(json.length + 6, 8);
  head.writeUInt32LE(text.length, 12);

  const out = fs.openSync(output, 'w');
  try {
    writeAt(out, head, 0);
    writeAt(out, json, 16);
    let position = 8 + head.readUInt32LE(4);
    for (const e of entries) {
      if (e.unpacked) continue;
      const data = e.data || readAt(a.fd, e.size, a.contentStart + e.oldOffset);
      writeAt(out, data, position);
      position += data.length;
    }
    fs.fsyncSync(out);
  } finally {
    fs.closeSync(out);
  }
  return { patchedMain, source };
}

function mainPathOf(a) {
  const pkg = JSON.parse(readEntry(a, 'package.json').data.toString('utf8'));
  return String(pkg.main).replace(/^\.\//, '');
}
const MAIN_PATH_OF = (a) => mainPathOf(a);

function verify(file, plan, acrylic) {
  const a = openArchive(file);
  try {
    const mainName = mainPathOf(a);
    const m = readEntry(a, mainName);
    const b = readEntry(a, BOOTSTRAP_PATH);
    if (!equal(m.data, plan.patchedMain) || !equal(b.data, plan.source)) fail('Post-write verification failed');
    const s = m.data.toString('utf8');
    if (!s.includes('./theme-studio-bootstrap.mjs')) fail('Loader import missing after patch');
    if (acrylic && !s.includes(ACRYLIC_OPTS)) fail('Acrylic options missing after patch');
    if (!acrylic && !s.includes(SHARP_OPTS)) fail('Transparent options missing after patch');
    return inspect(file);
  } finally {
    fs.closeSync(a.fd);
  }
}

function apply(file, bootstrapSource, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const acrylic = opts.acrylic === true;
  const before = inspect(file);

  if (!before.exists) throw new PatchError(before.error || 'Bundle not found');
  if (!before.supported) throw new PatchError(before.reason || 'Unsupported bundle');

  const variantMatches = acrylic ? before.acrylic : before.nativeTransparency;
  if (before.patched && variantMatches) {
    return {
      ok: true,
      applied: false,
      alreadyInstalled: true,
      version: before.version,
      backup: before.backup,
      blur: before.acrylic,
      before: before.sha256,
      after: before.sha256
    };
  }
  if (before.patched) {
    throw new PatchError('Already installed in the other window mode. Restore the original first, then install again.');
  }

  const source = validateSource(bootstrapSource);
  const backup = unique(backupPath(file));
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  if (fileHash(backup) !== before.sha256) fail('Backup verification failed');

  const temp = unique(path.resolve(file) + '.patch.' + process.pid + '.tmp');
  const a = openArchive(file);
  try {
    try {
      const plan = repack(a, source, temp, acrylic);
      const check = openArchive(temp);
      fs.closeSync(check.fd);
      fs.copyFileSync(temp, file);
      const after = verify(file, plan, acrylic);
      return {
        ok: true,
        applied: true,
        version: after.version,
        backup,
        backupPath: backup,
        blur: after.acrylic,
        before: before.sha256,
        after: after.sha256
      };
    } catch (e) {
      try {
        fs.copyFileSync(backup, file);
      } catch (rollback) {
        throw new PatchError('Patch and rollback failed: ' + e.message + '; backup: ' + backup + '; ' + rollback.message);
      }
      throw new PatchError('Patch failed, original restored from ' + backup + ': ' + e.message);
    }
  } finally {
    fs.closeSync(a.fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function restore(file) {
  const resolved = path.resolve(file);
  const before = inspect(resolved);
  if (!before.patched) {
    return { ok: true, restored: false, alreadyRestored: true, asarPath: resolved, backup: before.backup };
  }
  const dir = path.dirname(resolved);
  const prefix = path.basename(resolved) + '.bak.';
  const candidates = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith(prefix))
    .map((n) => path.join(dir, n))
    .filter((f) => fs.statSync(f).isFile())
    .sort()
    .reverse();

  let used = null;
  for (const candidate of candidates) {
    try {
      const info = readMain(candidate);
      if (info.source.includes('./theme-studio-bootstrap.mjs')) continue;
      used = candidate;
      break;
    } catch {
      continue;
    }
  }
  if (!used) fail('No clean backup found; cannot restore safely');

  fs.copyFileSync(used, resolved);
  const after = inspect(resolved);
  if (after.patched) fail('Restore verification failed');
  return { ok: true, restored: true, asarPath: resolved, backup: used, sha256: after.sha256, status: after };
}

module.exports = {
  BOOTSTRAP_PATH,
  BOOTSTRAP_FILE,
  ACRYLIC_OPTS,
  SHARP_OPTS,
  PatchError,
  inspect,
  status: inspect,
  readMain,
  apply,
  restore,
  backupPath,
  defaultAsar: () =>
    path.join(process.env.LOCALAPPDATA || '', 'Programs', '@opencode-aidesktop', 'resources', 'app.asar'),
  sha256: fileHash
};