import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CiWatch } from '../types'

import { step } from './github'
import type { Ports } from './github'
import { commandDir, fixPrompt, githubRepo, isPush } from './lib'

const watchAtom = atom({ plugin: 'ci-watch', key: 'watch' } as const, null)

const POLL_MS = 20_000

export const register: Register = on => {
  let hasGh = false
  let isPolling = false

  // One timer for the session: idle until a push leaves a watch in state.
  on('session.start', async ($, e, next) => {
    hasGh = await $.process
      .run(['gh', '--version'], { timeoutMs: 10_000 })
      .then(ran => ran.exitCode === 0)
      .catch(() => false)

    const tick = async () => {
      const watch = await read($, watchAtom)
      if (isPolling || watch === null || (watch.phase !== 'waiting' && watch.phase !== 'running')) return
      isPolling = true
      try {
        const ports: Ports = {
          run: (argv, init) => $.process.run(argv, init),
          fetch: (url, init) => $.http.fetch(url, init),
          token: (await $.env.get('GITHUB_TOKEN')) ?? (await $.env.get('GH_TOKEN')),
          hasGh,
        }
        const result = await step(ports, watch, await $.clock.now())
        await update($, watchAtom, current => (current?.sha === watch.sha ? result.watch : current))
        if (result.status !== undefined) $.ui.status(result.status ?? undefined)
        if (result.toast) $.ui.toast(result.toast)
        if (result.log) $.ui.log(result.log)
        if (result.watch.phase === 'passed') $.clock.after(60_000, () => $.ui.status(undefined))
      } catch (error) {
        $.ui.log(`ci-watch: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
      } finally {
        isPolling = false
      }
    }
    $.clock.every(POLL_MS, () => void tick())

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if ((e.tool !== 'Bash' && e.tool !== 'PowerShell') || !isPush(e.command)) return next(e)

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    try {
      const dir = commandDir(e.command, await $.session.cwd())
      const git = async (args: string[]) => {
        const out = await $.process.run(['git', ...args], { cwd: dir, timeoutMs: 15_000 })

        return out.exitCode === 0 ? out.stdout.trim() : undefined
      }
      const remote = await git(['remote', 'get-url', 'origin'])
      const repo = remote ? githubRepo(remote) : undefined
      const sha = await git(['rev-parse', 'HEAD'])
      const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
      if (repo === undefined || sha === undefined || branch === undefined) return ran

      const startedAt = await $.clock.now()
      const watch: CiWatch = { repo, dir, branch, sha, startedAt, phase: 'waiting', runs: [], isDismissed: false }
      await update($, watchAtom, () => watch)
      $.ui.status(`CI ⏳ waiting for runs on ${branch}`)
    } catch (error) {
      $.ui.log(`ci-watch: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const watch = await read($, watchAtom)
    if (e.props.hasSurvey || watch === null || watch.phase !== 'failed' || watch.isDismissed) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const room = Math.max(0, Math.min(12, e.props.maxRows - 4))
    const lines = (watch.log ?? '').split('\n').filter(Boolean).slice(-room)
    const where = [watch.failedJob && `job "${watch.failedJob}"`, watch.failedStep && `step "${watch.failedStep}"`]
      .filter(Boolean)
      .join(', ')
    const url = watch.failedRun?.url
    const dismiss = () => update($, watchAtom, current => (current ? { ...current, isDismissed: true } : current))
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red" bold wrap="truncate-end">
            {`CI ✗ ${watch.failedRun?.name ?? 'workflow'} failed on ${watch.branch}${where ? ` · ${where}` : ''}`}
          </Text>
          {lines.map(line => (
            <Text dimColor wrap="truncate-end">
              {line}
            </Text>
          ))}
          <Box flexDirection="row" gap={1}>
            <Button
              key="fix"
              label="Ask Claude to fix"
              hotkey="f"
              variant="primary"
              onPress={async () => {
                await $.prompt.submit({ text: fixPrompt(watch), asUser: true })
                await dismiss()
              }}
            />
            {url !== undefined && (
              <Button
                key="open"
                label="Open run"
                hotkey="o"
                onPress={async () => {
                  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
                  await $.process.run(isWindows ? ['rundll32', 'url.dll,FileProtocolHandler', url] : ['open', url])
                }}
              />
            )}
            <Button key="dismiss" label="Dismiss" role="dismiss" onPress={dismiss} />
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
