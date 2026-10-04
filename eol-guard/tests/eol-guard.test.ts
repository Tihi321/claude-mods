import { expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

import { decodeText, drifted, expectedEol, parseEol, tolerantPrettier, withEol } from '../hooks/lib'

const out = (stdout: string, exitCode = 0): ProcessRunResult => ({
  exitCode,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const b64 = (text: string) => btoa(text)

test('parses ls-files --eol and finds drifted files', async () => {
  const entries = parseEol(
    'i/lf    w/lf    attr/                 \tsrc/a.css\0' +
      'i/lf    w/crlf  attr/                 \tsrc/b.css\0' +
      'i/lf    w/mixed attr/                 \tyarn.lock\0' +
      'i/-text w/-text attr/                 \tlogo.png\0' +
      'i/lf    w/crlf  attr/text eol=lf      \tscripts/run.sh\0',
  )
  expect(entries.length).toBe(5)
  expect(expectedEol(entries[0]!, 'true')).toBe('crlf')
  expect(expectedEol(entries[0]!, 'input')).toBe('lf')
  expect(expectedEol(entries[3]!, 'true')).toBe(undefined)
  expect(drifted(entries, 'true')).toEqual([
    { path: 'src/a.css', eol: 'crlf' },
    { path: 'yarn.lock', eol: 'crlf' },
    { path: 'scripts/run.sh', eol: 'lf' },
  ])
  expect(drifted(entries, undefined)).toEqual([
    { path: 'src/b.css', eol: 'lf' },
    { path: 'yarn.lock', eol: 'lf' },
    { path: 'scripts/run.sh', eol: 'lf' },
  ])
})

test('converts endings and refuses non-UTF-8 or binary bytes', async () => {
  expect(withEol('a\nb\r\nc\n', 'crlf')).toBe('a\r\nb\r\nc\r\n')
  expect(withEol('a\r\nb\r\n', 'lf')).toBe('a\nb\n')
  expect(decodeText(b64('plain\n'))).toBe('plain\n')
  expect(decodeText(b64('\u00ef\u00bb\u00bfwith bom\n'))).toBe('\uFEFFwith bom\n')
  expect(decodeText(b64('bin\u0000ary'))).toBe(undefined)
  expect(decodeText(b64('bad \u00ff byte'))).toBe(undefined)
})

test('makes prettier checks tolerant of CRLF', async () => {
  expect(tolerantPrettier('yarn prettier --check . 2>&1 | tail -5')).toBe(
    'yarn prettier --check --end-of-line auto . 2>&1 | tail -5',
  )
  expect(tolerantPrettier('cd x && npx prettier -c src/a.css src/b.css')).toBe(
    'cd x && npx prettier -c --end-of-line auto src/a.css src/b.css',
  )
  expect(tolerantPrettier('yarn prettier --check --end-of-line auto .')).toBe(undefined)
  expect(tolerantPrettier('yarn prettier --write .')).toBe(undefined)
  expect(tolerantPrettier('yarn build')).toBe(undefined)
})

function gitWorld(on: On, lsEol: string) {
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('process.run', ($, e) => {
    const args = e.argv.slice(1).join(' ')
    if (args === 'rev-parse --show-toplevel') return { value: out('C:/repo\n') }
    if (args === 'config --get core.autocrlf') return { value: out('true\n') }
    if (args === 'diff --name-only -z') return { value: out('src/a.css\0') }
    if (args.startsWith('ls-files --eol -z --')) return { value: out(lsEol) }

    return { value: out('', 1) }
  })
}

test('puts CRLF back on a file a shell command rewrote as LF', async ($, on) => {
  mock.clock(on)
  gitWorld(on, 'i/lf    w/lf    attr/                 \tsrc/a.css\0')
  const writes: { path: string; text: string }[] = []
  on('fs.read', () => ({ value: { base64: b64('a {\n  color: red;\n}\n') } }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path.replace(/\\/g, '/'), text: e.text })

    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  const ran = await $.tool.call({ tool: 'Bash', command: "sed -i 's/blue/red/' src/a.css" })
  expect(writes).toEqual([{ path: 'C:/repo/src/a.css', text: 'a {\r\n  color: red;\r\n}\r\n' }])
  expect(ran.context?.[0]).toContain('put back CRLF line endings on src/a.css')
})

test('rewrites a prettier check and leaves clean files alone', async ($, on) => {
  mock.clock(on)
  gitWorld(on, 'i/lf    w/crlf  attr/                 \tsrc/a.css\0')
  let seen = ''
  on('fs.write', () => {
    throw new Error('nothing should be written')
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') seen = e.command

    return { result: { stdout: 'All matched files use Prettier code style!', stderr: '', interrupted: false } }
  })

  const ran = await $.tool.call({ tool: 'Bash', command: 'yarn prettier --check .' })
  expect(seen).toBe('yarn prettier --check --end-of-line auto .')
  expect(ran.context?.[0]).toContain('--end-of-line auto')
})
