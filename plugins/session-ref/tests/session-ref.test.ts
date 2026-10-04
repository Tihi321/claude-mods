import { expect, mock, test } from 'claude-code/testing'

import { digest, format, sessionIds, shellWrites, summary } from '../hooks/lib'

const ID = '4780fa3c-dd95-4d92-b385-4d616fce740a'

const row = (value: object) => JSON.stringify(value)

const TRANSCRIPT = [
  row({ type: 'mode', mode: 'normal' }),
  row({
    type: 'user',
    timestamp: '2026-09-29T09:51:00.000Z',
    cwd: 'C:\\projects\\Personal\\cdn',
    gitBranch: 'main',
    message: { content: 'fix workflows seems outdated for netlify' },
  }),
  row({ type: 'user', isMeta: true, timestamp: '2026-09-29T09:51:01.000Z', message: { content: 'caveat' } }),
  row({
    type: 'user',
    timestamp: '2026-09-29T09:52:00.000Z',
    message: { content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>' },
  }),
  row({
    type: 'assistant',
    timestamp: '2026-09-29T09:55:00.000Z',
    message: {
      content: [
        { type: 'text', text: 'Updating the workflow.' },
        { type: 'tool_use', name: 'Edit', input: { file_path: 'C:\\projects\\Personal\\cdn\\.github\\workflows\\main.yml' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'git add -A && git commit -q -m "ci: update netlify deploy" && git push' } },
      ],
    },
  }),
  row({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'x' } }] } }),
  row({
    type: 'user',
    timestamp: '2026-09-29T10:44:00.000Z',
    message: { content: [{ type: 'tool_result', content: 'ok' }, { type: 'text', text: 'it works, but i still get a warning' }] },
  }),
  row({ type: 'assistant', timestamp: '2026-09-29T10:45:00.000Z', message: { content: [{ type: 'text', text: 'The warning is harmless.' }] } }),
  'not json',
]

test('finds session ids once each', async () => {
  expect(sessionIds(`check ${ID} history and ${ID.toUpperCase()}`)).toEqual([ID])
  expect(sessionIds('no ids here')).toEqual([])
})

test('finds files written from the shell', async () => {
  expect(shellWrites("cd x && sed -i 's/a/b/' src/a.css src/b.css && yarn build")).toEqual(['src/a.css', 'src/b.css'])
  expect(shellWrites("Set-Content -Path notes/zed.md -Value $x; cat > .claude/tickets/t/plan.md <<'EOF'")).toEqual([
    '.claude/tickets/t/plan.md',
    'notes/zed.md',
  ])
  expect(shellWrites('sed -n 1,80p src/lib/audio/engine.ts')).toEqual([])
})

test('digests a transcript', async () => {
  const digested = digest(TRANSCRIPT)
  expect(digested.prompts).toEqual([
    { at: '09:51', text: 'fix workflows seems outdated for netlify' },
    { at: '09:52', text: '/model' },
    { at: '10:44', text: 'it works, but i still get a warning' },
  ])
  expect(digested.files).toEqual(['C:\\projects\\Personal\\cdn\\.github\\workflows\\main.yml'])
  expect(digested.commits).toEqual(['ci: update netlify deploy'])
  expect(digested.pushes).toBe(1)
  expect(digested.last).toBe('The warning is harmless.')
  expect(digested.branch).toBe('main')
  expect(summary(digested, 'cdn', ID)).toBe('cdn/4780fa3c (3 prompts, 1 files, 1 commits)')
  const text = format(digested, { id: ID, path: 'p.jsonl', place: 'cdn' })
  expect(text).toContain('Session 4780fa3c-dd95-4d92-b385-4d616fce740a · cdn · 2026-09-29 09:51 → 10:45 UTC')
  expect(text).toContain('- [10:44] it works, but i still get a warning')
})

test('a prompt naming a session gets its digest as context', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  const logs: string[] = []
  on('session.id', () => ({ value: 'own-session' }))
  on('fs.list', () => ({ value: [{ name: 'C--projects-Personal-cdn', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.exists', ($, e) => ({ value: e.path.replace(/\\/g, '/').endsWith(`C--projects-Personal-cdn/${ID}.jsonl`) }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 2000, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: TRANSCRIPT.join('\n') }))
  on('ui.log', ($, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  let context: readonly string[] = []
  on('prompt.submit', ($, e) => {
    context = e.context ?? []

    return { text: e.text }
  })

  await $.prompt.submit({ text: `check ${ID} history and update the build`, wait: false, origin: { kind: 'composer' } })
  expect(context.length).toBe(1)
  expect(context[0]).toContain('ci: update netlify deploy')
  expect(logs).toEqual([`session-ref: attached cdn/4780fa3c (3 prompts, 1 files, 1 commits)`])
})

test('a prompt with no known session passes untouched', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.id', () => ({ value: 'own-session' }))
  on('fs.list', () => ({ value: [] }))
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context

    return { text: e.text }
  })
  await $.prompt.submit({ text: `look at ${ID}`, wait: false, origin: { kind: 'composer' } })
  expect(context).toBe(undefined)
})
