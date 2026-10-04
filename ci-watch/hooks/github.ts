import type { HttpInit, HttpResponse, ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { CiWatch } from '../types'
import { failedJob, failedRuns, isSettled, logTail, toRuns } from './lib'

// What the poll needs from the engine, handed in by the hook as closures so
// the logic below stays testable and never holds `$` itself.
export type Ports = {
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  fetch: (url: string, init?: HttpInit) => Promise<HttpResponse>
  token: string | undefined
  hasGh: boolean
}

export type Api = { status: number; body?: unknown; text?: string }

// GitHub's REST API: through `gh api` when gh is installed (its login), else
// over HTTPS with GITHUB_TOKEN or GH_TOKEN when set, else anonymously (public
// repositories, 60 requests an hour).
export async function api(ports: Ports, path: string, asText = false): Promise<Api> {
  if (ports.hasGh) {
    const ran = await ports.run(['gh', 'api', path.replace(/^\//, '')], { timeoutMs: 30_000 })
    if (ran.exitCode !== 0) return { status: Number(/HTTP (\d+)/.exec(ran.stderr)?.[1] ?? 500) }

    return asText ? { status: 200, text: ran.stdout } : { status: 200, body: JSON.parse(ran.stdout) }
  }
  const headers: Record<string, string> = {
    accept: asText ? '*/*' : 'application/vnd.github+json',
    'user-agent': 'claude-code-ci-watch',
    'x-github-api-version': '2022-11-28',
  }
  if (ports.token) headers.authorization = `Bearer ${ports.token}`
  const response = await ports.fetch(`https://api.github.com${path}`, { headers })
  if (!response.ok) return { status: response.status }

  return asText ? { status: 200, text: response.text } : { status: 200, body: JSON.parse(response.text) }
}

export const NO_RUN_GIVE_UP_MS = 3 * 60_000
export const WATCH_LIMIT_MS = 30 * 60_000

// One poll's outcome: the watch as it now stands and what to show.
// `status: null` clears the status line; absent leaves it.
export type Step = {
  watch: CiWatch
  status?: string | null
  toast?: string
  log?: string
  isDone: boolean
}

export async function step(ports: Ports, watch: CiWatch, now: number): Promise<Step> {
  if (now - watch.startedAt > WATCH_LIMIT_MS) {
    return {
      watch: { ...watch, phase: 'stopped' },
      status: null,
      log: `ci-watch: stopped watching ${watch.branch} after 30 minutes`,
      isDone: true,
    }
  }

  const listed = await api(ports, `/repos/${watch.repo}/actions/runs?head_sha=${watch.sha}&per_page=30`)
  if (listed.status === 403 || listed.status === 429) {
    return { watch, status: 'CI ? GitHub rate limit: set GITHUB_TOKEN or install gh', isDone: false }
  }
  if (listed.status !== 200) {
    const hint = listed.status === 404 ? ' (a private repo needs GITHUB_TOKEN or gh)' : ''

    return {
      watch: { ...watch, phase: 'stopped' },
      status: null,
      log: `ci-watch: GitHub answered ${listed.status} for ${watch.repo}${hint}`,
      isDone: true,
    }
  }

  const runs = toRuns(listed.body, watch.startedAt)
  if (runs.length === 0) {
    return now - watch.startedAt > NO_RUN_GIVE_UP_MS
      ? {
          watch: { ...watch, phase: 'none' },
          status: null,
          log: `ci-watch: no CI run started for ${watch.branch} (${watch.sha.slice(0, 7)})`,
          isDone: true,
        }
      : { watch, status: `CI ⏳ waiting for runs on ${watch.branch}`, isDone: false }
  }

  const names = [...new Set(runs.map(run => run.name))].join(', ')
  if (!isSettled(runs)) {
    const done = runs.filter(run => run.status === 'completed').length

    return {
      watch: { ...watch, phase: 'running', runs },
      status: `CI ⏳ ${watch.branch}: ${names} (${done}/${runs.length})`,
      isDone: false,
    }
  }

  const first = failedRuns(runs)[0]
  if (first === undefined) {
    return {
      watch: { ...watch, phase: 'passed', runs },
      status: `CI ✓ ${watch.branch}`,
      toast: `CI ✓ ${watch.branch}: ${names} passed`,
      isDone: true,
    }
  }

  const jobs = await api(ports, `/repos/${watch.repo}/actions/runs/${first.id}/jobs?per_page=50`)
  const job = jobs.status === 200 ? failedJob(jobs.body) : undefined
  const logged = job ? await api(ports, `/repos/${watch.repo}/actions/jobs/${job.id}/logs`, true) : undefined
  const log = logged?.text ? logTail(logged.text, 30) : undefined

  return {
    watch: {
      ...watch,
      phase: 'failed',
      runs,
      failedRun: first,
      ...(job ? { failedJob: job.name } : {}),
      ...(job?.step ? { failedStep: job.step } : {}),
      ...(log ? { log } : {}),
    },
    status: `CI ✗ ${watch.branch}`,
    toast: `CI ✗ ${first.name} failed${job?.step ? ` at "${job.step}"` : ''}`,
    isDone: true,
  }
}
