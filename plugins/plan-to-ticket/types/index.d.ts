// Where each plan file was filed, so its revisions land in the same folder.
export type PlanTargets = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'plan-to-ticket': { prompts: string[]; targets: PlanTargets }
  }
}
