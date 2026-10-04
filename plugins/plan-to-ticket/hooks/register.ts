import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { findTicketId, isInside, planTitle, ticketFolder } from './lib'

const promptsAtom = atom({ plugin: 'plan-to-ticket', key: 'prompts' } as const, [])
const targetsAtom = atom({ plugin: 'plan-to-ticket', key: 'targets' } as const, {})

type PlanResult = { plan?: string | null; filePath?: string }

export const register: Register = on => {
  // Remember what the person typed: the ticket id is usually named there.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    if (kind === undefined || kind === 'composer' || kind === 'bridge') {
      const text = e.text.slice(0, 4000)
      await update($, promptsAtom, list => [...list, text].slice(-8))
    }

    return next(e)
  })

  // After a plan is approved, file it as .claude/tickets/<ticket>/plan.md.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined || ran.isError === true) return ran

    try {
      const result = (ran.result ?? {}) as PlanResult
      const plan = result.plan ?? (result.filePath ? await $.fs.read(result.filePath) : null)
      if (!plan?.trim()) return ran

      const cwd = await $.session.cwd()
      const tickets = `${cwd.replace(/[\\/]+$/, '')}/.claude/tickets`
      if (result.filePath !== undefined && isInside(result.filePath, tickets)) return ran

      const folders = (await $.fs.list(tickets).catch(() => []))
        .filter(entry => entry.kind === 'dir')
        .map(entry => entry.name)
      const key = result.filePath ?? 'inline'
      const targets = await read($, targetsAtom)
      const prompts = await read($, promptsAtom)
      const today = new Date(await $.clock.now()).toISOString().slice(0, 10)
      const folder =
        targets[key] ??
        ticketFolder({
          id: findTicketId([...[...prompts].reverse(), planTitle(plan), plan], folders),
          title: planTitle(plan),
          folders,
          today,
        })

      const relative = `.claude/tickets/${folder}/plan.md`
      await $.fs.write(`${tickets}/${folder}/plan.md`, plan)
      await update($, targetsAtom, all => ({ ...all, [key]: folder }))
      $.ui.toast(`Plan → ${relative}`)

      return {
        ...ran,
        context: [
          ...(ran.context ?? []),
          `plan-to-ticket: the approved plan is saved as ${relative} (the ticket folder). Use that file as the plan: ` +
            `pass it to the implement skill and keep its revisions, changelog and handoff in that folder. ` +
            `It is already there, so do not copy it from ${result.filePath ?? 'the plans folder'}.`,
        ],
      }
    } catch (error) {
      $.ui.log(`plan-to-ticket: ${error instanceof Error ? error.message : String(error)}`)

      return ran
    }
  })
}
