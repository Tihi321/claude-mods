export type CiRun = {
  id: number
  name: string
  status: string
  conclusion: string | null
  url: string
}

export type CiPhase = 'waiting' | 'running' | 'passed' | 'failed' | 'none' | 'stopped'

export type CiWatch = {
  repo: string
  dir: string
  branch: string
  sha: string
  startedAt: number
  phase: CiPhase
  runs: CiRun[]
  failedRun?: CiRun
  failedJob?: string
  failedStep?: string
  log?: string
  isDismissed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ci-watch': { watch: CiWatch | null }
  }
}
