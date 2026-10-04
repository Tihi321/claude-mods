export type Eol = 'lf' | 'crlf'

export type EolEntry = { path: string; index: string; tree: string; attr: string }

// `git ls-files --eol -z` entries: `i/lf    w/crlf  attr/text eol=lf  \t<path>`.
export function parseEol(stdout: string): EolEntry[] {
  return stdout
    .split('\0')
    .map(line => line.match(/^i\/(\S*)\s+w\/(\S*)\s+attr\/(.*?)\s*\t(.+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(match => ({ index: match[1] ?? '', tree: match[2] ?? '', attr: match[3] ?? '', path: match[4] ?? '' }))
}

// The line endings git would check this file out with, or undefined when
// that is not a plain lf/crlf text answer (binary, mixed, new, unknown).
export function expectedEol(entry: EolEntry, autocrlf: string | undefined): Eol | undefined {
  if (/(^|\s)(-text|binary)(\s|$)/.test(entry.attr) || entry.index === '-text') return undefined
  if (/eol=lf/.test(entry.attr)) return 'lf'
  if (/eol=crlf/.test(entry.attr)) return 'crlf'
  if (entry.index === 'crlf') return 'crlf'
  if (entry.index === 'lf') return autocrlf === 'true' ? 'crlf' : 'lf'

  return undefined
}

// Files whose working copy no longer has the line endings git gave them.
export function drifted(entries: readonly EolEntry[], autocrlf: string | undefined): { path: string; eol: Eol }[] {
  return entries.flatMap(entry => {
    const eol = expectedEol(entry, autocrlf)
    const isDrifted = eol !== undefined && (entry.tree === 'mixed' || (entry.tree !== eol && (entry.tree === 'lf' || entry.tree === 'crlf')))

    return isDrifted ? [{ path: entry.path, eol }] : []
  })
}

export function withEol(text: string, eol: Eol): string {
  const lf = text.replace(/\r\n/g, '\n')

  return eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf
}

// UTF-8 text from base64 bytes, or undefined for anything that is not
// (NUL bytes, invalid sequences). A BOM is kept.
export function decodeText(base64: string): string | undefined {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (bytes.includes(0)) return undefined
  const text = new TextDecoder('utf-8').decode(bytes)
  if (text.includes('�')) return undefined
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf

  return hasBom && !text.startsWith('﻿') ? `﻿${text}` : text
}

// A prettier check made tolerant of a CRLF checkout: `--end-of-line auto`
// after each `--check`/`-c`/`--list-different`/`-l` of a prettier call.
export function tolerantPrettier(command: string): string | undefined {
  if (!/\bprettier\b/.test(command) || /--end-of-line/.test(command)) return undefined
  const next = command.replace(
    /(\bprettier\b[^|;&\n]*?\s(?:--check|-c|--list-different|-l))(?=\s|$)/g,
    '$1 --end-of-line auto',
  )

  return next === command ? undefined : next
}

// A git command whose own checkout writes files with the configured endings.
export function isGitCheckout(command: string): boolean {
  return /^\s*git\s+(checkout|switch|reset|restore|stash|merge|rebase|pull|cherry-pick|revert|clone)\b/.test(command)
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

export function dirOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))

  return cut <= 0 ? '.' : path.slice(0, cut)
}

export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}
