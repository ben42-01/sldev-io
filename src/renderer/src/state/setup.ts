import type { SetupReport } from '@shared/types'
import { openPanel, openTerminal } from '../dock/dockApi'
import { onTerminalEvent } from '../lib/terminals'
import { shouldOpenSetup } from '../lib/setup'
import { refreshInstalledAgents } from './agents'
import { createStore } from './store'
import { updateSettings, workspace } from './workspace'

export const setup = createStore<{ report: SetupReport | null; checking: boolean }>({ report: null, checking: false })

/** Terminals running an install or fix command; finishing one re-runs the check. */
const installPanels = new Set<string>()

export async function checkSetup(reloadEnv = false): Promise<SetupReport> {
  setup.set({ checking: true })
  try {
    const report = await window.api.setup.check(reloadEnv)
    setup.set({ report })
    if (reloadEnv) void refreshInstalledAgents()
    return report
  } finally {
    setup.set({ checking: false })
  }
}

export function openSetup(): void {
  openPanel('setup', 'setup', 'Setup')
  if (!workspace.get().setupSeen) updateSettings({ setupSeen: true })
}

/** Run after the dock has restored its layout. */
export async function startupSetupCheck(): Promise<void> {
  const report = await checkSetup()
  if (shouldOpenSetup(report, workspace.get().setupSeen)) openSetup()
}

/** Install or fix commands run in a visible terminal, so sudo, UAC and login prompts reach the user. */
export function runSetupCommand(command: string, title: string): void {
  const id = openTerminal({ command, title, direction: 'below' })
  if (id) installPanels.add(id)
}

onTerminalEvent((e) => {
  if (!installPanels.has(e.id)) return
  if (e.type === 'closed') installPanels.delete(e.id)
  else if (e.type === 'status' && e.status === 'exited') void checkSetup(true)
})
