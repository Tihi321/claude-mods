import { expect, mock, test } from 'claude-code/testing'
import type { HttpResponse, ProcessRunResult } from 'claude-code'

import { canOpenPr, canShip, parseStatus, segments, snapshot, toPr } from '../hooks/lib'
import type { Ports } from '../hooks/lib'

const out = (stdout: string, exitCode = 0): ProcessRunResult => ({
  exitCode,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const STATUS = [
  '# branch.oid c60fd1d',
  '# branch.head TST-03_music-news-search',
  '# branch.upstream origin/TST-03_music-news-search',
  '# branch.ab +2 -0',
  '1 .M N... 100644 100644 100644 a b src/a.ts',
  '1 M. N... 100644 100644 100644 a b src/b.ts',
  '? notes.md',
].join('\n')

const gitAnswers = (status: string): Record<string, ProcessRunResult> => ({
  'status --porcelain=v2 --branch': out(status),
  'symbolic-ref --short refs/remotes/origin/HEAD': out('origin/master\n'),
  'remote get-url origin': out('git@github.com:Tihi321/tihomir-selak-start-2026.git\n'),
  'rev-list --count origin/master..HEAD': out('3\n'),
})

const portsFor = (answers: Record<string, ProcessRunResult>, pulls: unknown[] = []): Ports => ({
  run: async argv => answers[argv.slice(1).join(' ')] ?? out('', 1),
  fetch: async (): Promise<HttpResponse> => ({ status: 200, ok: true, headers: {}, text: JSON.stringify(pulls) }),
  token: undefined,
  hasGh: false,
})

test('parses porcelain v2 status', async () => {
  expect(parseStatus(STATUS)).toEqual({
    branch: 'TST-03_music-news-search',
    isDetached: false,
    upstream: 'origin/TST-03_music-news-search',
    ahead: 2,
    behind: 0,
    changed: 2,
    untracked: 1,
  })
})

test('reads PR state', async () => {
  expect(toPr([])).toBe(null)
  expect(toPr([{ number: 4, state: 'closed', merged_at: '2026-09-30', html_url: 'u' }])).toEqual({ number: 4, state: 'merged', url: 'u' })
  expect(toPr([{ number: 5, state: 'open', draft: true, html_url: 'u' }])?.state).toBe('draft')
})

test('a branch with work and no PR offers both buttons', async () => {
  const snap = await snapshot(portsFor(gitAnswers(STATUS)), 'C:/repo', null, 1_000_000)
  expect(snap).toMatchObject({ base: 'master', repo: 'Tihi321/tihomir-selak-start-2026', ahead: 2, pr: null })
  expect(segments(snap!).map(part => part.text)).toEqual([
    '⎇ TST-03_music-news-search',
    '3 changed (1 new)',
    '2 to push',
    'no PR',
  ])
  expect(canShip(snap!)).toBe(true)
  expect(canOpenPr(snap!)).toBe(true)
})

test('a branch not pushed yet counts commits against the base', async () => {
  const local = STATUS.replace(/# branch\.upstream .*\n/, '').replace('# branch.ab +2 -0\n', '')
  const snap = await snapshot(portsFor(gitAnswers(local)), 'C:/repo', null, 1_000_000)
  expect(snap?.ahead).toBe(3)
  expect(segments(snap!).map(part => part.text)).toContain('not on GitHub yet')
  expect(canOpenPr(snap!)).toBe(false)
})

test('an open PR is shown and reused within its TTL', async () => {
  const pulls = [{ number: 7, state: 'open', html_url: 'https://github.com/x/pull/7' }]
  let fetches = 0
  const ports = { ...portsFor(gitAnswers(STATUS), pulls) }
  const fetch = ports.fetch
  ports.fetch = async (url, init) => {
    fetches += 1

    return fetch(url, init)
  }
  const first = await snapshot(ports, 'C:/repo', null, 1_000_000)
  expect(segments(first!).at(-1)?.text).toBe('PR #7 open')
  expect(canOpenPr(first!)).toBe(false)
  await snapshot(ports, 'C:/repo', first, 1_060_000)
  expect(fetches).toBe(1)
  await snapshot(ports, 'C:/repo', first, 1_300_000)
  expect(fetches).toBe(2)
})

test('outside a repository there is no band', async () => {
  expect(await snapshot(portsFor({}), 'C:/tmp', null, 0)).toBe(null)
})

test('the band draws after a turn and its button submits the prompt', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, {})
  const answers = gitAnswers(STATUS)
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('process.run', ($, e) => ({ value: answers[e.argv.slice(1).join(' ')] ?? out('', 1) }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '[]' } }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  const submitted: string[] = []
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 10, isAborted: false, turnId: 't1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'ship-bar',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /TST-03_music-news-search/ })).toBeDefined()
    expect(await ui.find({ key: 'pr' })).toBeDefined()
    await ui.press({ key: 'ship' })
    await ui.unmount()
  }
  expect(submitted).toEqual(['commit and push', 'commit and push'])
})
