'use strict';
// Status line: repo · branch ↑ahead ↓behind · changed files · upstream warning · dev ports · model
// Example: my-app  ABC-123-status-panel ↑1  3 changed  vite:5173 ●  Opus 5.5
const fs = require('fs');
const net = require('net');
const path = require('path');
const c = require('./lib/common');

const A = { reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', bold: '\x1b[1m' };

function gitInfo(dir) {
  const r = c.git(['status', '--porcelain=v2', '--branch'], dir, { timeout: 2500 });
  if (!r.ok) return null;
  const g = { head: '', upstream: '', ahead: 0, behind: 0, changed: 0, untracked: 0, conflicts: 0 };
  for (const line of r.out.split('\n')) {
    if (line.startsWith('# branch.head ')) g.head = line.slice(14);
    else if (line.startsWith('# branch.upstream ')) g.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(line); if (m) { g.ahead = +m[1]; g.behind = +m[2]; } }
    else if (line.startsWith('1 ') || line.startsWith('2 ')) g.changed++;
    else if (line.startsWith('u ')) g.conflicts++;
    else if (line.startsWith('? ')) g.untracked++;
  }
  const top = c.git(['rev-parse', '--show-toplevel'], dir);
  g.repo = top.ok ? path.basename(top.out) : path.basename(dir);
  return g;
}

function probe(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(250, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

async function ports(cfg) {
  const f = path.join(c.ensureDir(c.TMP_ROOT), 'ports.json');
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Date.now() - j.t < cfg.portCacheSeconds * 1000) return j.r;
  } catch (_) {}
  const r = await Promise.all((cfg.ports || []).map(async (p) => ({ ...p, up: await probe(p.port) })));
  try { fs.writeFileSync(f, JSON.stringify({ t: Date.now(), r })); } catch (_) {}
  return r;
}

function short(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

c.run(async () => {
  const input = c.readInput();
  const cfg = c.config().statusline;
  const dir = (input.workspace && input.workspace.current_dir) || input.cwd || process.cwd();
  const parts = [];
  const g = gitInfo(dir);
  if (g) {
    let b = `${A.bold}${g.repo}${A.reset}  ${A.cyan}${short(g.head, cfg.maxBranchLength)}${A.reset}`;
    if (g.ahead) b += ` ${A.green}↑${g.ahead}${A.reset}`;
    if (g.behind) b += ` ${A.yellow}↓${g.behind}${A.reset}`;
    parts.push(b);
    const dirty = g.changed + g.untracked;
    parts.push(dirty ? `${A.yellow}${g.changed} changed${g.untracked ? ` +${g.untracked} new` : ''}${A.reset}` : `${A.dim}clean${A.reset}`);
    if (g.conflicts) parts.push(`${A.red}${g.conflicts} conflict(s)${A.reset}`);
    const upName = g.upstream.replace(/^[^/]+\//, '');
    if (g.upstream && upName !== g.head) parts.push(`${A.red}⚠ tracks ${g.upstream}${A.reset}`);
    else if (!g.upstream && g.head !== '(detached)') parts.push(`${A.dim}not pushed${A.reset}`);
  } else {
    parts.push(`${A.bold}${path.basename(dir)}${A.reset}`);
  }
  for (const p of await ports(cfg)) {
    parts.push(p.up ? `${p.label}:${p.port} ${A.green}●${A.reset}` : `${A.dim}${p.label}:${p.port} ○${A.reset}`);
  }
  if (cfg.showModel && input.model && input.model.display_name) parts.push(`${A.dim}${input.model.display_name}${A.reset}`);
  await new Promise((r) => process.stdout.write(parts.join('  ') + '\n', r));
});
