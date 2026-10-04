import { expect, mock, test } from 'claude-code/testing'
import { gitSummary, parseSuggestions } from '../hooks/register.js'

const BAND = {
  plugin: 'next-steps', component: 'AbovePrompt', requestId: 'above',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 110, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const REPLY = 'Run lint | Run eslint on the files changed in this branch and fix new errors\n2. Update changelog | Update .claude/tickets/ABC-123/changelog.md with what changed\n- Commit | Commit the change with message "ABC-123 store absent log as warning"'

function stubs(on, calls) {
  mock.clock(on)
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('prompt.submit', ($, e) => { calls.submitted.push(e); return { text: e.text } })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '## ABC-123-warn...origin/ABC-123-warn\n M src/a.ts\n M src/b.ts\n?? notes.md\n', stderr: '' } }))
  on('model.complete', ($, e) => { calls.model.push(e); return { value: { isAnswered: true, text: REPLY, usage: { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } })
}

test('parse and git summary', () => {
  const s = parseSuggestions(REPLY + '\nextra | ignored')
  expect(s.length).toBe(3)
  expect(s[1]).toEqual({ label: 'Update changelog', prompt: 'Update .claude/tickets/ABC-123/changelog.md with what changed' })
  expect(s[2].prompt).toBe('Commit the change with message "ABC-123 store absent log as warning"')
  expect(gitSummary('## main...origin/main\n M a\n?? b\n')).toBe('branch main...origin/main, 1 changed file(s) not committed, 1 untracked')
})

test('suggests after a turn and sends the picked prompt as the user', async ($, on) => {
  const calls = { model: [], submitted: [] }
  stubs(on, calls)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'ABC-123 make the store absent log a warning' })
  calls.submitted.length = 0
  await $.turn.complete({ turnId: 't', answer: 'Changed the log level in store.ts. Lint not run.', durationMs: 5, isAborted: false, usage: null })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(calls.model.length).toBe(1)
  expect(calls.model[0].model).toBe('haiku')
  expect(calls.model[0].prompt).toContain('ABC-123 make the store absent log a warning')
  expect(calls.model[0].prompt).toContain('2 changed file(s) not committed')
  expect(await ui.find({ key: 'next-1' })).toBeDefined()
  expect(await ui.find({ key: 'next-3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.press({ key: 'next-2' })
  expect(calls.submitted.length).toBe(1)
  expect(calls.submitted[0].text).toBe('Update .claude/tickets/ABC-123/changelog.md with what changed')
  expect(calls.submitted[0].origin.asUser).toBe(true)
  expect(await ui.find({ key: 'next-1' })).toBeUndefined()
})

test('no suggestions for aborted, subagent or manual-mode turns', async ($, on) => {
  const calls = { model: [], submitted: [] }
  stubs(on, calls)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.complete({ turnId: 't', answer: 'x', durationMs: 5, isAborted: true, usage: null })
  await $.turn.complete({ turnId: 't2', agentId: 'a1', answer: 'x', durationMs: 5, isAborted: false, usage: null })
  const r = await $.command.run({ command: 'next', args: 'manual' })
  expect(r.text).toContain('only when you run /next')
  await $.turn.complete({ turnId: 't3', answer: 'x', durationMs: 5, isAborted: false, usage: null })
  expect(calls.model.length).toBe(0)
})

test('/next generates on demand from the last answer', async ($, on) => {
  const calls = { model: [], submitted: [] }
  stubs(on, calls)
  on('session.messages', () => ({ value: [{ role: 'user', text: 'hi', toolUses: [] }, { role: 'assistant', text: 'Implemented the panel.', toolUses: [] }] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const r = await $.command.run({ command: 'next', args: '' })
  expect(r).toEqual({})
  expect(calls.model[0].prompt).toContain('Implemented the panel.')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'next-3' })).toBeDefined()
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ key: 'next-1' })).toBeUndefined()
})
