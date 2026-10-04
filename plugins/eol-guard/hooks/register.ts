import type { Register, ToolCallResult } from 'claude-code'

import { baseName, commandDir, dirOf, isGitCheckout, tolerantPrettier } from './lib'
import type { Eol } from './lib'
import { repoOf, restore } from './restore'
import type { Ports } from './restore'

function withNotes<R extends ToolCallResult>(ran: R, notes: string[]): R {
  if (notes.length === 0 || ran.deny !== undefined || ran.isError === true) return ran

  return { ...ran, context: [...(ran.context ?? []), ...notes] }
}

function restoredNote(fixed: { path: string; eol: Eol }[], cause: string): string {
  const eol = fixed[0]?.eol === 'crlf' ? 'CRLF' : 'LF'
  const names = fixed.map(one => one.path)
  const shown = names.length > 8 ? `${names.slice(0, 8).join(', ')} and ${names.length - 8} more` : names.join(', ')

  return (
    `eol-guard: put back ${eol} line endings on ${shown} after ${cause} rewrote them with the other kind ` +
    `(this is how git checks these files out here; only line endings changed). Read a file again before editing it.`
  )
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const isShell = e.tool === 'Bash' || e.tool === 'PowerShell'
    const isFileTool = e.tool === 'Write' || e.tool === 'Edit'
    if (!isShell && !isFileTool) return next(e)

    const ports: Ports = {
      run: (argv, init) => $.process.run(argv, init),
      readBytes: path => $.fs.read(path, { as: 'bytes' }),
      write: (path, text) => $.fs.write(path, text),
    }
    const now = await $.clock.now()
    const show = (fixed: { path: string; eol: Eol }[]) => {
      const eol = fixed[0]?.eol === 'crlf' ? 'CRLF' : 'LF'
      $.ui.status(`eol: restored ${eol} on ${fixed.length === 1 ? baseName(fixed[0]?.path ?? '') : `${fixed.length} files`}`)
      $.clock.after(15_000, () => $.ui.status(undefined))
    }

    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const dir = commandDir(e.command, await $.session.cwd())
      const repo = await repoOf(ports, dir, now)
      const tolerant = repo?.autocrlf === 'true' ? tolerantPrettier(e.command) : undefined
      const notes = tolerant
        ? [
            'eol-guard: ran prettier with --end-of-line auto, because this checkout has core.autocrlf=true: ' +
              'CRLF in the working tree is expected and git commits these files with LF.',
          ]
        : []

      const ran = await next(tolerant ? { ...e, command: tolerant } : e)
      if (ran.deny !== undefined || repo === undefined || ran.isReadOnly === true || isGitCheckout(e.command)) {
        return withNotes(ran, notes)
      }

      const fixed = await restore(ports, repo).catch(() => [])
      if (fixed.length > 0) {
        show(fixed)
        notes.push(restoredNote(fixed, 'this command'))
      }

      return withNotes(ran, notes)
    }

    if (e.tool === 'Write' || e.tool === 'Edit') {
      const ran = await next(e)
      if (ran.deny !== undefined || ran.isError === true) return ran

      const repo = await repoOf(ports, dirOf(e.file_path), now)
      if (repo === undefined) return ran
      const fixed = await restore(ports, repo, e.file_path).catch(() => [])
      if (fixed.length === 0) return ran
      show(fixed)

      return withNotes(ran, [restoredNote(fixed, `the ${e.tool}`)])
    }

    return next(e)
  })
}
