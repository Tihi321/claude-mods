import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { canOpenPr, canShip, segments, snapshot } from './lib'
import type { Ports } from './lib'

const snapAtom = atom({ plugin: 'ship-bar', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'ship-bar', key: 'isHidden' } as const, false)

const REFRESH_MS = 15_000

export const register: Register = on => {
  let hasGh = false
  let isRefreshing = false

  on('session.start', async ($, e, next) => {
    hasGh = await $.process
      .run(['gh', '--version'], { timeoutMs: 10_000 })
      .then(ran => ran.exitCode === 0)
      .catch(() => false)
    await $.command.register({ name: 'ship-bar', description: 'Show or hide the git state band above the prompt' })

    const refresh = async () => {
      if (isRefreshing) return
      isRefreshing = true
      try {
        const ports: Ports = {
          run: (argv, init) => $.process.run(argv, init),
          fetch: (url, init) => $.http.fetch(url, init),
          token: (await $.env.get('GITHUB_TOKEN')) ?? (await $.env.get('GH_TOKEN')),
          hasGh,
        }
        const prev = await read($, snapAtom)
        const snap = await snapshot(ports, await $.session.cwd(), prev, await $.clock.now())
        if (JSON.stringify(snap) !== JSON.stringify(prev)) await update($, snapAtom, () => snap)
      } catch (error) {
        $.ui.log(`ship-bar: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
      } finally {
        isRefreshing = false
      }
    }
    void refresh()
    $.clock.every(REFRESH_MS, () => void refresh())

    return next(e)
  })

  // Right after each turn, so a commit or push Claude just made shows at once.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (isRefreshing) return done
    isRefreshing = true
    try {
      const ports: Ports = {
        run: (argv, init) => $.process.run(argv, init),
        fetch: (url, init) => $.http.fetch(url, init),
        token: (await $.env.get('GITHUB_TOKEN')) ?? (await $.env.get('GH_TOKEN')),
        hasGh,
      }
      const prev = await read($, snapAtom)
      const snap = await snapshot(ports, await $.session.cwd(), prev, await $.clock.now())
      if (JSON.stringify(snap) !== JSON.stringify(prev)) await update($, snapAtom, () => snap)
    } catch (error) {
      $.ui.log(`ship-bar: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    } finally {
      isRefreshing = false
    }

    return done
  })

  on('command.run', { command: 'ship-bar' }, async $ => {
    const isHidden = await read($, hiddenAtom)
    await update($, hiddenAtom, () => !isHidden)

    return { text: isHidden ? 'Git band shown.' : 'Git band hidden. Run /ship-bar to show it again.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapAtom)
    if (e.props.hasSurvey || snap === null || (await read($, hiddenAtom))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const color = { warn: 'yellow', good: 'green', dim: undefined } as const
    const parts = segments(snap)
    const isIdle = !e.props.isWorking
    const pr = snap.pr
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text wrap="truncate-end">
            {parts.map((part, i) => (
              <Text
                bold={i === 0}
                dimColor={part.tone === 'dim'}
                {...(part.tone && color[part.tone] ? { color: color[part.tone] } : {})}
              >
                {(i > 0 ? ' · ' : '') + part.text}
              </Text>
            ))}
          </Text>
          {isIdle && canShip(snap) && (
            <Button
              key="ship"
              label="Commit & push"
              hotkey="c"
              variant="primary"
              onPress={() => $.prompt.submit({ text: 'commit and push', asUser: true })}
            />
          )}
          {isIdle && canOpenPr(snap) && (
            <Button
              key="pr"
              label="Open PR"
              hotkey="p"
              onPress={() =>
                $.prompt.submit({ text: `open a pull request for ${snap.branch} into ${snap.base}`, asUser: true })
              }
            />
          )}
          {pr !== null && pr.state !== 'closed' && (
            <Button
              key="view"
              label="View PR"
              hotkey="v"
              onPress={async () => {
                const isWindows = (await $.env.get('OS')) === 'Windows_NT'
                await $.process.run(isWindows ? ['rundll32', 'url.dll,FileProtocolHandler', pr.url] : ['open', pr.url])
              }}
            />
          )}
          {snap.changed + snap.untracked > 0 && (
            <Button
              key="diff"
              label="Diff"
              hotkey="d"
              onPress={async () => {
                const stat = await $.process.run(['git', 'diff', '--stat', 'HEAD'], { cwd: snap.dir })
                const fresh = await $.process.run(['git', 'ls-files', '--others', '--exclude-standard'], { cwd: snap.dir })
                const added = fresh.stdout.trim().split(/\r?\n/).filter(Boolean)
                const text = [
                  stat.stdout.trimEnd() || 'No changes to tracked files.',
                  added.length > 0 ? `New files (${added.length}):\n  ${added.slice(0, 30).join('\n  ')}` : '',
                ]
                  .filter(Boolean)
                  .join('\n')
                $.ui.log(`ship-bar diff on ${snap.branch}:\n${text}`)
              }}
            />
          )}
        </Box>
        {below}
      </Box>
    )
  })
}
