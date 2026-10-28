// Prefixes that look like ticket keys but are standards, encodings or tech.
const NOT_TICKETS = new Set([
  'UTF', 'SHA', 'ISO', 'ES', 'TLS', 'SSL', 'HTTP', 'RFC', 'WCAG', 'AES', 'MD', 'ECMA', 'PEP', 'RGB', 'IPV',
  'UI', 'API', 'IE', 'GPT', 'CSS', 'HTML', 'NODE', 'WIN', 'TS', 'JS', 'PY', 'H', 'X', 'V', 'R', 'P', 'A', 'B',
  'CP', 'WINDOWS', 'IEC', 'IEEE', 'ANSI', 'US', 'EU', 'COVID', 'MP', 'TCP', 'UDP', 'OKLCH', 'OKLAB',
])

const TICKET = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g

export function ticketIds(text: string): string[] {
  return [...text.matchAll(TICKET)].filter(match => !NOT_TICKETS.has(match[1] ?? '')).map(match => match[0])
}

// The ticket a plan belongs to: the first source, in order, that names an id
// decides it. Within that source an id that already has a folder wins, else
// its first id. An older source never outranks a newer one just because its
// ticket was filed: that sent new plans into an earlier ticket's folder.
export function findTicketId(sources: readonly string[], folders: readonly string[]): string | undefined {
  for (const source of sources) {
    const ids = ticketIds(source)
    if (ids.length === 0) continue

    return ids.find(id => folders.some(folder => isFolderOf(folder, id))) ?? ids[0]
  }

  return undefined
}

// The plan's own heading, with its ticket id still in it.
export function planHeading(plan: string): string {
  return plan.match(/^#\s+(.+)$/m)?.[1] ?? ''
}

export function isFolderOf(folder: string, id: string): boolean {
  const name = folder.toUpperCase()

  return name === id || name.startsWith(`${id}-`) || name.startsWith(`${id}_`)
}

export function planTitle(plan: string): string {
  return planHeading(plan)
    .replace(/^(implementation\s+)?plan\s*[:\-–—]\s*/i, '')
    .replace(TICKET, '')
    .replace(/^[\s:\-–—]+|[\s:\-–—]+$/g, '')
}

export function slugify(text: string, maxWords = 6): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, maxWords)
    .join('-')
}

// The folder under .claude/tickets the plan goes in.
export function ticketFolder(args: { id: string | undefined; title: string; folders: readonly string[]; today: string }): string {
  const slug = slugify(args.title)
  if (args.id !== undefined) {
    const id = args.id
    const filed = args.folders.find(folder => isFolderOf(folder, id))

    return filed ?? (slug ? `${id}-${slug}` : id)
  }

  return slug || `plan-${args.today}`
}

export function isInside(path: string, dir: string): boolean {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

  return norm(path).startsWith(`${norm(dir)}/`)
}
