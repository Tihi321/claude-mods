#!/usr/bin/env node
'use strict';
// Builds replay-bundle.md for a ticket folder: what changed on the source branch (commits, diffstat,
// full diff incl. uncommitted work) plus every note in the ticket folder (plan.md, changelog.md, prompts).
// Usage: node bundle.js --ticket <repo>/.claude/tickets/<name> [--branch <b>] [--base master] [--max-file-lines 400]
// Prints a JSON summary on stdout.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').replace(/\r?\n$/, ''), err: (r.stderr || '').trim() };
}
function fail(msg) { process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n'); process.exit(1); }
const norm = (s) => s.toLowerCase().replace(/^(remotes\/)?origin\//, '').replace(/[_/\s]+/g, '-');

const ticketDir = path.resolve(arg('ticket', '') || fail('--ticket <folder> is required'));
if (!fs.existsSync(ticketDir)) fail(`ticket folder not found: ${ticketDir}`);
const top = git(['rev-parse', '--show-toplevel'], ticketDir);
if (!top.ok) fail(`not inside a git repo: ${ticketDir}`);
const repo = path.resolve(top.out);
const ticket = path.basename(ticketDir);
const maxLines = +arg('max-file-lines', 400);

// Base branch
let base = arg('base', '');
const has = (ref) => git(['rev-parse', '--verify', '--quiet', ref], repo).ok;
if (!base) base = has('origin/master') || has('master') ? 'master' : 'main';
const baseRef = has('origin/' + base) ? 'origin/' + base : base;
if (!has(baseRef)) fail(`base branch not found: ${base}`);

// Source branch: --branch, else a branch whose name matches the ticket folder (or its Jira key), else the current branch.
const current = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).out;
let branch = arg('branch', '');
let how = 'given';
if (!branch) {
  const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'], repo).out.split('\n').filter(Boolean);
  const want = norm(ticket);
  const keyM = /^[A-Z][A-Z0-9]+-\d+/.exec(ticket);
  const score = (r) => {
    const n = norm(r);
    if (n === want) return 3;
    if (n.includes(want)) return 2;
    if (keyM && r.includes(keyM[0])) return 1;
    return 0;
  };
  const cands = refs.filter((r) => !/HEAD$/.test(r) && norm(r) !== base && score(r) > 0)
    .sort((a, b) => score(b) - score(a) || (a.startsWith('origin/') ? 1 : 0) - (b.startsWith('origin/') ? 1 : 0) || (b === current) - (a === current));
  if (cands.length) { branch = cands[0]; how = 'matched ticket name'; }
  else if (current !== base && current !== 'HEAD') { branch = current; how = 'current branch (no name match)'; }
  else fail(`could not find a branch for "${ticket}"; pass --branch`);
}
const mergeBase = git(['merge-base', baseRef, branch], repo);
if (!mergeBase.ok) fail(`no merge base between ${baseRef} and ${branch}`);
const mb = mergeBase.out;

const commits = git(['log', '--no-merges', '--format=%h %s (%an, %ad)', '--date=short', `${mb}..${branch}`], repo).out;
const stat = git(['diff', '--stat=120', mb, branch], repo).out;
let diff = git(['diff', '--no-color', '--find-renames', mb, branch], repo).out;

// Uncommitted work counts when the source branch is checked out.
let wip = '';
let wipStat = '';
if (branch === current) {
  wip = git(['diff', '--no-color', '--find-renames', 'HEAD'], repo).out;
  wipStat = git(['diff', '--stat=120', 'HEAD'], repo).out;
}

function truncateDiff(d) {
  if (!d) return { text: '', truncated: [] };
  const truncated = [];
  const parts = d.split(/(?=^diff --git )/m).map((p) => {
    const lines = p.split('\n');
    if (lines.length <= maxLines) return p;
    const file = (/^diff --git a\/(\S+)/.exec(lines[0]) || [])[1] || '?';
    truncated.push(file);
    return lines.slice(0, maxLines).join('\n') + `\n[... ${lines.length - maxLines} more lines of ${file} truncated; run: git -C "${repo}" diff ${mb.slice(0, 10)} ${branch} -- ${file}]\n`;
  });
  return { text: parts.join(''), truncated };
}
const D = truncateDiff(diff);
const W = truncateDiff(wip);

// Notes in the ticket folder (plan.md first, then changelog.md, then the rest).
const OUT_NAME = 'replay-bundle.md';
const notes = fs.readdirSync(ticketDir)
  .filter((f) => /\.(md|txt)$/i.test(f) && f !== OUT_NAME)
  .sort((a, b) => {
    const rank = (f) => { const i = ['plan.md', 'changelog.md'].indexOf(f.toLowerCase()); return i < 0 ? 9 : i; };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
const noteText = notes.map((f) => {
  const lines = fs.readFileSync(path.join(ticketDir, f), 'utf8').split(/\r?\n/);
  const body = lines.length > 400 ? lines.slice(0, 400).join('\n') + `\n[... ${lines.length - 400} more lines]` : lines.join('\n');
  return `### ${f}\n\n${body.trim()}\n`;
}).join('\n');

const fence = (s) => '````diff\n' + s.replace(/\n?$/, '\n') + '````';
const md = `# Replay bundle: ${ticket}

| | |
|---|---|
| Source repo | ${repo} |
| Source branch | ${branch} (${how}) |
| Base | ${baseRef} @ ${mb.slice(0, 10)} |
| Built | ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC |

Implementers: reproduce the **intent** of this change in your target repo. Files will not match one to one;
map them by role (CI config, docs config, release script, package.json scripts...). If a part has no
equivalent in the target, skip it and say so in your report.

## Commits (${base}..${branch})

${commits || '(none: the change may be uncommitted, see below)'}

## Diffstat

\`\`\`
${stat || '(no committed changes)'}
\`\`\`
${wipStat ? `\n## Uncommitted changes on ${branch}\n\n\`\`\`\n${wipStat}\n\`\`\`\n` : ''}
## Ticket notes

${noteText || '(no notes in the ticket folder)'}
## Diff (committed)

${D.text ? fence(D.text) : '(empty)'}
${W.text ? `\n## Diff (uncommitted)\n\n${fence(W.text)}\n` : ''}`;

const outPath = path.join(ticketDir, OUT_NAME);
fs.writeFileSync(outPath, md);
process.stdout.write(JSON.stringify({
  ok: true, bundle: outPath, ticket, sourceRepo: repo, branch, branchFoundBy: how, base: baseRef,
  commits: commits ? commits.split('\n').length : 0,
  filesChanged: (stat.match(/^ \S.*\|/gm) || []).length,
  uncommittedFiles: (wipStat.match(/^ \S.*\|/gm) || []).length,
  notes, truncatedFiles: [...D.truncated, ...W.truncated], bytes: Buffer.byteLength(md),
}, null, 2) + '\n');
