// delete-guard: holds a recursive delete (rm -rf, Remove-Item -Recurse, rmdir /s, git clean -f)
// and shows what it would remove. You pick: move it to the trash instead (undo with /undo-delete),
// delete it for real, or refuse. Every delete gets a receipt line in the transcript.
//
//   delete-guard  Claude wants to delete 41 files (2.3 MB) in build, dist
//                 1. Move to trash (undo: /undo-delete)  2. Delete permanently  3. Refuse
//
// /undo-delete [stamp]   put the last trashed batch (or the named one) back
// /trash                 list trashed batches;  /trash purge [days]  remove batches older than N days (default 14)
// /delete-guard ask|trash|off   ask each time (default), always move to trash without asking, or turn off
//
// Moving and counting is done by a small Node script, so Node must be on PATH (it already is for
// the other mods). Without Node, the guard still asks before the command runs. No model calls.

const DEFAULTS = { mode: 'ask', keepDays: 14 }
let cfg = { ...DEFAULTS }

// ---------- the Node helper (runs outside the hooks module) ----------

export const HELPER = [
  "const fs=require('fs'),path=require('path'),os=require('os');",
  "const [cmd,raw]=process.argv.slice(1);const a=raw?JSON.parse(raw):{};",
  "const ROOT=path.join(os.homedir(),'.claude','mods-trash');",
  "const res=(p)=>{if(p==='~'||p.startsWith('~/')||p.startsWith('~\\\\'))p=path.join(os.homedir(),p.slice(1));return path.resolve(a.cwd||process.cwd(),p)};",
  "function walk(p,acc,t0){let st;try{st=fs.lstatSync(p)}catch(e){return}",
  " if(st.isDirectory()&&!st.isSymbolicLink()){let es=[];try{es=fs.readdirSync(p)}catch(e){}",
  "  for(const n of es){if(acc.files>=50000||Date.now()-t0>4000){acc.capped=true;return}walk(path.join(p,n),acc,t0)}}",
  " else{acc.files++;acc.bytes+=st.size}}",
  "function stat(){const t0=Date.now();return (a.targets||[]).map((t)=>{const abs=res(t);let st=null;try{st=fs.lstatSync(abs)}catch(e){}",
  " if(!st)return{target:t,abs,exists:false};const acc={files:0,bytes:0,capped:false};walk(abs,acc,t0);",
  " let sample=[];if(st.isDirectory()){try{sample=fs.readdirSync(abs).slice(0,5)}catch(e){}}",
  " return{target:t,abs,exists:true,isDir:st.isDirectory(),files:acc.files,bytes:acc.bytes,capped:acc.capped,sample}})}",
  "function move(from,to){try{fs.renameSync(from,to)}catch(e){if(e.code!=='EXDEV')throw e;fs.cpSync(from,to,{recursive:true,force:false,errorOnExist:true});fs.rmSync(from,{recursive:true,force:true})}}",
  "function trash(){const d=new Date(),pad=(n)=>String(n).padStart(2,'0');",
  " const stamp=d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())+'-'+Math.random().toString(36).slice(2,6);",
  " const dir=path.join(ROOT,stamp,'items');fs.mkdirSync(dir,{recursive:true});const items=[],failed=[];",
  " (a.targets||[]).forEach((t,i)=>{const from=res(t);if(!fs.existsSync(from))return;const to=path.join(dir,i+'-'+(path.basename(from)||'root'));",
  "  const acc={files:0,bytes:0};walk(from,acc,Date.now());try{move(from,to);items.push({from,to,files:acc.files,bytes:acc.bytes})}catch(e){failed.push({from,error:String(e.message||e)})}});",
  " const m={stamp,when:d.toISOString(),cwd:a.cwd,command:a.command,items};fs.writeFileSync(path.join(ROOT,stamp,'manifest.json'),JSON.stringify(m,null,2));",
  " if(!items.length)fs.rmSync(path.join(ROOT,stamp),{recursive:true,force:true});return{stamp,root:ROOT,items,failed}}",
  "function batches(){let ds=[];try{ds=fs.readdirSync(ROOT)}catch(e){return[]}const out=[];",
  " for(const s of ds.sort().reverse()){try{out.push(JSON.parse(fs.readFileSync(path.join(ROOT,s,'manifest.json'),'utf8')))}catch(e){}}return out}",
  "function restore(){const all=batches();const b=a.stamp?all.find((x)=>x.stamp===a.stamp||x.stamp.startsWith(a.stamp)):all.find((x)=>!x.restored);",
  " if(!b)return{error:a.stamp?'no trashed batch '+a.stamp:'nothing in the trash to restore'};const restored=[],skipped=[];",
  " for(const it of b.items){if(it.restored){continue}if(fs.existsSync(it.from)){skipped.push({from:it.from,why:'something is already there'});continue}",
  "  try{fs.mkdirSync(path.dirname(it.from),{recursive:true});move(it.to,it.from);it.restored=true;restored.push(it.from)}catch(e){skipped.push({from:it.from,why:String(e.message||e)})}}",
  " if(b.items.every((x)=>x.restored)){b.restored=true;fs.rmSync(path.join(ROOT,b.stamp),{recursive:true,force:true})}",
  " else fs.writeFileSync(path.join(ROOT,b.stamp,'manifest.json'),JSON.stringify(b,null,2));return{stamp:b.stamp,restored,skipped}}",
  "function purge(){const days=Number(a.days)||14,cut=Date.now()-days*86400000,removed=[];",
  " for(const b of batches()){if(Date.parse(b.when)<cut){fs.rmSync(path.join(ROOT,b.stamp),{recursive:true,force:true});removed.push(b.stamp)}}return{removed}}",
  "const out=cmd==='stat'?stat():cmd==='trash'?trash():cmd==='restore'?restore():cmd==='list'?batches():cmd==='purge'?purge():{error:'unknown '+cmd};",
  "process.stdout.write(JSON.stringify(out));",
].join(' ') // one line: safer as a single Windows command-line argument

