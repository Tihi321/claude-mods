import type { Register } from 'claude-code'

import { digest, format, placeName, sessionIds, summary } from './lib'

const MAX_SESSIONS = 3
const READ_LIMIT = 4 * 1024 * 1024

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const ids = sessionIds(e.text).slice(0, MAX_SESSIONS)
    if (ids.length === 0) return next(e)

    try {
      const own = await $.session.id()
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
      const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined)
      if (config === undefined) return next(e)
      const projects = `${config}/projects`
      const dirs = (await $.fs.list(projects).catch(() => [])).filter(entry => entry.kind === 'dir')

      const blocks: string[] = []
      const shown: string[] = []
      for (const id of ids) {
        if (id === own) continue
        let found: { path: string; dir: string } | undefined
        for (const dir of dirs) {
          const path = `${projects}/${dir.name}/${id}.jsonl`
          if (await $.fs.exists(path)) {
            found = { path, dir: dir.name }
            break
          }
        }
        if (found === undefined) continue

        // A transcript over 4 MiB is cut down by the bundled script first.
        const { size } = await $.fs.stat(found.path)
        let text: string | undefined
        if (size <= READ_LIMIT) {
          text = await $.fs.read(found.path)
        } else {
          const script = `${$.plugin.root}/scripts/compact.py`
          for (const python of ['python', 'python3']) {
            const ran = await $.process
              .run([python, script, found.path], { env: { PYTHONIOENCODING: 'utf-8' }, timeoutMs: 60_000 })
              .catch(() => undefined)
            if (ran?.exitCode === 0) {
              text = ran.stdout
              break
            }
          }
        }
        if (text === undefined) {
          $.ui.log(`session-ref: ${found.path} is over 4 MiB and Python was not found to cut it down`)
          continue
        }

        const digested = digest(text.split('\n'))
        const place = placeName(digested, found.dir)
        blocks.push(format(digested, { id, path: found.path, place }))
        shown.push(summary(digested, place, id))
      }
      if (blocks.length === 0) return next(e)

      $.ui.log(`session-ref: attached ${shown.join('; ')}`)

      return next({ ...e, context: [...(e.context ?? []), ...blocks] })
    } catch (error) {
      $.ui.log(`session-ref: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })

      return next(e)
    }
  })
}
