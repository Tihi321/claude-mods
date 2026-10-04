import { expect, test } from 'claude-code/testing'
import { isRisky, parseDelete, summarize, fmtBytes } from '../hooks/register.js'

test('detects risky deletes', () => {
  for (const c of ['rm -rf build', 'rm -r dist', 'cd app && rm -Rf node_modules/.cache', 'Remove-Item -Recurse -Force build', 'rmdir /s /q build', 'del /s /q *.log', 'git clean -fdx', 'ri build -r'])
    expect(isRisky(c)).toBe(true)
  for (const c of ['rm file.txt', 'git status', 'npm run clean', 'Remove-Item a.txt', 'echo rm -rf', 'git clean -n'])
    expect(isRisky(c)).toBe(c === 'echo rm -rf')
})

test('parses targets', () => {
  expect(parseDelete('rm -rf build "my dir"', '/w')).toEqual({ kind: 'paths', cwd: '/w', targets: ['build', 'my dir'] })
  expect(parseDelete('cd app && rm -rf dist', '/w')).toEqual({ kind: 'paths', cwd: '/w/app', targets: ['dist'] })
  expect(parseDelete('cd "C:\\p\\x" ; Remove-Item -LiteralPath out,tmp -Recurse -Force', 'C:\\w')).toEqual({ kind: 'paths', cwd: 'C:\\p\\x', targets: ['out', 'tmp'] })
  expect(parseDelete('rmdir /s /q build', 'C:\\w')).toEqual({ kind: 'paths', cwd: 'C:\\w', targets: ['build'] })
  expect(parseDelete('rm -rf build/*', '/w').kind).toBe('unknown')
  expect(parseDelete('rm -rf $OUT', '/w').kind).toBe('unknown')
  expect(parseDelete('rm -rf a && rm -rf b', '/w').kind).toBe('unknown')
  expect(parseDelete('Remove-Item -Recurse src -Include *.js', '/w').kind).toBe('unknown')
  expect(parseDelete('git clean -fdx -- build', '/w')).toEqual({ kind: 'git-clean', cwd: '/w', flags: ['-dx'], paths: ['build'] })
  expect(fmtBytes(2411724)).toBe('2.3 MB')
  expect(summarize([{ target: 'b', exists: true, isDir: true, files: 41, bytes: 10, capped: false }]).count).toBe('41 files')
})

// The Node helper is tested for real in tests/helper.node.mjs (node tests/helper.node.mjs).
// Here process.run is stubbed with what the helper prints.
const STAT = [{ target: 'build', abs: '/w/build', exists: true, isDir: true, files: 41, bytes: 4100, capped: false, sample: ['sub', 'index.html'] }]
const TRASH = { stamp: '20261003-101500-ab12', root: '/home/t/.claude/mods-trash', items: [{ from: '/w/build', to: '/x', files: 41, bytes: 4100 }], failed: [] }

function setup(on, answer: string | null, stat = STAT) {
  const log = { ran: [] as string[], logs: [] as string[], asked: [] as string[], helper: [] as string[] }
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/w' }))
  on('process.run', ($, e) => {
    const cmd = e.argv[3]
    log.helper.push(cmd)
    const out = cmd === 'stat' ? stat : cmd === 'trash' ? TRASH : cmd === 'restore' ? { stamp: TRASH.stamp, restored: ['/w/build'], skipped: [] } : cmd === 'list' ? [{ ...TRASH, when: 'x' }] : {}
    return { value: { exitCode: 0, stdout: JSON.stringify(out), stderr: '' } }
  })
  on('ui.log', ($, e) => { log.logs.push(e.text); return { value: undefined } })
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      log.asked.push(e.questions[0].question)
      if (answer === null) return { deny: 'dismissed' }
      return { result: { answers: { [e.questions[0].question]: answer } } }
    }
    log.ran.push(e.command)
    return { result: 'ran' }
  })
  return log
}

test('move to trash, list, undo', async ($, on) => {
  const log = setup(on, 'Move to trash (undo: /undo-delete)')
  const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(log.asked[0]).toContain('41 files (4.0 KB) in build/')
  expect(log.asked[0]).toContain('build: sub, index.html')
  expect(log.ran.length).toBe(0)
  expect(log.helper).toEqual(['stat', 'trash'])
  expect(out.result).toContain('moved to the trash')
  expect(log.logs[0]).toContain('moved to trash: 41 files')
  expect((await $.command.run({ command: 'trash', args: '' })).text).toContain('41 files')
  expect((await $.command.run({ command: 'undo-delete', args: '' })).text).toContain('Restored from batch 20261003-101500-ab12: /w/build')
})

test('delete permanently runs the command and logs a receipt', async ($, on) => {
  const log = setup(on, 'Delete permanently')
  await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item -Recurse -Force build' })
  expect(log.ran).toEqual(['Remove-Item -Recurse -Force build'])
  expect(log.logs[0]).toContain('deleted 41 files')
})

test('refuse denies', async ($, on) => {
  const log = setup(on, 'Refuse')
  const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(out.deny).toContain('refused')
  expect(log.ran.length).toBe(0)
  expect(log.helper).toEqual(['stat'])
})

test('no one to ask: moves to trash', async ($, on) => {
  const log = setup(on, null)
  const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(out.result).toContain('moved to the trash')
})

test('unparseable delete asks run or refuse', async ($, on) => {
  const log = setup(on, 'Run it')
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build/*' })
  expect(log.asked[0]).toContain('cannot preview')
  expect(log.ran).toEqual(['rm -rf build/*'])
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(log.ran.length).toBe(2)
  expect(log.asked.length).toBe(1)
})

test('paths that do not exist pass straight through', async ($, on) => {
  const log = setup(on, 'Refuse', [{ target: 'nope', abs: '/w/nope', exists: false }])
  await $.tool.call({ tool: 'Bash', command: 'rm -rf nope' })
  expect(log.asked.length).toBe(0)
  expect(log.ran).toEqual(['rm -rf nope'])
})

test('trash mode never asks; off mode does nothing', async ($, on) => {
  const log = setup(on, 'Refuse')
  await $.command.run({ command: 'delete-guard', args: 'trash' })
  const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(out.result).toContain('moved to the trash')
  await $.command.run({ command: 'delete-guard', args: 'off' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(log.ran).toEqual(['rm -rf build'])
  expect(log.asked.length).toBe(0)
})