// ---------- parsing (pure) ----------

const RISKY = [
  /(^|[\s;&|(])rm\s+(?:-[A-Za-z]*[rR][A-Za-z]*|--recursive)\b/,
  /\b(?:Remove-Item|ri)\b[^;|&]*\s-(?:Recurse|r)\b/i,
  /(^|[\s;&|(])(?:rmdir|rd|del|erase)\s+(?:[^;|&]*\s)?\/[sS]\b/,
  /\bgit\s+clean\s+(?:[^;|&]*\s)?-[A-Za-z]*f/,
]

export function isRisky(command) {
  const c = String(command || '')
  return RISKY.some((r) => r.test(c))
}

export function tokenize(s) {
  const out = []
  let cur = ''
  let quote = ''
  let had = false
  for (const ch of String(s)) {
    if (quote) {
      if (ch === quote) quote = ''
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      had = true
    } else if (/\s/.test(ch)) {
      if (cur || had) out.push(cur)
      cur = ''
      had = false
    } else cur += ch
  }
  if (quote) return null
  if (cur || had) out.push(cur)
  return out
}

const PS_VALUE_FLAGS = /^-(?:Include|Exclude|Filter|Credential|Stream)$/i
const PS_PATH_FLAGS = /^-(?:Path|LiteralPath|PSPath|LP)$/i
const UNSAFE = /[*?$`%<>]|\$\(/

// Returns { kind: 'paths', cwd, targets } | { kind: 'git-clean', cwd, flags, paths } | { kind: 'unknown' }
export function parseDelete(command, cwd) {
  let c = String(command || '').trim()
  // Allow one leading `cd <dir> &&` (or `;`), which is how Claude often writes it.
  const cd = /^(?:cd|Set-Location|sl|pushd)\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)\s*/i.exec(c)
  if (cd) {
    const dir = cd[1].replace(/^["']|["']$/g, '')
    if (UNSAFE.test(dir)) return { kind: 'unknown' }
    cwd = /^(?:[A-Za-z]:[\\/]|[\\/]|~)/.test(dir) ? dir : joinPath(cwd, dir)
    c = c.slice(cd[0].length)
  }
  if (/[;&|\n`]|\$\(/.test(c)) return { kind: 'unknown' }
  const t = tokenize(c)
  if (!t || !t.length) return { kind: 'unknown' }
  const head = t[0].toLowerCase()

  if (head === 'git' && t[1] === 'clean') {
    const flags = []
    const paths = []
    for (const x of t.slice(2)) {
      if (x === '--') continue
      if (/^--/.test(x)) { if (!/^--force$/.test(x)) flags.push(x); continue }
      if (/^-/.test(x)) { const f = x.slice(1).replace(/[fni]/g, ''); if (f) flags.push('-' + f); continue }
      paths.push(x)
    }
    return { kind: 'git-clean', cwd, flags, paths }
  }

  const targets = []
  if (head === 'rm' || head === 'remove-item' || head === 'ri' || head === 'del' || head === 'erase' || head === 'rd' || head === 'rmdir') {
    let endOfFlags = false
    for (let i = 1; i < t.length; i++) {
      const x = t[i]
      if (!endOfFlags && x === '--') { endOfFlags = true; continue }
      if (!endOfFlags && PS_VALUE_FLAGS.test(x)) return { kind: 'unknown' }
      if (!endOfFlags && PS_PATH_FLAGS.test(x)) { if (t[i + 1] === undefined) return { kind: 'unknown' }; targets.push(...t[++i].split(',')); continue }
      if (!endOfFlags && (/^-/.test(x) || /^\/[A-Za-z]$/.test(x))) continue
      targets.push(...(head === 'rm' ? [x] : x.split(',')))
    }
  } else return { kind: 'unknown' }

  const clean = targets.map((x) => x.trim()).filter(Boolean)
  if (!clean.length || clean.some((x) => UNSAFE.test(x))) return { kind: 'unknown' }
  return { kind: 'paths', cwd, targets: clean }
}

function joinPath(base, rel) {
  if (!base) return rel
  const sep = /\\/.test(base) && !/\//.test(base) ? '\\' : '/'
  return base.replace(/[\\/]+$/, '') + sep + rel
}

export function fmtBytes(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return (i ? n.toFixed(n >= 10 ? 0 : 1) : String(n)) + ' ' + u[i]
}

export function summarize(stats) {
  const live = stats.filter((s) => s.exists)
  const files = live.reduce((n, s) => n + s.files, 0)
  const bytes = live.reduce((n, s) => n + s.bytes, 0)
  const capped = live.some((s) => s.capped)
  const names = live.map((s) => s.target + (s.isDir ? '/' : '')).join(', ')
  return { files, bytes, capped, names, count: (capped ? 'at least ' : '') + files.toLocaleString('en-US') + ' file' + (files === 1 ? '' : 's') }
}

// ---------- needs $ ----------

async function helper($, cmd, args) {
  const r = await $.process.run(['node', '-e', HELPER, cmd, JSON.stringify(args || {})], { timeoutMs: 120000 })
  if (r.exitCode !== 0) throw new Error((r.stderr || 'node exited ' + r.exitCode).trim().split('\n').pop())
  return JSON.parse(r.stdout)
}

async function saveCfg($) {
  try { await $.store.set('config', cfg) } catch { /* keep in memory */ }
}

async function ask($, question, options) {
  try {
    return await $.ui.ask(question, { options, header: 'delete-guard' })
  } catch {
    return null // dismissed, "chat about this", or no UI (claude -p)
  }
}

async function guardPaths($, e, next, parsed) {
  let stats
  try { stats = await helper($, 'stat', { cwd: parsed.cwd, targets: parsed.targets }) } catch (err) {
    return guardUnknown($, e, next, 'could not inspect the paths (' + err.message + ')')
  }
  if (!stats.some((s) => s.exists)) return next(e) // nothing there: let it run (it does nothing)
  if (stats.some((s) => !s.exists)) {
    // Some paths don't resolve from where we think the shell is. Don't guess.
    return guardUnknown($, e, next, 'some paths were not found from ' + parsed.cwd)
  }
  const sum = summarize(stats)
  const what = sum.count + ' (' + fmtBytes(sum.bytes) + ') in ' + sum.names

  let choice = 'trash'
  if (cfg.mode === 'ask') {
    const sample = stats.filter((s) => s.isDir && s.sample.length).map((s) => s.target + ': ' + s.sample.join(', ') + (s.files > s.sample.length ? ', …' : '')).join('\n')
    const picked = await ask($, 'Claude wants to delete ' + what + '.\n\n' + e.command + (sample ? '\n\n' + sample : ''),
      ['Move to trash (undo: /undo-delete)', 'Delete permanently', 'Refuse'])
    choice = picked === null ? 'trash' : /^Move/.test(picked) ? 'trash' : /^Delete/.test(picked) ? 'delete' : 'refuse'
  }

  if (choice === 'refuse') {
    $.ui.log('refused: ' + what)
    return { deny: 'The user refused this delete (' + what + '). Do not delete these paths another way; ask the user what they want instead.' }
  }
  if (choice === 'delete') {
    const r = await next(e)
    if (!r.deny && !r.isError) $.ui.log('deleted ' + what)
    return r
  }
  let moved
  try {
    moved = await helper($, 'trash', { cwd: parsed.cwd, targets: parsed.targets, command: e.command })
  } catch (err) {
    return { deny: 'delete-guard could not move these paths to the trash (' + err.message + '), so nothing was deleted. Ask the user how to proceed.' }
  }
  const ok = moved.items.map((it) => it.from).join(', ')
  const bad = moved.failed.map((f) => f.from + ' (' + f.error + ')').join(', ')
  $.ui.log('moved to trash: ' + what + ' · /undo-delete puts it back' + (bad ? ' · not moved: ' + bad : ''))
  return {
    result: 'delete-guard: instead of running `' + e.command + '`, these paths were moved to the trash at ' + moved.root +
      ' (batch ' + moved.stamp + '), so they are gone from their original location: ' + (ok || 'none') + '.' +
      (bad ? ' These could NOT be moved and still exist: ' + bad + '.' : '') +
      ' Treat the moved paths as deleted. The user can restore them with /undo-delete.',
  }
}

async function guardUnknown($, e, next, why) {
  if (cfg.mode !== 'ask') return next(e)
  const picked = await ask($, 'Claude wants to run a delete that delete-guard cannot preview' + (why ? ' (' + why + ')' : '') + ':\n\n' + e.command, ['Run it', 'Refuse'])
  if (picked === 'Refuse') return { deny: 'The user refused this delete. Ask the user what they want instead.' }
  if (picked === null) return next(e) // no one to ask: Claude Code's own permission rules still apply
  const r = await next(e)
  if (!r.deny && !r.isError) $.ui.log('ran: ' + e.command)
  return r
}

async function guardGitClean($, e, next, parsed) {
  if (cfg.mode === 'off') return next(e)
  let list = []
  try {
    const r = await $.process.run(['git', 'clean', '-n', ...parsed.flags, ...(parsed.paths.length ? ['--', ...parsed.paths] : [])], { cwd: parsed.cwd, timeoutMs: 20000 })
    if (r.exitCode === 0) list = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('Would remove ')).map((l) => l.slice(13))
  } catch { /* fall through to the plain question */ }
  if (!list.length) return next(e)
  const shown = list.slice(0, 8).join('\n') + (list.length > 8 ? '\n… and ' + (list.length - 8) + ' more' : '')
  const picked = cfg.mode !== 'ask' ? null : await ask($, 'Claude wants to run ' + e.command + ', which removes ' + list.length + ' untracked path(s):\n\n' + shown, ['Run it', 'Refuse'])
  if (picked === 'Refuse') return { deny: 'The user refused this git clean. Ask the user what they want instead.' }
  const r = await next(e)
  if (!r.deny && !r.isError) $.ui.log('git clean removed ' + list.length + ' path(s)')
  return r
}

