import { expect, mock, test } from 'claude-code/testing'
import { fmtLeft, fmtTok, hitPct, limitParts } from '../hooks/register.js'

const BAND = {
  plugin: 'cache-clock',
  component: 'AbovePrompt',
  requestId: 'above',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 110, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

function stubs(on, extra = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const toasts: string[] = []
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160000, window: 200000, percent: 80 }, rateLimits: [{ kind: 'five_hour', percentUsed: 34.2, resetsAt: '2026-10-03T18:00:00Z' }], cost: 0 } }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 150000, cache_creation_input_tokens: 4500, cache_creation: { ephemeral_1h_input_tokens: 4500, ephemeral_5m_input_tokens: 0 } } }
  })
  return { clock, toasts }
}

async function oneTurn($) {
  await $.turn.start({ turnId: 't1' })
  const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 3 })
  let step = await s.next()
  while (step.done !== true) step = await s.next()
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1000, isAborted: false, usage: null })
}

test('helpers format', () => {
  expect(fmtTok(160000)).toBe('160K')
  expect(fmtTok(1234567)).toBe('1.2M')
  expect(fmtLeft(43 * 60000 + 5000)).toBe('43m')
  expect(fmtLeft(75 * 60000)).toBe('1h15m')
  expect(fmtLeft(30000)).toBe('30s')
  expect(hitPct({ read: 97, created: 2, input: 1 })).toBe(97)
  expect(limitParts({ rateLimits: [{ kind: 'five_hour', percentUsed: 33.6 }, { kind: 'weird', percentUsed: 1 }] })).toEqual([{ label: '5h', pct: 34, resetsAt: undefined }])
})

test('band is empty before the first request, then counts down', async ($, on) => {
  const { clock } = stubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await ui.find({ key: 'compact' })).toBeUndefined()
  await ui.unmount()

  await oneTurn($)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'cache warm 1h00m' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /hit 97% · ctx 160K\/200K 80% · 5h 34%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()

  await clock.advance(61 * 60000)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'cache cold' })).toBeDefined()
})

test('warns once before the cache goes cold', async ($, on) => {
  const { clock, toasts } = stubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await oneTurn($)
  await clock.advance(50 * 60000)
  expect(toasts.length).toBe(0)
  await clock.advance(6 * 60000)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('re-send 160K tokens')
  await clock.advance(2 * 60000)
  expect(toasts.length).toBe(1)
})

test('compact button calls session.compact', async ($, on) => {
  stubs(on)
  let compacted = 0
  on('session.compact', () => { compacted++; return { value: undefined } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await oneTurn($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'compact' })
  expect(compacted).toBe(1)
})

test('/cache ttl 5 shortens the clock and /cache reports it', async ($, on) => {
  stubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await oneTurn($)
  const set = await $.command.run({ command: 'cache', args: 'ttl 5' })
  expect(set.text).toBe('Cache lifetime: 5 min.')
  const info = await $.command.run({ command: 'cache', args: '' })
  expect(info.text).toContain('warm for 5m more')
  expect(info.text).toContain('150K read from cache')
  expect(info.text).toContain('Plan limit 5h: 34% used')
})
