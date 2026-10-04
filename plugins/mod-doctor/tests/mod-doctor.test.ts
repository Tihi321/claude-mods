import { expect, mock, test } from 'claude-code/testing'
import { cmpVersion, modHookScripts, readLog } from '../hooks/register.js'

const HOME = 'C:\\Users\\me'
const S = (p) => p.replace(/\\/g, '/')
const SETTINGS = {
  hooks: {
    PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node "C:/Users/me/.claude/mods/hooks/edit.js" pre' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'node "C:/Users/me/.claude/mods/hooks/stop.js" main' }, { type: 'command', command: 'other.sh' }] }],
  },
  statusLine: { type: 'command', command: 'node "C:/Users/me/.claude/mods/statusline.js"' },
  enabledPlugins: { 'cache-clock@tihi-mods': true, 'next-steps@tihi-mods': false, 'mod-doctor@tihi-mods': true, 'ci-watch@tihi-mods': true },
}
const NOW = Date.parse('2026-10-03T12:00:00Z')
const LOG = [
  '2026-10-03T10:00:00.000Z [edit.js post] eslint 1 file(s) in C:\\projects\\my-app: exit 1 7200ms',
  '2026-10-03T10:01:00.000Z [edit.js post] eslint 1 file(s) in C:\\projects\\my-app: exit 0 900ms',
  '2026-10-03T10:02:00.000Z [edit.js post] eslint 1 file(s) in C:\\projects\\other-app: exit 0 300ms',
  '2026-10-03T11:00:00.000Z [prompt.js ] jira: Error: fetch failed',
  '2026-10-01T11:00:00.000Z [prompt.js ] ERROR old one',
].join('\n')

test('helpers', () => {
  expect(cmpVersion('2.1.286', '2.1.287') < 0).toBe(true)
  expect(cmpVersion('2.2.0', '2.1.287') > 0).toBe(true)
  expect(modHookScripts(SETTINGS).map((x) => x.event)).toEqual(['PreToolUse', 'Stop', 'statusLine'])
  const r = readLog(LOG, NOW, 24 * 3600000)
  expect(r.errors.length).toBe(1)
  expect(r.lint['my-app']).toEqual({ runs: 2, failures: 0, median: 7200, max: 7200 })
})

test('report flags what needs attention', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/w' }))
  on('env.get', ($, e) => ({ value: { USERPROFILE: HOME, TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp', ATLASSIAN_EMAIL: 'a@b' }[e.name] }))
  on('session.version', () => ({ value: '2.1.290' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'v22.3.0\n', stderr: '' } }))
  on('command.list', () => ({ value: [{ name: 'cache' }, { name: 'mod-doctor' }, { name: 'compact' }] }))
  const files = {
    'C:/Users/me/.claude/settings.json': JSON.stringify(SETTINGS),
    'C:/Users/me/.claude/mods/config.json': JSON.stringify({ eolGuard: { enabled: false } }),
    'C:/Users/me/.claude/mods/hooks/edit.js': 'x',
    'C:/Users/me/.claude/mods/statusline.js': 'x',
    'C:/Users/me/AppData/Local/Temp/claude-mods/mods.log': LOG,
  }
  // e.path arrives resolved against the test's cwd, so match on the end of it
  const find = (p) => Object.keys(files).find((k) => S(p).endsWith(k.slice(2)))
  on('fs.exists', ($, e) => ({ value: find(e.path) !== undefined }))
  on('fs.read', ($, e) => ({ value: files[find(e.path)] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  const r = await $.command.run({ command: 'mod-doctor', args: '' })
  const t = r.text
  expect(t).toContain('Stop: C:/Users/me/.claude/mods/hooks/stop.js')
  expect(t).toContain('delete-guard@tihi-mods is not installed')
  expect(t).toContain('next-steps@tihi-mods is installed but disabled')
  expect(t).toContain('- ci-watch enabled')
  expect(t).not.toContain('ci-watch@tihi-mods is enabled but')
  expect(t).toContain('cache-clock loaded (/cache)')
  expect(t).toContain('1 error(s) in the mods log')
  expect(t).toContain('lint-changed in my-app: 2 runs, median 7200 ms, slowest 7200 ms')
  expect(t).toContain('"baseline": false')
  expect(t).toContain('lint-changed in other-app: 1 runs')
  expect(t).toContain('Turned off in config.json: eolGuard')
  expect(t).toContain('no Jira credentials')
  expect(t).toContain('Claude Code 2.1.290')
  expect(t).toContain('Node v22.3.0')
})
