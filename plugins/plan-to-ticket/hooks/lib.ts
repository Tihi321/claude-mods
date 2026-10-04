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

// The ticket a plan belongs to: an id the sources name that already has a
// folder, else the first id the sources name, in their order.
export function findTicketId(sources: readonly string[], folders: readonly string[]): string | undefined {
  const ids = sources.flatMap(ticketIds)
  const filed = ids.find(id => folders.some(folder => isFolderOf(folder, id)))

  return filed ?? ids[0]
}

export function isFolderOf(folder: string, id: string): boolean {
  const name = folder.toUpperCase()

  return name === id || name.startsWith(`${id}-`) || name.startsWith(`${id}_`)
}

export function planTitle(plan: string): string {
  const heading = plan.match(/^#\s+(.+)$/m)?.[1] ?? ''

  return heading
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
