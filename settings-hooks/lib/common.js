'use strict';
// Shared helpers for the Claude Code mods. Every hook must fail open:
// an exception here should never block Claude, so callers wrap main() in run().

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const MODS_DIR = path.resolve(__dirname, '..');
const TMP_ROOT = path.join(os.tmpdir(), 'claude-mods');

const DEFAULTS = {
  lintChanged: {
    enabled: true,
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
    baseline: true,          // lint once before the first edit so only NEW errors are reported
    includeWarnings: false,
    timeoutMs: 45000,
    maxReported: 15,
    stopGate: true,          // Stop / SubagentStop re-lint every file edited this session
  },
  // Off by default: the eol-guard plugin in this marketplace does the same job (and more).
  eolGuard: { enabled: false, maxBytes: 5000000, maxFilesAfterBash: 300 },
  gitGuard: { enabled: true, setAutoSetupRemote: true },
  statusline: {
    ports: [],   // e.g. [{ port: 5173, label: 'vite' }]
    portCacheSeconds: 10,
    showModel: true,
    maxBranchLength: 42,
  },
};

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

let _config;
function config() {
  if (_config) return _config;
  let user = {};
  try {
    user = JSON.parse(stripBom(fs.readFileSync(path.join(MODS_DIR, 'config.json'), 'utf8')));
  } catch (_) { /* missing or invalid config: defaults */ }
  _config = deepMerge(DEFAULTS, user);
  return _config;
}

function stripBom(s) { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }

function readInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(stripBom(raw)) : {};
  } catch (e) {
    log('readInput failed: ' + e.message);
    return {};
  }
}

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }

function log(msg) {
  try {
    ensureDir(TMP_ROOT);
    const f = path.join(TMP_ROOT, 'mods.log');
    try { if (fs.statSync(f).size > 1_000_000) fs.renameSync(f, f + '.1'); } catch (_) {}
    fs.appendFileSync(f, `${new Date().toISOString()} [${path.basename(process.argv[1] || '')} ${process.argv[2] || ''}] ${msg}\n`);
  } catch (_) {}
}

// Per-session JSON state, shared by the main agent and its subagents (same session_id).
function statePath(sessionId, name) {
  const sid = String(sessionId || 'nosession').replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(ensureDir(path.join(TMP_ROOT, 'sessions', sid)), name + '.json');
}
function readState(sessionId, name) {
  try { return JSON.parse(fs.readFileSync(statePath(sessionId, name), 'utf8')); } catch (_) { return {}; }
}
function writeState(sessionId, name, obj) {
  const p = statePath(sessionId, name);
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, p);
}
// Read-modify-write with a crude lock so parallel subagent hooks don't clobber each other.
function updateState(sessionId, name, fn) {
  const lock = statePath(sessionId, name) + '.lock';
  const deadline = Date.now() + 3000;
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(lock, 'wx'); } catch (_) {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock); } catch (_) {}
      if (Date.now() > deadline) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    const s = readState(sessionId, name);
    const r = fn(s) || s;
    writeState(sessionId, name, r);
    return r;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); fs.unlinkSync(lock); } catch (_) {} }
  }
}

function git(args, cwd, opts = {}) {
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 15000,
  });
  return { ok: r.status === 0, out: (r.stdout || '').replace(/\r?\n$/, ''), err: (r.stderr || '').trim(), status: r.status };
}

function repoRoot(dir) {
  if (!dir) return null;
  try { if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir); } catch (_) { dir = path.dirname(dir); }
  if (!fs.existsSync(dir)) return null;
  const r = git(['rev-parse', '--show-toplevel'], dir);
  return r.ok && r.out ? path.resolve(r.out) : null;
}

// Directories a shell command probably operated in: hook cwd, `cd X`, `Set-Location X`, `git -C X`.
function commandDirs(command, cwd) {
  const dirs = [cwd];
  const re = /(?:^|[;&|]\s*|\n\s*)(?:cd|Set-Location|pushd|sl)\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))|git\s+-C\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  let m;
  while ((m = re.exec(command || ''))) {
    const p = m[2] || m[3] || m[4] || m[6] || m[7] || m[8];
    if (!p || p === '-') continue;
    dirs.push(path.resolve(cwd || '.', toNativePath(p)));
  }
  return [...new Set(dirs.filter(Boolean))];
}

// Git Bash style /c/projects/x -> C:\projects\x on Windows.
function toNativePath(p) {
  if (process.platform === 'win32') {
    const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
    if (m) return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
  }
  return p;
}

function hash(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12); }

function rel(file, root) {
  const r = root ? path.relative(root, file) : file;
  return r.split(path.sep).join('/');
}

// Collects outputs from several mods in one hook run and prints a single JSON object.
class Output {
  constructor(event) { this.event = event; this.context = []; this.user = []; this.block = []; }
  addContext(s) { if (s) this.context.push(s); }
  tellUser(s) { if (s) this.user.push(s); }
  blockWith(s) { if (s) this.block.push(s); }
  flush() {
    const o = {};
    if (this.block.length) { o.decision = 'block'; o.reason = this.block.join('\n\n'); }
    if (this.context.length && ['PostToolUse', 'UserPromptSubmit', 'PreToolUse'].includes(this.event)) {
      o.hookSpecificOutput = { hookEventName: this.event, additionalContext: this.context.join('\n\n').slice(0, 9900) };
    }
    if (this.user.length) o.systemMessage = this.user.join('\n');
    // Resolve only once the write is flushed: run() calls process.exit right after.
    return new Promise((resolve) => {
      if (!Object.keys(o).length) return resolve();
      process.stdout.write(JSON.stringify(o), () => resolve());
    });
  }
}

function run(main) {
  Promise.resolve()
    .then(main)
    .catch((e) => log('ERROR ' + (e && e.stack || e)))
    .finally(() => process.exit(0));
}

module.exports = {
  MODS_DIR, TMP_ROOT, DEFAULTS, config, readInput, log, ensureDir, readState, writeState, updateState,
  git, repoRoot, commandDirs, toNativePath, hash, rel, Output, run, stripBom, deepMerge,
};
