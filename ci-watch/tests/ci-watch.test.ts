import { expect, mock, test } from 'claude-code/testing'
import type { HttpResponse, ProcessRunResult } from 'claude-code'

import type { CiWatch } from '../types'
import { step } from '../hooks/github'
import type { Ports } from '../hooks/github'
import { commandDir, fixPrompt, githubRepo, isPush, logTail } from '../hooks/lib'

const ok = (stdout: string): ProcessRunResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const json = (body: unknown, status = 200): HttpResponse => ({
  status,
  ok: status < 300,
  headers: {},
  text: typeof body === 'string' ? body : JSON.stringify(body),
})

const WATCH: CiWatch = {
  repo: 'Tihi321/cdn',
  dir: 'C:/projects/Personal/cdn',
  branch: 'fix/netlify',
  sha: 'abc1234def',
  startedAt: 0,
  phase: 'waiting',
  runs: [],
  isDismissed: false,
}

const portsFor = (routes: Record<string, HttpResponse>): Ports => ({
  run: async () => ok(''),
  fetch: async url => {
    const hit = Object.keys(routes).find(path => url.includes(path))

    return hit ? (routes[hit] as HttpResponse) : json({}, 404)
  },
  token: undefined,
  hasGh: false,
})

test('recognises pushes and where they run', async () => {
  expect(isPush('git push -u origin TST-03_music')).toBe(true)
  expect(isPush('cd /c/projects/x && git add -A && git commit -q -m "x" && git push')).toBe(true)
  expect(isPush('git push --dry-run')).toBe(false)
  expect(isPush('git push origin --delete old')).toBe(false)
  expect(isPush('git status --short')).toBe(false)
  expect(commandDir('cd /c/projects/x && git push', 'C:\\home')).toBe('c:/projects/x')
  expect(commandDir('cd "C:/projects/blog" && git push', 'C:\\home')).toBe('C:/projects/blog')
  expect(commandDir('git -C sub push', 'C:/root')).toBe('C:/root/sub')
  expect(commandDir('git push', 'C:/root')).toBe('C:/root')
  expect(githubRepo('git@github.com:Tihi321/astro-start-tab.git')).toBe('Tihi321/astro-start-tab')
  expect(githubRepo('https://github.com/Tihi321/cdn')).toBe('Tihi321/cdn')
  expect(githubRepo('https://gitlab.com/a/b.git')).toBe(undefined)
})

test('ignores scheduled runs and runs from before the push', async () => {
  const stale = portsFor({
    '/actions/runs?': json({
      workflow_runs: [
        { id: 1, name: 'Netlify Daily Deploy', event: 'schedule', status: 'completed', conclusion: 'success', html_url: 'u', created_at: '2026-10-04T10:00:00Z' },
        { id: 2, name: 'Deploy', event: 'push', status: 'completed', conclusion: 'success', html_url: 'u', created_at: '2026-10-01T10:00:00Z' },
      ],
    }),
  })
  const pushedAt = Date.parse('2026-10-04T09:59:00Z')
  const result = await step(stale, { ...WATCH, startedAt: pushedAt }, pushedAt + 30_000)
  expect(result.watch.phase).toBe('waiting')
  expect(result.isDone).toBe(false)
})

test('waits, then gives up when no run starts', async () => {
  const empty = portsFor({ '/actions/runs?': json({ workflow_runs: [] }) })
  const early = await step(empty, WATCH, 30_000)
  expect(early.isDone).toBe(false)
  expect(early.status).toContain('waiting')
  const late = await step(empty, WATCH, 4 * 60_000)
  expect(late.isDone).toBe(true)
  expect(late.watch.phase).toBe('none')
  expect(late.status).toBe(null)
})

test('reports progress, then a pass', async () => {
  const running = portsFor({
    '/actions/runs?': json({
      workflow_runs: [
        { id: 1, name: 'Deploy', status: 'in_progress', conclusion: null, html_url: 'u1' },
        { id: 2, name: 'CI', status: 'completed', conclusion: 'success', html_url: 'u2' },
      ],
    }),
  })
  const mid = await step(running, WATCH, 60_000)
  expect(mid.watch.phase).toBe('running')
  expect(mid.status).toContain('(1/2)')

  const passed = portsFor({
    '/actions/runs?': json({
      workflow_runs: [{ id: 1, name: 'Deploy', status: 'completed', conclusion: 'success', html_url: 'u1' }],
    }),
  })
  const done = await step(passed, WATCH, 90_000)
  expect(done.watch.phase).toBe('passed')
  expect(done.toast).toContain('passed')
})

