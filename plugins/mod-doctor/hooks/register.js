// mod-doctor: /mod-doctor checks that every mod is installed and healthy, in one report.
//
// Covers both kinds:
//  - the settings-hook mods in ~/.claude/mods (lint-changed, eol-guard, git-guard, status line):
//    hook scripts present, config.json valid, Node version, errors and ESLint timings in the mods log
//  - the plugin mods from the tihi-mods marketplace (all nine in plugins/): enabled in settings,
//    their commands registered (for the ones that have one), Claude Code new enough, trash size
//
// No model calls. The report prints in the transcript, so you can ask Claude to fix what it flags.

// `command` is a slash command the mod registers when it loads; mods without one are checked as enabled only.
const PLUGIN_MODS = [
  { id: 'cache-clock@tihi-mods', command: 'cache' },
  { id: 'next-steps@tihi-mods', command: 'next' },
  { id: 'delete-guard@tihi-mods', command: 'undo-delete' },
  { id: 'mod-doctor@tihi-mods', command: 'mod-doctor' },
  { id: 'ship-bar@tihi-mods', command: 'ship-bar' },
  { id: 'ci-watch@tihi-mods' },
  { id: 'eol-guard@tihi-mods' },
  { id: 'plan-to-ticket@tihi-mods' },
  { id: 'session-ref@tihi-mods' },
]
const MIN_VERSION = '2.1.287'
const SLOW_LINT_MS = 5000

// ---------- pure helpers ----------

export function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

export function joinPath(base, ...parts) {
  const sep = /\\/.test(base) ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

// Script paths of settings hooks that belong to the ~/.claude/mods mods.
export function modHookScripts(settings) {
  const out = []
  const hooks = (settings && settings.hooks) || {}
  for (const ev of Object.keys(hooks)) {
    for (const g of hooks[ev] || []) {
      for (const h of (g && g.hooks) || []) {
        const cmd = String((h && h.command) || '')
        if (!cmd.replace(/\\/g, '/').includes('/.claude/mods/')) continue
        const m = /"([^"]+)"/.exec(cmd) || /node\s+(\S+)/.exec(cmd)
        if (m) out.push({ event: ev, script: m[1] })
      }
    }
  }
  const sl = settings && settings.statusLine && String(settings.statusLine.command || '')
  if (sl && sl.replace(/\\/g, '/').includes('/.claude/mods/')) {
    const m = /"([^"]+)"/.exec(sl)
    if (m) out.push({ event: 'statusLine', script: m[1] })
  }
  return out
}

// Parses the mods log: errors and ESLint timings within the window.
export function readLog(text, nowMs, windowMs) {
  const errors = []
  const lint = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(\S+) \[([^\]]*)\] (.*)$/.exec(line)
    if (!m) continue
    const t = Date.parse(m[1])
    if (!Number.isFinite(t) || nowMs - t > windowMs) continue
    const msg = m[3]
    const ms = /^eslint (\d+) file\(s\) in (.+): exit (\S+) (\d+)ms$/.exec(msg)
    if (ms) {
      const repo = ms[2].split(/[\\/]/).pop()
      const r = (lint[repo] = lint[repo] || { runs: 0, times: [], failures: 0 })
      r.runs++
      r.times.push(Number(ms[4]))
      if (ms[3] !== '0' && ms[3] !== '1') r.failures++
      continue
    }
    if (/^ERROR\b|Error\b|failed/.test(msg)) errors.push(m[1].slice(11, 19) + ' ' + m[2] + ' ' + msg.split('\n')[0].slice(0, 160))
  }
  for (const r of Object.values(lint)) {
    const s = [...r.times].sort((a, b) => a - b)
    r.median = s[Math.floor(s.length / 2)]
    r.max = s[s.length - 1]
    delete r.times
  }
  return { errors, lint }
}

// ---------- needs $ ----------

async function readJson($, p) {
  try {
    if (!(await $.fs.exists(p))) return { missing: true }
    let raw = await $.fs.read(p)
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    return { value: JSON.parse(raw) }
  } catch (err) {
    return { error: String((err && err.message) || err) }
  }
}

