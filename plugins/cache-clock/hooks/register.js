// cache-clock: a line above the prompt that shows how long the prompt cache stays warm,
// how much of each request was served from it, how full the context is, and plan usage,
// with a Compact button. No model calls.
//
//   cache warm 43m · hit 97% · ctx 160K/200K 80% · 5h 34% · 7d 12%   0: compact
//
// /cache            details for this session
// /cache ttl 5|60|auto   cache lifetime in minutes (auto = read it from the API, else 60)
// /cache warn <min> minutes before cold to show a toast (0 = never)
// /cache compact    compact the conversation now
// /cache off|on     hide or show the line

const DEFAULTS = { ttl: 'auto', warnMinutes: 5, show: true }
let cfg = { ...DEFAULTS }

let lastAt = 0 // when the main conversation's last request finished (ms)
let detectedTtl = 0 // minutes, from the API's cache_creation breakdown
let last = null // token counts of the last main request
const total = { requests: 0, read: 0, created: 0, input: 0 }
let usage = null // last $.session.usage() snapshot
let warnedFor = 0 // lastAt value we already warned about
let busy = false // a turn is running
let compacting = false

// ---------- helpers (pure) ----------

export function ttlMinutes() {
  const n = Number(cfg.ttl)
  if (cfg.ttl !== 'auto' && n > 0) return n
  return detectedTtl || 60
}

export function fmtTok(n) {
  if (!n || n < 0) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(n)
}

export function fmtLeft(ms) {
  if (ms <= 0) return '0m'
  const m = Math.floor(ms / 60000)
  if (m >= 60) return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm'
  if (m >= 1) return m + 'm'
  return Math.max(1, Math.round(ms / 1000)) + 's'
}

export function hitPct(u) {
  if (!u) return null
  const all = (u.read || 0) + (u.created || 0) + (u.input || 0)
  return all ? Math.round((100 * (u.read || 0)) / all) : null
}

const LIMIT_LABEL = { five_hour: '5h', seven_day: '7d', seven_day_opus: '7d opus', seven_day_sonnet: '7d sonnet' }

export function limitParts(u) {
  const out = []
  for (const r of (u && Array.isArray(u.rateLimits) ? u.rateLimits : [])) {
    const label = LIMIT_LABEL[r.kind]
    if (!label || typeof r.percentUsed !== 'number') continue
    out.push({ label, pct: Math.round(r.percentUsed), resetsAt: r.resetsAt })
  }
  return out
}

function fmtClock(t) {
  if (t === undefined || t === null || t === '') return ''
  const n = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t)
  if (!Number.isFinite(n)) return ''
  const d = new Date(n)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// ---------- state that needs $ ----------

async function refreshUsage($) {
  try { usage = await $.session.usage() } catch { /* not available in this app */ }
}

async function saveCfg($) {
  try { await $.store.set('config', cfg) } catch { /* keep in memory */ }
}

async function tick($) {
  if (!lastAt || busy || !cfg.show) return
  const now = await $.clock.now()
  const left = lastAt + ttlMinutes() * 60000 - now
  if (cfg.warnMinutes > 0 && left > 0 && left <= cfg.warnMinutes * 60000 && warnedFor !== lastAt) {
    warnedFor = lastAt
    await refreshUsage($)
    const ctx = usage && usage.context ? usage.context.tokens : 0
    if (ctx >= 20000) {
      $.ui.toast('Cache goes cold in ' + fmtLeft(left) + '. Your next message would re-send ' + fmtTok(ctx) +
        ' tokens at full price. Send it now, or /cache compact.', { timeoutMs: 20000 })
    }
  }
  $.ui.invalidate('ui.render')
}

async function compactNow($) {
  if (busy) { $.ui.toast('Claude is working. Compact once the turn ends.'); return 'Claude is working; compact once the turn ends.' }
  if (compacting) return 'Already compacting.'
  compacting = true
  $.ui.invalidate('ui.render')
  try {
    await $.session.compact()
    last = null
    lastAt = 0
    return 'Compacting the conversation.'
  } catch (err) {
    const msg = String((err && err.message) || err)
    $.ui.toast('Compact failed: ' + msg)
    return 'Compact failed: ' + msg
  } finally {
    compacting = false
    $.ui.invalidate('ui.render')
  }
}