test('a failure names the job, the step and the log tail', async () => {
  const failing = portsFor({
    '/actions/runs?': json({
      workflow_runs: [{ id: 7, name: 'Deploy', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/r/7' }],
    }),
    '/runs/7/jobs': json({
      jobs: [
        {
          id: 70,
          name: 'deploy',
          conclusion: 'failure',
          steps: [
            { name: 'Install', conclusion: 'success' },
            { name: 'Netlify deploy', conclusion: 'failure' },
          ],
        },
      ],
    }),
    '/jobs/70/logs': json('2026-09-29T13:31:00.0000000Z line one\n2026-09-29T13:31:01.0000000Z Error: Not Found: site id\n'),
  })
  const failed = await step(failing, WATCH, 120_000)
  expect(failed.watch.phase).toBe('failed')
  expect(failed.watch.failedStep).toBe('Netlify deploy')
  expect(failed.watch.log).toBe('line one\nError: Not Found: site id')
  expect(failed.toast).toBe('CI ✗ Deploy failed at "Netlify deploy"')
  expect(fixPrompt(failed.watch)).toContain('step "Netlify deploy"')
  expect(fixPrompt(failed.watch)).toContain('https://github.com/r/7')
})

test('a rate limit keeps watching; a 404 stops', async () => {
  const limited = await step(portsFor({ '/actions/runs?': json({}, 403) }), WATCH, 1000)
  expect(limited.isDone).toBe(false)
  const missing = await step(portsFor({}), WATCH, 1000)
  expect(missing.isDone).toBe(true)
  expect(missing.log).toContain('GITHUB_TOKEN')
})

test('log tail drops timestamps and blank lines', async () => {
  expect(logTail('2026-01-01T00:00:00.1Z a\r\n\r\nb\nc', 2)).toBe('b\nc')
})

test('a successful push starts a watch', async ($, on) => {
  mock.clock(on, { now: 5000 })
  on('session.cwd', () => ({ value: 'C:/projects/Personal/cdn' }))
  on('process.run', ($, e) => {
    const args = e.argv.join(' ')
    if (args === 'git remote get-url origin') return { value: ok('git@github.com:Tihi321/cdn.git\n') }
    if (args === 'git rev-parse HEAD') return { value: ok('abc1234def\n') }
    if (args === 'git rev-parse --abbrev-ref HEAD') return { value: ok('fix/netlify\n') }

    return { value: { ...ok(''), exitCode: 1 } }
  })
  on('tool.call', () => ({ result: { stdout: 'pushed', stderr: '', interrupted: false } }))

  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })

  await $.tool.call({ tool: 'Bash', command: 'git push -u origin fix/netlify' })
  expect(statuses).toEqual(['CI ⏳ waiting for runs on fix/netlify'])
})

test('a failed push starts nothing', async ($, on) => {
  on('session.cwd', () => ({ value: 'C:/x' }))
  on('tool.call', () => ({ result: { stdout: '', stderr: 'rejected', interrupted: false }, isError: true as const, text: 'rejected' }))
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(statuses).toEqual([])
})

test('a failed run after a push shows the band, and its button asks Claude to fix', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { OS: 'Windows_NT' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:/projects/Personal/cdn' }))
  on('process.run', ($, e) => {
    const args = e.argv.join(' ')
    if (args === 'git remote get-url origin') return { value: ok('git@github.com:Tihi321/cdn.git\n') }
    if (args === 'git rev-parse HEAD') return { value: ok('abc1234def\n') }
    if (args === 'git rev-parse --abbrev-ref HEAD') return { value: ok('fix/netlify\n') }

    return { value: { ...ok(''), exitCode: 1 } }
  })
  on('http.fetch', ($, e) => {
    if (e.url.includes('/actions/runs?')) {
      return { value: json({ workflow_runs: [{ id: 7, name: 'Deploy', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/r/7' }] }) }
    }
    if (e.url.includes('/runs/7/jobs')) {
      return { value: json({ jobs: [{ id: 70, name: 'deploy', conclusion: 'failure', steps: [{ name: 'Netlify deploy', conclusion: 'failure' }] }] }) }
    }

    return { value: json('Error: Not Found: site id') }
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  const submitted: string[] = []
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  await $.session.start({ cwd: 'C:/projects/Personal/cdn', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  await clock.advance(20_000)
  expect(toasts).toEqual(['CI ✗ Deploy failed at "Netlify deploy"'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'ci-watch',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /CI ✗ Deploy failed on fix\/netlify/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Not Found: site id/ })).toBeDefined()
    if (surface === 'desktop') await ui.press({ key: 'fix' })
    await ui.unmount()
  }
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('step "Netlify deploy"')
})
