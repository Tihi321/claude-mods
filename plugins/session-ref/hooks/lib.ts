export type Digest = {
  cwd?: string
  branch?: string
  start?: string
  end?: string
  prompts: { at: string; text: string }[]
  files: string[]
  commits: string[]
  pushes: number
  last?: string
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

export function sessionIds(text: string): string[] {
  return [...new Set((text.match(UUID) ?? []).map(id => id.toLowerCase()))]
}

type Block = { type?: string; text?: string; name?: string; input?: { file_path?: string; notebook_path?: string; command?: string } }
type Row = {
  type?: string
  timestamp?: string
  cwd?: string
  gitBranch?: string
  isMeta?: boolean
  isSidechain?: boolean
  message?: { content?: string | Block[] }
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

// What the person typed, or undefined for the engine's own rows.
function promptText(text: string): string | undefined {
  const trimmed = text.trim()
  const command = trimmed.match(/<command-name>(.*?)<\/command-name>[\s\S]*?<command-args>([\s\S]*?)<\/command-args>/)
  if (command) return `${command[1]} ${command[2]}`.trim()
  if (/^<(local-command|task-notification|system-reminder|command-message)/.test(trimmed)) return undefined
  if (trimmed.startsWith('Caveat:') || trimmed === '') return undefined

  return trimmed.replace(/<\/?pasted_content[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function commitMessage(command: string): string {
  const flag = command.match(/\s-m\s+(?:"([^"]*)"|'([^']*)')/)
  const heredoc = command.match(/<<-?\s*'?(\w+)'?\s*\n([^\n]+)/)
  const here = command.match(/@'\s*\n([^\n]+)/)
  const message = flag ? (flag[1] ?? flag[2]) : (heredoc?.[2] ?? here?.[1])

  return (message ?? '(message not captured)').split(/\\n|\n/)[0]?.trim() ?? ''
}

const unquote = (value: string) => value.replace(/^["']|["']$/g, '')

// Files a shell command writes: `cat > f <<EOF`, `> f`/`tee f` after a
// heredoc, `sed -i ... f`, PowerShell's Set-Content/Out-File/Add-Content.
export function shellWrites(command: string): string[] {
  const found: string[] = []
  for (const match of command.matchAll(/\b(?:cat|tee)\s+(?:-a\s+)?>{0,2}\s*("[^"]+"|'[^']+'|[^\s<>|;&]+)\s*<</g)) {
    found.push(unquote(match[1] ?? ''))
  }
  for (const match of command.matchAll(/\bsed\s+-i\S*\s+((?:-e\s+)?(?:'[^']*'|"[^"]*"|\S+))((?:\s+(?!-)[^\s|;&<>]+)+)/g)) {
    found.push(...(match[2] ?? '').trim().split(/\s+/).map(unquote).filter(token => /[./\\]/.test(token)))
  }
  for (const match of command.matchAll(/\b(?:Set-Content|Out-File|Add-Content)\s+(?:-(?:Literal)?Path\s+|-FilePath\s+)?("[^"]+"|'[^']+'|[^\s|;]+)/gi)) {
    found.push(unquote(match[1] ?? ''))
  }

  return found.filter(path => path !== '' && !path.startsWith('-') && !path.startsWith('$'))
}

export function digest(lines: Iterable<string>): Digest {
  const result: Digest = { prompts: [], files: [], commits: [], pushes: 0 }
  const files = new Set<string>()
  for (const line of lines) {
    if (!line.trim()) continue
    let row: Row
    try {
      row = JSON.parse(line) as Row
    } catch {
      continue
    }
    if ((row.type !== 'user' && row.type !== 'assistant') || row.isSidechain) continue
    if (row.timestamp) {
      result.start ??= row.timestamp
      result.end = row.timestamp
    }
    if (row.cwd) result.cwd ??= row.cwd
    if (row.gitBranch && row.gitBranch !== 'HEAD') result.branch ??= row.gitBranch
    const content = row.message?.content
    const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? [])

    if (row.type === 'user') {
      if (row.isMeta) continue
      for (const block of blocks) {
        const text = block.type === 'text' && block.text ? promptText(block.text) : undefined
        if (text) result.prompts.push({ at: (row.timestamp ?? '').slice(11, 16), text: text.slice(0, 300) })
      }
      continue
    }
    for (const block of blocks) {
      if (block.type === 'text' && block.text?.trim()) result.last = block.text.trim()
      if (block.type !== 'tool_use') continue
      const path = block.input?.file_path ?? block.input?.notebook_path
      if (FILE_TOOLS.has(block.name ?? '') && path) files.add(path)
      const command = block.input?.command
      if ((block.name === 'Bash' || block.name === 'PowerShell') && command) {
        for (const file of shellWrites(command)) files.add(file)
        if (/\bgit\b[^|;&\n]*\bcommit\b/.test(command)) result.commits.push(commitMessage(command))
        if (/\bgit\b[^|;&\n]*\bpush\b/.test(command)) result.pushes += 1
      }
    }
  }
  result.files = [...files]

  return result
}

export function placeName(digested: Digest, projectDir: string): string {
  const fromCwd = digested.cwd?.split(/[\\/]/).filter(Boolean).at(-1)

  return fromCwd ?? projectDir
}

export function summary(digested: Digest, place: string, id: string): string {
  return (
    `${place}/${id.slice(0, 8)} (${digested.prompts.length} prompts, ${digested.files.length} files, ` +
    `${digested.commits.length} commits)`
  )
}

function list<T>(items: readonly T[], head: number, tail: number, show: (item: T) => string): string[] {
  if (items.length <= head + tail) return items.map(show)

  return [...items.slice(0, head).map(show), `- … ${items.length - head - tail} more …`, ...items.slice(-tail).map(show)]
}

export function format(digested: Digest, args: { id: string; path: string; place: string }): string {
  const when = digested.start ? `${digested.start.slice(0, 16).replace('T', ' ')} → ${(digested.end ?? '').slice(11, 16)} UTC` : ''
  const lines = [
    `session-ref: the prompt names an earlier Claude Code session. A digest of it, built from its transcript, ` +
      `follows; read the raw transcript only if this lacks what you need.`,
    '',
    `Session ${args.id} · ${args.place}${when ? ` · ${when}` : ''}${digested.cwd ? ` · cwd ${digested.cwd}` : ''}` +
      `${digested.branch ? ` · branch ${digested.branch}` : ''}`,
    `Transcript: ${args.path}`,
    '',
    `What the person asked (${digested.prompts.length}):`,
    ...list(digested.prompts, 10, 8, prompt => `- [${prompt.at}] ${prompt.text}`),
    '',
    `Files Claude wrote or edited (${digested.files.length}):`,
    ...list(digested.files, 25, 10, file => `- ${file}`),
  ]
  if (digested.commits.length > 0 || digested.pushes > 0) {
    lines.push('', `Commits (${digested.commits.length}), pushes: ${digested.pushes}`, ...list(digested.commits, 10, 5, c => `- ${c}`))
  }
  if (digested.last) {
    const last = digested.last.length > 1500 ? `…${digested.last.slice(-1500)}` : digested.last
    lines.push('', "Claude's last reply:", last)
  }

  return lines.join('\n')
}
