import type { FsBytes, ProcessRunInit, ProcessRunResult } from 'claude-code'

import { decodeText, drifted, parseEol, withEol } from './lib'
import type { Eol } from './lib'

// What the restore needs from the engine, handed in by the hook as closures.
export type Ports = {
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  readBytes: (path: string) => Promise<FsBytes>
  write: (path: string, text: string) => Promise<void>
}

export type Repo = { top: string; autocrlf: string | undefined }

const MAX_FILES = 200
const repos = new Map<string, { repo: Repo | undefined; at: number }>()

// The repository holding `dir` and its core.autocrlf, remembered a minute.
export async function repoOf(ports: Ports, dir: string, now: number): Promise<Repo | undefined> {
  const known = repos.get(dir)
  if (known && now - known.at < 60_000) return known.repo

  const top = await ports.run(['git', 'rev-parse', '--show-toplevel'], { cwd: dir, timeoutMs: 10_000 }).catch(() => undefined)
  let repo: Repo | undefined
  if (top?.exitCode === 0) {
    const config = await ports.run(['git', 'config', '--get', 'core.autocrlf'], { cwd: dir, timeoutMs: 10_000 })
    const autocrlf = config.exitCode === 0 ? config.stdout.trim().toLowerCase() : undefined
    repo = { top: top.stdout.trim(), autocrlf }
  }
  repos.set(dir, { repo, at: now })

  return repo
}

// Puts back the line endings git checked out on files a tool rewrote with
// the other kind: the one file named, or every modified tracked file.
export async function restore(ports: Ports, repo: Repo, file?: string): Promise<{ path: string; eol: Eol }[]> {
  const git = (args: string[]) => ports.run(['git', ...args], { cwd: repo.top, timeoutMs: 20_000 })

  let names: string[]
  if (file !== undefined) {
    names = [file]
  } else {
    const changed = await git(['diff', '--name-only', '-z'])
    names = changed.exitCode === 0 ? changed.stdout.split('\0').filter(Boolean).slice(0, MAX_FILES) : []
  }
  if (names.length === 0) return []

  const listed = await git(['ls-files', '--eol', '-z', '--', ...names])
  if (listed.exitCode !== 0) return []

  const fixed: { path: string; eol: Eol }[] = []
  for (const { path, eol } of drifted(parseEol(listed.stdout), repo.autocrlf)) {
    const full = `${repo.top}/${path}`
    const bytes = await ports.readBytes(full).catch(() => undefined)
    const text = bytes ? decodeText(bytes.base64) : undefined
    if (text === undefined) continue
    const next = withEol(text, eol)
    if (next === text) continue
    await ports.write(full, next)
    fixed.push({ path, eol })
  }

  return fixed
}