async function details($) {
  await refreshUsage($)
  const now = await $.clock.now()
  const lines = []
  if (!lastAt) lines.push('No request in this session yet, so there is no cache to time.')
  else {
    const left = lastAt + ttlMinutes() * 60000 - now
    lines.push(left > 0
      ? 'Cache: warm for ' + fmtLeft(left) + ' more (lifetime ' + ttlMinutes() + ' min' + (cfg.ttl === 'auto' ? (detectedTtl ? ', read from the API' : ', assumed') : ', set by you') + ').'
      : 'Cache: cold since ' + fmtLeft(-left) + ' ago. The next message pays full price for the whole context.')
    if (last) lines.push('Last request: ' + fmtTok(last.read) + ' read from cache, ' + fmtTok(last.created) + ' written, ' + fmtTok(last.input) + ' uncached (' + hitPct(last) + '% hit).')
  }
  if (total.requests) lines.push('This session: ' + total.requests + ' requests, ' + fmtTok(total.read) + ' tokens from cache, ' + fmtTok(total.created) + ' written, ' + fmtTok(total.input) + ' uncached (' + hitPct(total) + '% hit).')
  if (usage && usage.context && usage.context.window) lines.push('Context: ' + fmtTok(usage.context.tokens) + ' of ' + fmtTok(usage.context.window) + ' (' + Math.round(usage.context.percent) + '%).')
  for (const l of limitParts(usage)) lines.push('Plan limit ' + l.label + ': ' + l.pct + '% used' + (fmtClock(l.resetsAt) ? ', resets ' + fmtClock(l.resetsAt) : '') + '.')
  lines.push('Settings: ttl ' + cfg.ttl + ', warn ' + cfg.warnMinutes + ' min, line ' + (cfg.show ? 'on' : 'off') + '. Change with /cache ttl 5|60|auto, /cache warn <min>, /cache on|off.')
  return lines.join('\n')
}

// ---------- hooks ----------

export function register(on) {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('config')
    if (saved && typeof saved === 'object') cfg = { ...DEFAULTS, ...saved }
    $.clock.every(20000, () => tick($))
    await $.command.register({
      name: 'cache',
      description: 'Cache clock: details, or ttl 5|60|auto, warn <min>, compact, on, off',
      argumentHint: '[ttl 5|60|auto | warn <min> | compact | on | off]',
      immediate: true,
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    busy = true
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Each request to the model: note when it finished and how much came from the cache.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (!e.agentId && result && result.usage) {
      const u = result.usage
      last = { read: u.cache_read_input_tokens || 0, created: u.cache_creation_input_tokens || 0, input: u.input_tokens || 0 }
      total.requests += 1
      total.read += last.read
      total.created += last.created
      total.input += last.input
      const cc = u.cache_creation
      if (cc && cc.ephemeral_1h_input_tokens > 0) detectedTtl = 60
      else if (cc && cc.ephemeral_5m_input_tokens > 0) detectedTtl = 5
      lastAt = await $.clock.now()
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      busy = false
      await refreshUsage($)
      $.ui.invalidate('ui.render')
    }
    return r
  })

  on('command.run', { command: 'cache' }, async ($, e) => {
    const [cmd, arg] = String(e.args || '').trim().split(/\s+/)
    switch ((cmd || '').toLowerCase()) {
      case '':
        return { text: await details($) }
      case 'compact':
        return { text: await compactNow($) }
      case 'ttl': {
        const v = (arg || '').toLowerCase()
        if (v === 'auto') cfg.ttl = 'auto'
        else if (Number(v) > 0) cfg.ttl = Number(v)
        else return { text: 'Usage: /cache ttl 5|60|auto' }
        await saveCfg($)
        $.ui.invalidate('ui.render')
        return { text: 'Cache lifetime: ' + (cfg.ttl === 'auto' ? 'auto (now ' + ttlMinutes() + ' min)' : cfg.ttl + ' min') + '.' }
      }
      case 'warn': {
        const n = Number(arg)
        if (!(n >= 0)) return { text: 'Usage: /cache warn <minutes>, 0 turns the warning off' }
        cfg.warnMinutes = n
        await saveCfg($)
        return { text: n ? 'Warning ' + n + ' min before the cache goes cold.' : 'Cold-cache warning off.' }
      }
      case 'on':
      case 'off':
        cfg.show = cmd.toLowerCase() === 'on'
        await saveCfg($)
        $.ui.invalidate('ui.render')
        return { text: 'Cache line ' + (cfg.show ? 'on' : 'off') + '.' }
      default:
        return { text: 'Usage: /cache [ttl 5|60|auto | warn <min> | compact | on | off]' }
    }
  })

  // The line above the prompt. Keeps whatever later mods draw there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (!cfg.show || !lastAt || e.props.isWorking || busy) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const left = lastAt + ttlMinutes() * 60000 - now
    const warm = left > 0
    const color = !warm ? 'red' : left <= cfg.warnMinutes * 60000 ? 'yellow' : 'green'
    const bits = []
    const pct = hitPct(last)
    if (pct !== null) bits.push('hit ' + pct + '%')
    if (usage && usage.context && usage.context.window) {
      bits.push('ctx ' + fmtTok(usage.context.tokens) + '/' + fmtTok(usage.context.window) + ' ' + Math.round(usage.context.percent) + '%')
    }
    for (const l of limitParts(usage)) bits.push(l.label + ' ' + l.pct + '%')
    const row = Box({
      key: 'cache-clock',
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ color, bold: true, children: [warm ? 'cache warm ' + fmtLeft(left) : 'cache cold'] }),
        Text({ dimColor: true, wrap: 'truncate-end', children: [bits.length ? '· ' + bits.join(' · ') : ''] }),
        Button({
          key: 'compact',
          label: compacting ? 'compacting…' : 'compact',
          hotkey: '0',
          plain: true,
          dimColor: warm && left > cfg.warnMinutes * 60000,
          onPress: () => compactNow($),
        }),
      ],
    })
    return below ? Box({ flexDirection: 'column', children: [below, row] }) : row
  })
}
