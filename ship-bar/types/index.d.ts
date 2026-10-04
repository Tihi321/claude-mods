export type ShipPr = {
  number: number
  state: 'open' | 'draft' | 'merged' | 'closed'
  url: string
}

export type ShipSnap = {
  dir: string
  branch: string
  isDetached: boolean
  changed: number
  untracked: number
  ahead: number
  behind: number
  upstream: string | null
  base: string
  repo: string | null
  pr: ShipPr | null
  prBranch: string
  prCheckedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'ship-bar': { snap: ShipSnap | null; isHidden: boolean }
  }
}