async function diagnose($) {
  const ok = []
  const warn = []
  const info = []
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
  const tmp = (await $.env.get('TEMP')) || (await $.env.get('TMPDIR')) || '/tmp'
  const claudeDir = home ? joinPath(home, '.claude') : ''

  // Claude Code version
  try {
    const v = await $.session.version()
    const ver = typeof v === 'string' ? v : (v && v.version) || ''
    const num = (/\d+\.\d+\.\d+/.exec(ver) || [''])[0]
    if (num && cmpVersion(num, MIN_VERSION) < 0) warn.push('Claude Code ' + num + ' is older than ' + MIN_VERSION + ', which plugin mods need. Run `claude update`.')
    else if (num) ok.push('Claude Code ' + num)
  } catch { /* unknown */ }

  // Node
  try {
    const r = await $.process.run(['node', '--version'], { timeoutMs: 5000 })
    if (r.exitCode !== 0) warn.push('`node --version` failed. The settings-hook mods and delete-guard need Node on PATH.')
    else ok.push('Node ' + r.stdout.trim())
  } catch {
    warn.push('Node is not on PATH. The settings-hook mods and delete-guard need it.')
  }

  // settings.json: hook mods and plugin mods
  const settings = claudeDir ? await readJson($, joinPath(claudeDir, 'settings.json')) : { missing: true }
  if (settings.error) warn.push('~/.claude/settings.json does not parse: ' + settings.error)
  const s = settings.value || {}

  const scripts = modHookScripts(s)
  if (!scripts.length) info.push('Settings-hook mods (lint-changed, eol-guard, git-guard, status line) are not installed. Run `node install.js` in your claude-mods clone.')
  else {
    const missing = []
    for (const x of scripts) if (!(await $.fs.exists(x.script))) missing.push(x.event + ': ' + x.script)
    if (missing.length) warn.push('Settings hooks point at scripts that are missing (re-run `node install.js`):\n  ' + missing.join('\n  '))
    else ok.push(scripts.length + ' settings hooks for the ~/.claude/mods mods, all scripts present')
    if (s.disableAllHooks) warn.push('`disableAllHooks` is true in settings.json, so no mod or hook runs.')
  }
  if (claudeDir) {
    const cfg = await readJson($, joinPath(claudeDir, 'mods', 'config.json'))
    if (cfg.error) warn.push('~/.claude/mods/config.json does not parse (' + cfg.error + '); the mods fall back to defaults.')
    else if (cfg.value) {
      const off = Object.entries(cfg.value).filter(([, v]) => v && v.enabled === false).map(([k]) => k)
      if (off.length) info.push('Turned off in config.json: ' + off.join(', '))
    }
  }

  const enabled = s.enabledPlugins || {}
  let cmds = []
  try { cmds = (await $.command.list()).map((c) => (typeof c === 'string' ? c : c && c.name)).filter(Boolean).map((n) => String(n).replace(/^\//, '')) } catch { /* unknown */ }
  for (const p of PLUGIN_MODS) {
    const on = enabled[p.id]
    const hasCmd = !!p.command && (cmds.includes(p.command) || cmds.some((n) => n.endsWith(':' + p.command)))
    if (on === false) info.push(p.id + ' is installed but disabled (/plugin to enable).')
    else if (on === undefined && !hasCmd) warn.push(p.id + ' is not installed. Run `node install.js` in your claude-mods clone.')
    else if (p.command && cmds.length && !hasCmd) warn.push(p.id + ' is enabled but /' + p.command + ' is not registered: the mod did not load. Check /plugin > Errors, then `/reload-plugins`.')
    else ok.push(p.id.split('@')[0] + (hasCmd ? ' loaded (/' + p.command + ')' : ' enabled'))
  }

  // The mods log
  const logPath = joinPath(tmp, 'claude-mods', 'mods.log')
  try {
    if (await $.fs.exists(logPath)) {
      const now = await $.clock.now()
      const { errors, lint } = readLog(await $.fs.read(logPath), now, 24 * 3600000)
      if (errors.length) warn.push(errors.length + ' error(s) in the mods log in the last 24 h (' + logPath + '). Latest:\n  ' + errors.slice(-3).join('\n  '))
      else ok.push('No errors in the mods log in the last 24 h')
      for (const [repo, r] of Object.entries(lint)) {
        const line = 'lint-changed in ' + repo + ': ' + r.runs + ' runs, median ' + r.median + ' ms, slowest ' + r.max + ' ms' + (r.failures ? ', ' + r.failures + ' ESLint failures (config or plugin problem)' : '')
        if (r.max > SLOW_LINT_MS || r.failures) warn.push(line + (r.max > SLOW_LINT_MS ? '. If that feels slow, set "baseline": false under lintChanged in ~/.claude/mods/config.json.' : ''))
        else ok.push(line)
      }
    } else if (scripts.length) info.push('No mods log yet at ' + logPath + '.')
  } catch (err) {
    info.push('Could not read the mods log: ' + String((err && err.message) || err))
  }

  // delete-guard trash
  if (claudeDir) {
    try {
      const trash = joinPath(claudeDir, 'mods-trash')
      if (await $.fs.exists(trash)) {
        const n = (await $.fs.list(trash)).filter((x) => x.kind === 'directory' || x.kind === 'dir').length
        if (n) info.push('delete-guard trash holds ' + n + ' batch(es). /trash lists them, /trash purge clears old ones.')
      }
    } catch { /* ignore */ }
  }

  const out = ['**mod-doctor**', '']
  if (warn.length) out.push('Needs attention:', ...warn.map((x) => '- ' + x), '')
  if (ok.length) out.push('OK:', ...ok.map((x) => '- ' + x), '')
  if (info.length) out.push('Notes:', ...info.map((x) => '- ' + x))
  return { text: out.join('\n').trim(), warnings: warn.length }
}

// ---------- hooks ----------

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mod-doctor', description: 'Check that every installed mod is loaded and healthy', immediate: true })
    return next(e)
  })

  on('command.run', { command: 'mod-doctor' }, async ($) => {
    const r = await diagnose($)
    return { text: r.text }
  })
}
