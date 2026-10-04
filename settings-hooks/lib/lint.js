'use strict';
// lint-changed: lint only the files Claude edits, report only errors Claude introduced.
//   pre  (PreToolUse Edit|Write)  -> first touch of a file this session: record its existing errors (baseline)
//   post (PostToolUse Edit|Write) -> lint that one file, tell Claude about NEW errors (non-blocking)
//   stop (Stop / SubagentStop)    -> re-lint every file edited this session (or by this subagent), block once if new errors remain

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const c = require('./common');

const STATE = 'lint';

function key(file) {
  const p = path.resolve(file);
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function wanted(file, cfg) {
  return !!file && cfg.extensions.includes(path.extname(file).toLowerCase()) && !/[\\/]node_modules[\\/]/.test(file);
}

// Nearest node_modules/eslint walking up from the file, stopping at the repo root's parent.
function findEslint(file) {
  const stop = c.repoRoot(path.dirname(file));
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    const pkg = path.join(dir, 'node_modules', 'eslint', 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        const binRel = typeof j.bin === 'string' ? j.bin : (j.bin && j.bin.eslint) || 'bin/eslint.js';
        const bin = path.join(dir, 'node_modules', 'eslint', binRel);
        if (fs.existsSync(bin)) return { root: dir, bin, version: j.version };
      } catch (_) {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    if (stop && key(dir) === key(stop)) return null;
    dir = parent;
  }
}

function runEslint(info, files, cfg) {
  const cacheDir = c.ensureDir(path.join(c.TMP_ROOT, 'eslintcache', c.hash(key(info.root))));
  const args = [info.bin, '--format', 'json', '--cache', '--cache-location', cacheDir + path.sep,
    '--no-error-on-unmatched-pattern', ...files];
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, {
    cwd: info.root, encoding: 'utf8', windowsHide: true, timeout: cfg.timeoutMs, maxBuffer: 64 * 1024 * 1024,
  });
  c.log(`eslint ${files.length} file(s) in ${info.root}: exit ${r.status} ${Date.now() - t0}ms`);
  if (r.error) return { fatal: r.error.code === 'ETIMEDOUT' ? `timed out after ${cfg.timeoutMs} ms` : r.error.message };
  const outStr = r.stdout || '';
  const start = outStr.indexOf('[');
  if (r.status === 2 || start < 0) {
    const msg = (r.stderr || outStr).trim().split(/\r?\n/).filter(Boolean).slice(0, 4).join(' | ');
    return { fatal: msg || `eslint exited ${r.status}` };
  }
  let results;
  try { results = JSON.parse(outStr.slice(start)); } catch (e) { return { fatal: 'could not parse eslint output' }; }
  const byFile = new Map();
  for (const res of results) {
    const msgs = (res.messages || []).filter((m) =>
      (m.severity === 2 || (cfg.includeWarnings && m.severity === 1)) &&
      !(m.ruleId == null && /ignored/i.test(m.message || '')));
    byFile.set(key(res.filePath), msgs);
  }
  return { byFile };
}

const sig = (m) => `${m.ruleId || 'parse'}|${(m.message || '').replace(/\s+/g, ' ').trim()}`;
function counts(msgs) {
  const o = {};
  for (const m of msgs) o[sig(m)] = (o[sig(m)] || 0) + 1;
  return o;
}
// Messages whose signature occurs more often now than in the baseline.
function newMessages(msgs, base) {
  const now = counts(msgs);
  const extra = new Set(Object.keys(now).filter((s) => now[s] > ((base && base[s]) || 0)));
  return msgs.filter((m) => extra.has(sig(m)));
}

function fmt(m) {
  return `  ${m.line || 0}:${m.column || 0}  ${m.ruleId || 'parse-error'}  ${(m.message || '').replace(/\s+/g, ' ').trim()}`;
}

function lintOne(file, cfg) {
  const info = findEslint(file);
  if (!info) return { skip: 'no eslint' };
  const r = runEslint(info, [path.resolve(file)], cfg);
  if (r.fatal) return { fatal: r.fatal, info };
  return { msgs: r.byFile.get(key(file)) || [], info };
}

function reportFatal(sessionId, info, fatal, out) {
  c.updateState(sessionId, STATE, (s) => {
    s.fatalShown = s.fatalShown || {};
    const k = key(info.root) + '|' + fatal.slice(0, 80);
    if (!s.fatalShown[k]) {
      s.fatalShown[k] = 1;
      out.tellUser(`lint-changed: eslint could not run in ${path.basename(info.root)} (${fatal.slice(0, 300)})`);
    }
    return s;
  });
}

