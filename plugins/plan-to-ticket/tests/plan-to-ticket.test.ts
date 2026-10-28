import { expect, mock, test } from 'claude-code/testing'

import { findTicketId, planTitle, slugify, ticketFolder, ticketIds } from '../hooks/lib'

test('finds ticket ids and skips look-alikes', async () => {
  expect(ticketIds('task is TSP-03: Some minor fixes, UTF-8 and SHA-256 and ES-2023')).toEqual(['TSP-03'])
  expect(findTicketId(['make it ABC-188', 'TST-05 plan'], ['TST-05_favorites-reorder-remove'])).toBe('ABC-188')
  expect(findTicketId(['ABC-188 after TST-05', 'x'], ['TST-05_favorites-reorder-remove'])).toBe('TST-05')
  expect(findTicketId(['no id', 'TST-05 plan'], [])).toBe('TST-05')
  expect(findTicketId(['no id here'], [])).toBe(undefined)
})

test('names the folder from the id and the plan title', async () => {
  expect(planTitle('# Plan: TST-06 Neural field performance\n\nbody')).toBe('Neural field performance')
  expect(slugify('Unify the blog’s design with the main site, no animations')).toBe('unify-the-blog-s-design-with')
  expect(ticketFolder({ id: 'TST-06', title: 'Neural field performance', folders: [], today: '2026-10-04' })).toBe(
    'TST-06-neural-field-performance',
  )
  expect(
    ticketFolder({ id: 'TST-05', title: 'Anything', folders: ['TST-05_favorites-reorder-remove'], today: '2026-10-04' }),
  ).toBe('TST-05_favorites-reorder-remove')
  expect(ticketFolder({ id: undefined, title: 'Dictation tool', folders: [], today: '2026-10-04' })).toBe('dictation-tool')
  expect(ticketFolder({ id: undefined, title: '', folders: [], today: '2026-10-04' })).toBe('plan-2026-10-04')
})

test('an approved plan is filed in the ticket folder', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 4) })
  const writes: { path: string; text: string }[] = []
  on('session.cwd', () => ({ value: 'C:/projects/Personal/tihomir-selak-start-2026' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path.replace(/\\/g, '/'), text: e.text })

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({
    result: {
      plan: '# Plan: Neural field performance\n\n1. Do it',
      filePath: 'C:/Users/Infplane/.claude/plans/nice-optimization-sorted-pretzel.md',
      isAgent: false,
    },
  }))

  await $.prompt.submit({ text: 'TST-06: nice, do optimization', wait: false, origin: { kind: 'composer' } })
  const ran = await $.tool.call({ tool: 'ExitPlanMode' })

  expect(writes).toEqual([
    {
      path: 'C:/projects/Personal/tihomir-selak-start-2026/.claude/tickets/TST-06-neural-field-performance/plan.md',
      text: '# Plan: Neural field performance\n\n1. Do it',
    },
  ])
  expect(ran.context?.[0]).toContain('.claude/tickets/TST-06-neural-field-performance/plan.md')
})

test('a rejected plan is left alone', async ($, on) => {
  on('fs.write', () => {
    throw new Error('nothing should be written')
  })
  on('tool.call', () => ({ result: { plan: null, isAgent: false }, isError: true as const, text: 'User rejected the plan' }))
  const ran = await $.tool.call({ tool: 'ExitPlanMode' })
  expect(ran.context).toBe(undefined)
})

// One session reuses one plans file: a second plan for another ticket must
// get its own folder, and a plan already filed elsewhere must be kept.
function fakeDisk(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, dirs: string[]) {
  const root = 'C:/p/.claude/tickets'
  on('session.cwd', () => ({ value: 'C:/p' }))
  on('fs.list', () => ({ value: dirs.map(name => ({ name, kind: 'dir' as const })) }))
  on('fs.exists', ($, e) => ({ value: e.path.replace(/\\/g, '/') in files }))
  on('fs.read', ($, e) => ({ value: files[e.path.replace(/\\/g, '/')] ?? '' }))
  on('fs.write', ($, e) => {
    files[e.path.replace(/\\/g, '/')] = e.text

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => ({ text: e.text }))

  return root
}

test('a second plan in the same session gets its own ticket folder', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 28) })
  const files: Record<string, string> = {}
  const root = fakeDisk(on, files, [])
  const planFile = 'C:/Users/Infplane/.claude/plans/same-session.md'
  let plan = '# Plan: SPD-06 Lyrics panel\n\n1. a'
  on('tool.call', () => ({ result: { plan, filePath: planFile, isAgent: false } }))

  await $.prompt.submit({ text: 'SPD-06: lyrics panel', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'ExitPlanMode' })
  plan = '# Plan: SPD-07 Playlist panel\n\n1. b'
  await $.prompt.submit({ text: 'now SPD-07, playlists (after SPD-06)', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'ExitPlanMode' })

  expect(files[`${root}/SPD-06-lyrics-panel/plan.md`]).toBe('# Plan: SPD-06 Lyrics panel\n\n1. a')
  expect(files[`${root}/SPD-07-playlist-panel/plan.md`]).toBe('# Plan: SPD-07 Playlist panel\n\n1. b')
})

test('an existing plan from another session is kept, not overwritten', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 28, 9, 5) })
  const files: Record<string, string> = { 'C:/p/.claude/tickets/HIG-02/plan.md': '# old committed plan' }
  const root = fakeDisk(on, files, ['HIG-02'])
  on('tool.call', () => ({ result: { plan: '# Plan: HIG-02 live engine', filePath: 'C:/x/plans/new.md', isAgent: false } }))

  const ran = await $.tool.call({ tool: 'ExitPlanMode' })

  expect(files[`${root}/HIG-02/plan.md`]).toBe('# Plan: HIG-02 live engine')
  expect(files[`${root}/HIG-02/plan.replaced-2026-10-28T0905.md`]).toBe('# old committed plan')
  expect(ran.context?.[0]).toContain('plan.replaced-2026-10-28T0905.md')
})
