import type { HttpInit, HttpResponse, ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { ShipPr, ShipSnap } from '../types'

export type Status = {
  branch: string
  isDetached: boolean
  upstream: string | null
  ahead: number
  behind: number
  changed: number
  untracked: number
}

// `git status --porcelain=v2 --branch`.
export function parseStatus(stdout: string): Status {
  const status: Status = { branch: '', isDetached: false, upstream: null, ahead: 0, behind: 0, changed: 0, untracked: 0 }
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      status.branch = line.slice('# branch.head '.length)
      status.isDetached = status.branch === '(detached)'
    } else if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice('# branch.upstream '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+) -(\d+)/)
      status.ahead = Number(match?.[1] ?? 0)
      status.behind = Number(match?.[2] ?? 0)
    } else if (/^[12u] /.test(line)) {
      status.changed += 1
    } else if (line.startsWith('? ')) {
      status.untracked += 1
    }
  }

  return status
}

export function githubRepo(remoteUrl: string): string | undefined {
  const match = remoteUrl.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)

  return match ? `${match[1]}/${match[2]}` : undefined
}

type ApiPull = { number: number; state: string; draft?: boolean; merged_at?: string | null; html_url: string }

export function toPr(body: unknown): ShipPr | null {
  const pull = Array.isArray(body) ? (body[0] as ApiPull | undefined) : undefined
  if (pull === undefined) return null
  const state = pull.merged_at ? 'merged' : pull.state === 'closed' ? 'closed' : pull.draft ? 'draft' : 'open'

  return { number: pull.number, state, url: pull.html_url }
}

// What the engine gives the snapshot, as closures from the calling hook.
export type Ports = {
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  fetch: (url: string, init?: HttpInit) => Promise<HttpResponse>
  token: string | undefined
  hasGh: boolean
}

const PR_TTL_MS = 3 * 60_000

async function pulls(ports: Ports, repo: string, branch: string): Promise<ShipPr | null | undefined> {
  const owner = repo.split('/')[0]
  const path = `repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=1`
  if (ports.hasGh) {
    const ran = await ports.run(['gh', 'api', path], { timeoutMs: 20_000 })

    return ran.exitCode === 0 ? toPr(JSON.parse(ran.stdout)) : undefined
  }
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'claude-code-ship-bar' }
  if (ports.token) headers.authorization = `Bearer ${ports.token}`
  const response = await ports.fetch(`https://api.github.com/${path}`, { headers })

  return response.ok ? toPr(JSON.parse(response.text)) : undefined
}

// The git state of `dir`, or null outside a repository. Reuses what `prev`
// knew about the same folder (base branch, repo) and a recent PR answer.
export async function snapshot(ports: Ports, dir: string, prev: ShipSnap | null, now: number): Promise<ShipSnap | null> {
  const git = async (args: string[]) => {
    const ran = await ports.run(['git', ...args], { cwd: dir, timeoutMs: 15_000 })

    return ran.exitCode === 0 ? ran.stdout.trim() : undefined
  }
  const raw = await git(['status', '--porcelain=v2', '--branch'])
  if (raw === undefined) return null
  const status = parseStatus(raw)
  const same = prev?.dir === dir ? prev : null

  let base = same?.base
  if (base === undefined) {
    const head = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    base = head?.replace(/^origin\//, '') ?? ((await git(['rev-parse', '--verify', '--quiet', 'origin/main'])) ? 'main' : 'master')
  }
  let repo = same?.repo
  if (repo === undefined) {
    const remote = await git(['remote', 'get-url', 'origin'])
    repo = (remote && githubRepo(remote)) ?? null
  }

  let ahead = status.ahead
  if (status.upstream === null && !status.isDetached && status.branch !== base) {
    ahead = Number((await git(['rev-list', '--count', `origin/${base}..HEAD`])) ?? 0)
  }

  let pr = same?.prBranch === status.branch ? same.pr : null
  let prCheckedAt = same?.prBranch === status.branch ? same.prCheckedAt : 0
  const wantsPr = repo !== null && !status.isDetached && status.branch !== base
  if (wantsPr && now - prCheckedAt > PR_TTL_MS) {
    const found = await pulls(ports, repo as string, status.branch).catch(() => undefined)
    if (found !== undefined) pr = found
    prCheckedAt = now
  }

  return {
    dir,
    branch: status.branch,
    isDetached: status.isDetached,
    changed: status.changed,
    untracked: status.untracked,
    ahead,
    behind: status.behind,
    upstream: status.upstream,
    base,
    repo,
    pr: wantsPr ? pr : null,
    prBranch: status.branch,
    prCheckedAt,
  }
}

export type Segment = { text: string; tone?: 'warn' | 'good' | 'dim' }

// The band's one line, in pieces.
export function segments(snap: ShipSnap): Segment[] {
  const list: Segment[] = [{ text: `⎇ ${snap.isDetached ? 'detached HEAD' : snap.branch}` }]
  const files = snap.changed + snap.untracked
  list.push(
    files === 0
      ? { text: 'clean', tone: 'good' }
      : { text: `${files} changed${snap.untracked > 0 ? ` (${snap.untracked} new)` : ''}`, tone: 'warn' },
  )
  const isBase = snap.branch === snap.base
  if (snap.upstream === null && !isBase && !snap.isDetached) list.push({ text: 'not on GitHub yet', tone: 'warn' })
  else if (snap.ahead > 0) list.push({ text: `${snap.ahead} to push`, tone: 'warn' })
  if (snap.behind > 0) list.push({ text: `${snap.behind} behind`, tone: 'warn' })
  if (!isBase && snap.repo !== null && !snap.isDetached) {
    list.push(snap.pr ? { text: `PR #${snap.pr.number} ${snap.pr.state}`, tone: snap.pr.state === 'open' ? 'good' : 'dim' } : { text: 'no PR', tone: 'dim' })
  }

  return list
}

export function canShip(snap: ShipSnap): boolean {
  return snap.changed + snap.untracked > 0 || snap.ahead > 0 || (snap.upstream === null && snap.branch !== snap.base && !snap.isDetached)
}

export function canOpenPr(snap: ShipSnap): boolean {
  return snap.repo !== null && !snap.isDetached && snap.branch !== snap.base && snap.upstream !== null && (snap.pr === null || snap.pr.state === 'closed')
}
