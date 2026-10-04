// next-steps: after Claude finishes a turn, a small model suggests three next prompts.
// They appear above the prompt as 1 / 2 / 3. Type the digit into the empty prompt (or click)
// to send that prompt as yours.
//
//   next  1: Run lint on changed files   2: Update changelog   3: Commit and push   dismiss
//
// /next              suggest now (also works in manual mode)
// /next auto|manual|off   when to suggest (default auto = after every turn)
// /next model <name>      model for suggestions (default haiku)
//
// Cost: one small model call per finished turn in auto mode (your last prompt, the end of
// Claude's reply and a git status line; about 1-3K input tokens, ~150 output). It does not
// touch the main conversation or its cache.

const DEFAULTS = { mode: 'auto', model: 'haiku' }
let cfg = { ...DEFAULTS }

let lastPrompt = ''
let suggestions = [] // [{ label, prompt }]
let generation = 0 // drops answers that arrive after a newer turn started
let thinking = false

const SYSTEM = [
  'You suggest what a developer should ask their coding agent to do next.',
  'Reply with exactly 3 lines and nothing else. Each line is: short label | full prompt',
  'The label is 2 to 5 words. The prompt is one imperative sentence of at most 30 words, specific to this work, written as the developer would type it.',
  'Order: 1) the most useful next step (often verifying the change: tests, lint, a manual check), 2) a natural follow-up or fix, 3) a wrap-up step (update notes or changelog, commit, open a PR) or an alternative direction.',
  'Never suggest something the agent says it already did. Do not number the lines.',
].join('\n')

// ---------- pure helpers ----------

export function parseSuggestions(text) {
  const out = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.):])\s*/, '').trim()
    const bar = line.indexOf('|')
    if (bar < 1) continue
    const label = line.slice(0, bar).trim().replace(/^["'`*]+|["'`*]+$/g, '')
    let prompt = line.slice(bar + 1).trim()
    if (prompt.length > 1 && /^["'`]/.test(prompt) && prompt[prompt.length - 1] === prompt[0]) prompt = prompt.slice(1, -1).trim()
    if (!label || !prompt) continue
    out.push({ label: label.slice(0, 40), prompt: prompt.slice(0, 600) })
    if (out.length === 3) break
  }
  return out
}

export function gitSummary(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean)
  if (!lines.length) return ''
  const head = lines[0].startsWith('## ') ? lines.shift().slice(3) : ''
  const changed = lines.filter((l) => !l.startsWith('??')).length
  const untracked = lines.filter((l) => l.startsWith('??')).length
  const parts = []
  if (head) parts.push('branch ' + head)
  parts.push(changed ? changed + ' changed file(s) not committed' : 'no uncommitted changes')
  if (untracked) parts.push(untracked + ' untracked')
  return parts.join(', ')
}

// ---------- needs $ ----------

async function saveCfg($) {
  try { await $.store.set('config', cfg) } catch { /* keep in memory */ }
}

async function generate($, prompt, answer) {
  const mine = ++generation
  thinking = true
  suggestions = []
  $.ui.invalidate('ui.render')
  try {
    let git = ''
    try {
      const r = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 4000 })
      if (r.exitCode === 0) git = gitSummary(r.stdout)
    } catch { /* not a repo, or git missing */ }
    const reply = await $.model.complete({
      model: cfg.model,
      system: SYSTEM,
      prompt:
        'Developer asked:\n' + String(prompt || '(unknown)').slice(-2500) +
        '\n\nAgent replied (end of reply):\n' + String(answer || '').slice(-5000) +
        (git ? '\n\nRepository: ' + git : ''),
      maxTokens: 300,
      timeoutMs: 25000,
    })
    if (mine !== generation) return
    suggestions = reply && reply.isAnswered ? parseSuggestions(reply.text) : []
  } catch {
    if (mine === generation) suggestions = []
  } finally {
    if (mine === generation) {
      thinking = false
      $.ui.invalidate('ui.render')
    }
  }
}

function pick($, i) {
  const s = suggestions[i]
  if (!s) return
  suggestions = []
  generation++
  $.ui.invalidate('ui.render')
  // Resolves when the turn starts; don't hold the press handler on it.
  $.prompt.submit({ text: s.prompt, asUser: true }).catch(() => $.ui.toast('Could not send: ' + s.prompt.slice(0, 60)))
}

function dismiss($) {
  suggestions = []
  generation++
  thinking = false
  $.ui.invalidate('ui.render')
}

// ---------- hooks ----------

export function register(on) {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('config')
    if (saved && typeof saved === 'object') cfg = { ...DEFAULTS, ...saved }
    await $.command.register({
      name: 'next',
      description: 'Suggest three next prompts now, or set mode: auto, manual, off, model <name>',
      argumentHint: '[auto | manual | off | model <name>]',
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    lastPrompt = String(e.text || '')
    if (suggestions.length || thinking) {
      suggestions = []
      thinking = false
      generation++
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && !e.isAborted && cfg.mode === 'auto' && String(e.answer || '').trim()) {
      // Don't make the end of the turn wait for the model.
      generate($, lastPrompt, e.answer).catch(() => {})
    }
    return r
  })

  on('command.run', { command: 'next' }, async ($, e) => {
    const [cmd, ...rest] = String(e.args || '').trim().split(/\s+/)
    const c = (cmd || '').toLowerCase()
    if (c === 'auto' || c === 'manual' || c === 'off') {
      cfg.mode = c
      await saveCfg($)
      if (c === 'off') dismiss($)
      return { text: 'next-steps: ' + (c === 'auto' ? 'suggesting after every turn' : c === 'manual' ? 'suggesting only when you run /next' : 'off') + '.' }
    }
    if (c === 'model') {
      if (!rest[0]) return { text: 'next-steps model: ' + cfg.model }
      cfg.model = rest[0]
      await saveCfg($)
      return { text: 'next-steps will use ' + cfg.model + '.' }
    }
    if (c) return { text: 'Usage: /next [auto | manual | off | model <name>]' }
    const msgs = await $.session.messages()
    const lastAnswer = [...msgs].reverse().find((m) => m.role === 'assistant' && m.text)
    if (!lastAnswer) return { text: 'Nothing to suggest from yet.' }
    await generate($, lastPrompt, lastAnswer.text)
    if (!suggestions.length) return { text: 'No suggestions came back.' }
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (cfg.mode === 'off' || e.props.isWorking || (!suggestions.length && !thinking)) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(20, (e.props.bodyColumns || 80) - 2)
    const rows = thinking
      ? [Text({ dimColor: true, children: ['next: thinking…'] })]
      : [
          ...suggestions.map((s, i) =>
            Box({
              key: 'row-' + i,
              flexDirection: 'row',
              columnGap: 1,
              width,
              children: [
                Button({ key: 'next-' + (i + 1), label: s.label, hotkey: String(i + 1), plain: true, onPress: () => pick($, i) }),
                Text({ dimColor: true, wrap: 'truncate-end', children: [s.prompt] }),
              ],
            }),
          ),
          Button({ key: 'dismiss', label: 'dismiss', plain: true, dimColor: true, onPress: () => dismiss($) }),
        ]
    const mine = Box({ key: 'next-steps', flexDirection: 'column', children: rows })
    return below ? Box({ flexDirection: 'column', children: [mine, below] }) : mine
  })
}
