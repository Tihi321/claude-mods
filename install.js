#!/usr/bin/env node
'use strict';
// Installs all the Claude Code mods in this repo for your user (every project):
//   ~/.claude/mods/                  settings-hooks/ plus config.json, built from the shipped config, then
//                                    settings-hooks/config.local.json (machine values, git-ignored), then
//                                    your existing ~/.claude/mods/config.json values, which win
//   ~/.claude/skills/replay-ticket/  the /replay-ticket skill
//   ~/.claude/settings.json          hooks + statusLine merged in (backup written first)
//   plugin mods                      this folder is added as the "tihi-mods" marketplace and every plugin
//                                    in plugins/ is installed with `claude plugin install` (user scope)
// Usage: node install.js [--uninstall] [--force-statusline] [--dry-run] [--home <dir>]
//                        [--hooks-only | --plugins-only]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : undefined; };

const HOME = path.resolve(opt('--home') || os.homedir());
const CLAUDE = path.join(HOME, '.claude');
const SRC = __dirname;
const MODS = path.join(CLAUDE, 'mods');
const HOOK_SRC = path.join(SRC, 'settings-hooks');
const SKILL = path.join(CLAUDE, 'skills', 'replay-ticket');
const SETTINGS = path.join(CLAUDE, 'settings.json');
const DRY = flag('--dry-run');
const MARK = '/.claude/mods/';

const fwd = (p) => p.split(path.sep).join('/');
const cmd = (script, ...args) => `node "${fwd(path.join(MODS, script))}"${args.length ? ' ' + args.join(' ') : ''}`;
const isOurs = (h) => h && typeof h.command === 'string' && h.command.replace(/\\/g, '/').includes(MARK);
const say = (s) => console.log(s);

const HOOKS = {
  PreToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: cmd('hooks/edit.js', 'pre'), timeout: 60 }] }],
  PostToolUse: [
    { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: cmd('hooks/edit.js', 'post'), timeout: 60 }] },
    { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: cmd('hooks/bash.js'), timeout: 20 }] },
  ],
  Stop: [{ hooks: [{ type: 'command', command: cmd('hooks/stop.js', 'main'), timeout: 180 }] }],
  SubagentStop: [{ hooks: [{ type: 'command', command: cmd('hooks/stop.js', 'subagent'), timeout: 180 }] }],
};
const STATUS = { type: 'command', command: cmd('statusline.js'), padding: 0, refreshInterval: 10 };

function copyDir(from, to, skip = () => false) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (skip(s, e)) continue;
    if (e.isDirectory()) { if (!DRY) fs.mkdirSync(d, { recursive: true }); copyDir(s, d, skip); }
    else if (!DRY) fs.copyFileSync(s, d);
  }
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

function readSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  let raw = fs.readFileSync(SETTINGS, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) {
    console.error(`Cannot parse ${SETTINGS}: ${e.message}\nFix the file (comments and trailing commas are not valid JSON) and run again. Nothing was changed.`);
    process.exit(1);
  }
}