function pre(input, out) {
  const cfg = c.config().lintChanged;
  const file = input.tool_input && input.tool_input.file_path;
  if (!cfg.enabled || !cfg.baseline || !wanted(file, cfg)) return;
  const s = c.readState(input.session_id, STATE);
  if (s.baseline && s.baseline[key(file)]) return;
  let base = {};
  if (fs.existsSync(file)) {
    const r = lintOne(file, cfg);
    if (r.skip) return;
    if (r.fatal) { base = { __unknown: 1 }; } else base = counts(r.msgs);
  }
  c.updateState(input.session_id, STATE, (st) => {
    st.baseline = st.baseline || {};
    if (!st.baseline[key(file)]) st.baseline[key(file)] = base;
    return st;
  });
}

function post(input, out) {
  const cfg = c.config().lintChanged;
  const file = input.tool_input && input.tool_input.file_path;
  if (!cfg.enabled || !wanted(file, cfg) || !fs.existsSync(file)) return;
  const r = lintOne(file, cfg);
  if (r.skip) return;
  const st = c.updateState(input.session_id, STATE, (s) => {
    s.edited = s.edited || {};
    s.edited[key(file)] = { path: path.resolve(file), agent: input.agent_id || 'main' };
    return s;
  });
  if (r.fatal) return reportFatal(input.session_id, r.info, r.fatal, out);
  const base = (st.baseline || {})[key(file)];
  const fresh = base && base.__unknown ? [] : newMessages(r.msgs, cfg.baseline ? base : {});
  if (!fresh.length) return;
  const root = c.repoRoot(file);
  const shown = fresh.slice(0, cfg.maxReported).map(fmt).join('\n');
  const more = fresh.length > cfg.maxReported ? `\n  ...and ${fresh.length - cfg.maxReported} more` : '';
  out.addContext(`lint-changed: ${fresh.length} new ESLint error(s) in ${c.rel(file, root)}${cfg.baseline ? ' (errors that existed before your edit are not listed)' : ''}:\n${shown}${more}\nFix these as part of this change. Files you edit are re-linted before you finish.`);
  out.tellUser(`lint-changed: ${fresh.length} new error(s) in ${path.basename(file)}`);
}

function stop(input, out, kind) {
  const cfg = c.config().lintChanged;
  if (!cfg.enabled || !cfg.stopGate || input.stop_hook_active) return;
  const s = c.readState(input.session_id, STATE);
  const edited = Object.values(s.edited || {}).filter((e) =>
    fs.existsSync(e.path) && (kind !== 'subagent' || e.agent === (input.agent_id || 'main')));
  if (!edited.length) return;

  const groups = new Map();
  for (const e of edited) {
    const info = findEslint(e.path);
    if (!info) continue;
    if (!groups.has(info.root)) groups.set(info.root, { info, files: [] });
    groups.get(info.root).files.push(e.path);
  }
  const problems = [];
  for (const { info, files } of groups.values()) {
    const r = runEslint(info, files, cfg);
    if (r.fatal) { reportFatal(input.session_id, info, r.fatal, out); continue; }
    for (const f of files) {
      const base = (s.baseline || {})[key(f)];
      if (base && base.__unknown) continue;
      const fresh = newMessages(r.byFile.get(key(f)) || [], cfg.baseline ? base : {});
      if (fresh.length) problems.push({ file: f, fresh });
    }
  }
  if (!problems.length) return;

  const total = problems.reduce((n, p) => n + p.fresh.length, 0);
  const fingerprint = c.hash(problems.map((p) => key(p.file) + JSON.stringify(counts(p.fresh))).sort().join('\n'));
  const scope = kind === 'subagent' ? 'agent:' + (input.agent_id || '') : 'main';
  let already = false;
  c.updateState(input.session_id, STATE, (st) => {
    st.lastBlock = st.lastBlock || {};
    already = st.lastBlock[scope] === fingerprint;
    st.lastBlock[scope] = fingerprint;
    return st;
  });
  if (already) return; // same errors as the last time we blocked: Claude (or the user) already decided

  let budget = cfg.maxReported;
  const lines = [];
  for (const p of problems) {
    lines.push(`${c.rel(p.file, c.repoRoot(p.file))}:`);
    for (const m of p.fresh.slice(0, Math.max(budget, 0))) lines.push(fmt(m));
    budget -= p.fresh.length;
  }
  if (budget < 0) lines.push(`  ...and ${-budget} more`);
  out.blockWith(`lint-changed: ${total} new ESLint error(s) remain in files edited ${kind === 'subagent' ? 'by this agent' : 'this session'}:\n${lines.join('\n')}\nFix them, or if they should stay, say why in your reply. This check will not block again for the same errors.`);
  out.tellUser(`lint-changed: ${total} new lint error(s) in ${problems.length} file(s), asked Claude to fix before finishing`);
}

module.exports = { pre, post, stop, findEslint, newMessages, counts };
