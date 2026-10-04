import type { CiRun, CiWatch } from '../types'

// A `git push` that sends commits somewhere, not a dry run or a branch delete.
export function isPush(command: string): boolean {
  const push = command.match(
    /(?:^|[\s;&|(])git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))?\s+push\b([^;&|\n]*)/,
  )
  if (!push) return false
  const args = push[1] ?? ''

  return !/--dry-run|--delete|(?:^|\s)-[nd](?:\s|$)/.test(args)
}

// The folder a shell command works in: `git -C <dir>`, else a leading
// `cd <dir> &&`, else the session's own.
export function commandDir(command: string, cwd: string): string {
  const flag = command.match(/\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/)
  const cd = command.match(
    /^\s*(?:cd|Set-Location|pushd)\s+(?:-(?:Literal)?Path\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/i,
  )
  const found = flag ? (flag[1] ?? flag[2] ?? flag[3]) : cd ? (cd[1] ?? cd[2] ?? cd[3]) : undefined
  if (found === undefined) return cwd

  const native = found.replace(/^\/([a-zA-Z])\//, '$1:/')
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(native) || native.startsWith('/') || native.startsWith('\\\\')

  return isAbsolute ? native : `${cwd.replace(/[\\/]$/, '')}/${native}`
}

// `owner/name` of a GitHub remote, over https or ssh.
export function githubRepo(remoteUrl: string): string | undefined {
  const match = remoteUrl.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)

  return match ? `${match[1]}/${match[2]}` : undefined
}

type ApiRun = {
  id: number
  name?: string | null
  display_title?: string
  status?: string | null
  conclusion?: string | null
  html_url: string
  event?: string
  created_at?: string
}

// Clock skew allowed between this machine and GitHub.
const SKEW_MS = 2 * 60_000

// The runs this push started: not scheduled runs that happen to sit on the
// same commit, and none created before the push.
export function toRuns(body: unknown, since: number): CiRun[] {
  const list = (body as { workflow_runs?: ApiRun[] } | undefined)?.workflow_runs ?? []

  return list
    .filter(run => run.event !== 'schedule')
    .filter(run => run.created_at === undefined || Date.parse(run.created_at) >= since - SKEW_MS)
    .map(run => ({
      id: run.id,
      name: run.name ?? run.display_title ?? `run ${run.id}`,
      status: run.status ?? 'queued',
      conclusion: run.conclusion ?? null,
      url: run.html_url,
    }))
}

const PASSING = new Set(['success', 'skipped', 'neutral'])

export function failedRuns(runs: readonly CiRun[]): CiRun[] {
  return runs.filter(run => run.status === 'completed' && !PASSING.has(run.conclusion ?? ''))
}

export function isSettled(runs: readonly CiRun[]): boolean {
  return runs.length > 0 && runs.every(run => run.status === 'completed')
}

type ApiJob = {
  id: number
  name: string
  conclusion?: string | null
  steps?: { name: string; conclusion?: string | null }[]
}

export function failedJob(body: unknown): { id: number; name: string; step?: string } | undefined {
  const jobs = (body as { jobs?: ApiJob[] } | undefined)?.jobs ?? []
  const job =
    jobs.find(one => one.conclusion === 'failure') ??
    jobs.find(one => one.conclusion != null && !PASSING.has(one.conclusion))
  if (!job) return undefined
  const step = job.steps?.find(one => one.conclusion === 'failure')?.name

  return step === undefined ? { id: job.id, name: job.name } : { id: job.id, name: job.name, step }
}

// The last lines of a job log, the runner's timestamps taken off.
export function logTail(log: string, lines: number): string {
  return log
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ''))
    .filter(line => line.trim() !== '')
    .slice(-lines)
    .join('\n')
}

export function fixPrompt(watch: CiWatch): string {
  const run = watch.failedRun
  const where = [
    run ? `workflow "${run.name}"` : 'a workflow',
    watch.failedJob ? `job "${watch.failedJob}"` : undefined,
    watch.failedStep ? `step "${watch.failedStep}"` : undefined,
  ]
    .filter(Boolean)
    .join(', ')
  const log = watch.log ? `\n\nLast lines of the failed job's log:\n\`\`\`\n${watch.log}\n\`\`\`` : ''

  return (
    `CI failed after the push of ${watch.branch} (commit ${watch.sha.slice(0, 7)} in ${watch.repo}): ` +
    `${where}.${run ? ` Run: ${run.url}` : ''}${log}\n\nFind the cause and fix it.`
  )
}