// ---------- hooks ----------

export function register(on) {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('config')
    if (saved && typeof saved === 'object') cfg = { ...DEFAULTS, ...saved }
    // Clear out old trash in the background.
    $.clock.after(30000, () => helper($, 'purge', { days: cfg.keepDays }).catch(() => {}))
    await $.command.register({ name: 'undo-delete', description: 'Put the last batch delete-guard moved to the trash back where it was', argumentHint: '[stamp]', immediate: true })
    await $.command.register({ name: 'trash', description: 'List what delete-guard moved to the trash, or purge [days]', argumentHint: '[purge [days]]', immediate: true })
    await $.command.register({ name: 'delete-guard', description: 'delete-guard mode: ask (default), trash (always, no question) or off', argumentHint: 'ask | trash | off' })
    return next(e)
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    if (cfg.mode === 'off' || !isRisky(e.command)) return next(e)
    let cwd = ''
    try { cwd = await $.session.cwd() } catch { /* unknown */ }
    const parsed = parseDelete(e.command, cwd)
    if (parsed.kind === 'paths') return guardPaths($, e, next, parsed)
    if (parsed.kind === 'git-clean') return guardGitClean($, e, next, parsed)
    return guardUnknown($, e, next, '')
  })

  on('command.run', { command: 'undo-delete' }, async ($, e) => {
    let r
    try { r = await helper($, 'restore', { stamp: String(e.args || '').trim() || undefined }) } catch (err) {
      return { text: 'undo-delete failed: ' + err.message }
    }
    if (r.error) return { text: r.error + '.' }
    const lines = []
    if (r.restored.length) lines.push('Restored from batch ' + r.stamp + ': ' + r.restored.join(', '))
    for (const s of r.skipped) lines.push('Not restored: ' + s.from + ' (' + s.why + ')')
    return { text: lines.join('\n') || 'Nothing to restore in batch ' + r.stamp + '.' }
  })

  on('command.run', { command: 'trash' }, async ($, e) => {
    const [cmd, days] = String(e.args || '').trim().split(/\s+/)
    try {
      if (cmd === 'purge') {
        const r = await helper($, 'purge', { days: Number(days) || cfg.keepDays })
        return { text: r.removed.length ? 'Removed ' + r.removed.length + ' batch(es) older than ' + (Number(days) || cfg.keepDays) + ' days.' : 'Nothing that old in the trash.' }
      }
      const all = await helper($, 'list', {})
      if (!all.length) return { text: 'The trash is empty.' }
      const lines = all.slice(0, 15).map((b) => {
        const files = b.items.reduce((n, it) => n + (it.files || 0), 0)
        const bytes = b.items.reduce((n, it) => n + (it.bytes || 0), 0)
        return b.stamp + '  ' + files + ' files, ' + fmtBytes(bytes) + '  ' + b.items.map((it) => it.from).join(', ')
      })
      return { text: lines.join('\n') + '\n\n/undo-delete <stamp> restores one; /trash purge [days] clears old ones (kept ' + cfg.keepDays + ' days).' }
    } catch (err) {
      return { text: 'trash: ' + err.message }
    }
  })

  on('command.run', { command: 'delete-guard' }, async ($, e) => {
    const m = String(e.args || '').trim().toLowerCase()
    if (m !== 'ask' && m !== 'trash' && m !== 'off') return { text: 'delete-guard is in "' + cfg.mode + '" mode. Use /delete-guard ask | trash | off.' }
    cfg.mode = m
    await saveCfg($)
    return { text: m === 'ask' ? 'delete-guard will ask before each recursive delete.' : m === 'trash' ? 'delete-guard will move recursive deletes to the trash without asking.' : 'delete-guard is off.' }
  })
}
