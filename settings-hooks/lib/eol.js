'use strict';
// eol-guard: keep a file's line endings the way they were before Claude touched it.
//   pre  (PreToolUse Edit|Write)   -> remember the file's style (crlf / lf)
//   post (PostToolUse Edit|Write)  -> if the style changed or became mixed, convert it back
//   bash (PostToolUse Bash|PowerShell) -> any tracked, modified file git reports as w/mixed gets normalised
//                                        to its own majority style (catches sed/node/python rewrites)

const fs = require('fs');
const path = require('path');
const c = require('./common');

const STATE = 'eol';

function key(file) {
  const p = path.resolve(file);
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function analyse(buf) {
  let crlf = 0, lf = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) return { binary: true };
    if (buf[i] === 10) { if (i > 0 && buf[i - 1] === 13) crlf++; else lf++; }
  }
  const style = crlf && lf ? 'mixed' : crlf ? 'crlf' : lf ? 'lf' : 'none';
  return { crlf, lf, style };
}

function readSmall(file, cfg) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > cfg.maxBytes) return null;
    return fs.readFileSync(file);
  } catch (_) { return null; }
}

function convert(buf, target) {
  const lfOnly = buf.toString('latin1').replace(/\r\n/g, '\n');
  const text = target === 'crlf' ? lfOnly.replace(/\n/g, '\r\n') : lfOnly;
  return Buffer.from(text, 'latin1'); // latin1 round-trips every byte, so UTF-8 content is untouched
}

// Style for a file that does not exist yet: what its siblings with the same extension use, if they agree.
function siblingStyle(file, cfg) {
  try {
    const dir = path.dirname(file);
    const ext = path.extname(file).toLowerCase();
    const styles = new Set();
    let n = 0;
    for (const name of fs.readdirSync(dir)) {
      if (n >= 5) break;
      if (path.extname(name).toLowerCase() !== ext || name === path.basename(file)) continue;
      const b = readSmall(path.join(dir, name), cfg);
      if (!b) continue;
      const a = analyse(b);
      if (a.style === 'crlf' || a.style === 'lf') { styles.add(a.style); n++; }
    }
    return styles.size === 1 ? [...styles][0] : null;
  } catch (_) { return null; }
}

function pre(input) {
  const cfg = c.config().eolGuard;
  const file = input.tool_input && input.tool_input.file_path;
  if (!cfg.enabled || !file) return;
  let style = null;
  if (fs.existsSync(file)) {
    const b = readSmall(file, cfg);
    if (!b) return;
    const a = analyse(b);
    if (a.binary) return;
    style = a.style === 'crlf' || a.style === 'lf' ? a.style : null;
  } else {
    style = siblingStyle(file, cfg);
  }
  c.updateState(input.session_id, STATE, (s) => {
    s.expected = s.expected || {};
    if (style) s.expected[key(file)] = style; else delete s.expected[key(file)];
    return s;
  });
}

function fixFile(file, target, cfg) {
  const b = readSmall(file, cfg);
  if (!b) return 0;
  const a = analyse(b);
  if (a.binary || a.style === 'none') return 0;
  const want = target || (a.crlf >= a.lf ? 'crlf' : 'lf');
  if (a.style === want) return 0;
  const changed = want === 'crlf' ? a.lf : a.crlf;
  fs.writeFileSync(file, convert(b, want));
  return changed;
}

function post(input, out) {
  const cfg = c.config().eolGuard;
  const file = input.tool_input && input.tool_input.file_path;
  if (!cfg.enabled || !file || !fs.existsSync(file)) return;
  const s = c.readState(input.session_id, STATE);
  const expected = (s.expected || {})[key(file)] || null;
  const b = readSmall(file, cfg);
  if (!b) return;
  const a = analyse(b);
  if (a.binary) return;
  // Known original style: enforce it. Unknown: only repair a mixed file.
  if (!expected && a.style !== 'mixed') return;
  const n = fixFile(file, expected, cfg);
  if (n) {
    const style = expected || (a.crlf >= a.lf ? 'crlf' : 'lf');
    out.tellUser(`eol-guard: restored ${style.toUpperCase()} in ${path.basename(file)} (${n} line${n === 1 ? '' : 's'})`);
    out.addContext(`eol-guard: ${path.basename(file)} uses ${style.toUpperCase()} line endings; ${n} line ending(s) your edit changed were converted back. Content is unchanged.`);
  }
}

function afterBash(input, out) {
  const cfg = c.config().eolGuard;
  if (!cfg.enabled) return;
  const command = (input.tool_input && input.tool_input.command) || '';
  const roots = new Set();
  for (const d of c.commandDirs(command, input.cwd)) {
    const r = c.repoRoot(d);
    if (r) roots.add(r);
  }
  const fixed = [];
  for (const root of roots) {
    // -m: modified tracked files only. --eol prints "i/<index> w/<worktree> attr/<...>\t<path>"
    const r = c.git(['ls-files', '-m', '--eol', '-z'], root);
    if (!r.ok || !r.out) continue;
    const entries = r.out.split('\0').filter(Boolean).slice(0, cfg.maxFilesAfterBash);
    for (const e of entries) {
      const tab = e.indexOf('\t');
      if (tab < 0) continue;
      const info = e.slice(0, tab);
      const rp = e.slice(tab + 1);
      if (!/\bw\/mixed\b/.test(info)) continue;
      const abs = path.join(root, rp);
      const idx = (/\bi\/(crlf|lf)\b/.exec(info) || [])[1];
      const b = readSmall(abs, cfg);
      if (!b) continue;
      const a = analyse(b);
      // Majority wins; ties go to the index style.
      const target = a.crlf > a.lf ? 'crlf' : a.lf > a.crlf ? 'lf' : (idx || 'lf');
      const n = fixFile(abs, target, cfg);
      if (n) fixed.push(`${rp} -> ${target.toUpperCase()} (${n})`);
    }
  }
  if (fixed.length) {
    out.tellUser(`eol-guard: fixed mixed line endings in ${fixed.length} file(s): ${fixed.slice(0, 5).join(', ')}${fixed.length > 5 ? ', ...' : ''}`);
    out.addContext(`eol-guard: your command left mixed line endings; normalised: ${fixed.join(', ')}. Content is unchanged.`);
  }
}

module.exports = { pre, post, afterBash, analyse, convert };