function writeSettings(s) {
  if (DRY) { say('[dry-run] settings.json would become:\n' + JSON.stringify(s, null, 2)); return; }
  if (fs.existsSync(SETTINGS)) {
    let bak = `${SETTINGS}.bak-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)}`;
    for (let i = 2; fs.existsSync(bak); i++) bak = bak.replace(/(-\d+)?$/, '-' + i);
    fs.copyFileSync(SETTINGS, bak);
    say(`  backup: ${bak}`);
  }
  fs.mkdirSync(CLAUDE, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
}

function stripOurHooks(s) {
  if (!s.hooks || typeof s.hooks !== 'object') return s;
  for (const ev of Object.keys(s.hooks)) {
    const groups = (s.hooks[ev] || []).map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length);
    if (groups.length) s.hooks[ev] = groups; else delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

function install() {
  say(`Installing into ${CLAUDE}`);
  if (!DRY) fs.mkdirSync(MODS, { recursive: true });
  const userCfgPath = path.join(MODS, 'config.json');
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch (_) { return null; } };
  const userCfg = fs.existsSync(userCfgPath) ? readJson(userCfgPath) : null;
  const localCfg = readJson(path.join(HOOK_SRC, 'config.local.json'));
  copyDir(HOOK_SRC, MODS, (s) => /[\\/]cache$|[\\/]config(\.local(\.example)?)?\.json$/.test(s));
  // Retired jira-prefetch: copyDir only adds files, so remove what an older install left behind.
  for (const f of ['hooks/prompt.js', 'lib/jira.js', 'cache/jira']) if (!DRY) fs.rmSync(path.join(MODS, f), { recursive: true, force: true });
  let cfg = readJson(path.join(HOOK_SRC, 'config.json')) || {};
  if (localCfg) cfg = deepMerge(cfg, localCfg);
  if (userCfg) cfg = deepMerge(cfg, userCfg);
  delete cfg.jiraPrefetch;
  // The eol-guard plugin does this job; never run both on the same edit.
  if (!flag('--hooks-only') && pluginNames().includes('eol-guard') && cfg.eolGuard && cfg.eolGuard.enabled) {
    cfg.eolGuard.enabled = false;
    say('  config: eolGuard turned off (the eol-guard plugin covers it)');
  }
  if (!DRY) fs.writeFileSync(userCfgPath, JSON.stringify(cfg, null, 2) + '\n');
  say(`  mods/: ${userCfg ? 'updated (your config.json values kept)' : 'copied'}${localCfg ? ', config.local.json applied' : ''}`);
  if (!DRY) fs.mkdirSync(SKILL, { recursive: true });
  copyDir(path.join(SRC, 'skills', 'replay-ticket'), SKILL);
  say('  skills/replay-ticket: copied');

  const s = stripOurHooks(readSettings());
  s.hooks = s.hooks || {};
  for (const [ev, groups] of Object.entries(HOOKS)) s.hooks[ev] = [...(s.hooks[ev] || []), ...groups];
  if (s.statusLine && !isOurs(s.statusLine) && !flag('--force-statusline')) {
    say(`  statusLine: kept your existing one (${s.statusLine.command}). Re-run with --force-statusline to replace it.`);
  } else {
    if (s.statusLine && !isOurs(s.statusLine) && !DRY) {
      fs.writeFileSync(path.join(MODS, 'previous-statusline.json'), JSON.stringify(s.statusLine, null, 2));
      say('  statusLine: your previous one is saved and comes back on --uninstall');
    }
    s.statusLine = STATUS;
    say('  statusLine: set');
  }
  writeSettings(s);
}

// ---------- plugin mods (real Claude Code mods, installed through a local marketplace) ----------

const MARKET_DIR = SRC;
const MARKET_NAME = 'tihi-mods';
const MIN_CLAUDE = [2, 1, 289];

function pluginNames() {
  const m = JSON.parse(fs.readFileSync(path.join(MARKET_DIR, '.claude-plugin', 'marketplace.json'), 'utf8'));
  return m.plugins.map((p) => p.name);
}

// Runs `claude ...`. On Windows claude may be a .cmd/.ps1 shim, so go through the shell there.
function claude(args) {
  const win = process.platform === 'win32';
  const env = opt('--home') ? { ...process.env, HOME, USERPROFILE: HOME } : process.env;
  const r = win
    ? spawnSync(['claude', ...args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(' '), { shell: true, encoding: 'utf8', env })
    : spawnSync('claude', args, { encoding: 'utf8', env });
  const out = `${r.stdout || ''}${r.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '').trim();
  return { ok: r.status === 0 && !r.error, out, missing: !!r.error || /is not recognized as an internal|command not found|ENOENT/i.test(out) && r.status !== 0 };
}

function lastLine(s) { return (s.split(/\r?\n/).filter(Boolean).pop() || '').replace(/^.*?✔\s*/, '').split(' — ')[0]; }

function installPlugins() {
  const names = pluginNames();
  const cmds = [['plugin', 'marketplace', 'add', MARKET_DIR], ...names.map((n) => ['plugin', 'install', `${n}@${MARKET_NAME}`])];
  say(`\nPlugin mods (${names.join(', ')})`);
  if (DRY) { cmds.forEach((c) => say('  [dry-run] claude ' + c.join(' '))); return true; }

  const v = claude(['--version']);
  if (v.missing) {
    say('  ! `claude` is not on PATH. Run these yourself:');
    cmds.forEach((c) => say(`    claude ${c.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`));
    return false;
  }
  const ver = (/(\d+)\.(\d+)\.(\d+)/.exec(v.out) || []).slice(1).map(Number);
  const older = ver.length === 3 && (ver[0] - MIN_CLAUDE[0] || ver[1] - MIN_CLAUDE[1] || ver[2] - MIN_CLAUDE[2]) < 0;
  if (older) say(`  ! Claude Code ${ver.join('.')} is older than ${MIN_CLAUDE.join('.')}: the plugin mods install now but only run after \`claude update\`.`);

  let ok = true;
  for (const c of cmds) {
    const r = claude(c);
    const already = !r.ok && /already/i.test(r.out); // added or installed before: fine
    say(`  ${r.ok || already ? '✔' : '✖'} claude ${c.slice(1).join(' ').replace(MARKET_DIR, '.')}: ${lastLine(r.out)}`);
    if (!r.ok && !already) ok = false;
  }
  say(`  The marketplace is read in place from ${MARKET_DIR}: keep this clone there; edits apply on /reload-plugins.`);
  return ok;
}

function uninstallPlugins() {
  say('\nPlugin mods');
  const cmds = [...pluginNames().map((n) => ['plugin', 'uninstall', `${n}@${MARKET_NAME}`]), ['plugin', 'marketplace', 'remove', MARKET_NAME]];
  if (DRY) { cmds.forEach((c) => say('  [dry-run] claude ' + c.join(' '))); return; }
  for (const c of cmds) {
    const r = claude(c);
    if (r.missing) { say('  ! `claude` is not on PATH; run: claude ' + c.join(' ')); continue; }
    say(`  ${r.ok ? '✔' : '·'} claude ${c.slice(1).join(' ')}: ${lastLine(r.out)}`);
  }
}

function main() {
  const hooks = !flag('--plugins-only');
  const plugins = !flag('--hooks-only');
  if (flag('--uninstall')) {
    if (plugins) uninstallPlugins();
    if (hooks) uninstall();
    say('\nRestart Claude Code.');
    return;
  }
  if (hooks) install();
  const ok = plugins ? installPlugins() : true;
  say(`\n${ok ? 'Done' : 'Done, with problems above'}. Restart Claude Code (or run /reload-plugins), then run /mod-doctor to check everything loaded.`);
}

function uninstall() {
  say(`Removing settings-hook mods from ${CLAUDE}`);
  const s = stripOurHooks(readSettings());
  if (s.statusLine && isOurs(s.statusLine)) {
    delete s.statusLine;
    try { s.statusLine = JSON.parse(fs.readFileSync(path.join(MODS, 'previous-statusline.json'), 'utf8')); say('  statusLine: restored your previous one'); } catch (_) {}
  }
  writeSettings(s);
  if (!DRY) {
    fs.rmSync(MODS, { recursive: true, force: true });
    fs.rmSync(SKILL, { recursive: true, force: true });
  }
  say('  hooks, statusLine, mods/ and skills/replay-ticket removed.');
}

main();
