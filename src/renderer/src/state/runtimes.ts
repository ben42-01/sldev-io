import type { CustomRuntime, RuntimeDef } from '@shared/types'
import { focusPanel, getDockApi, openTerminal } from '../dock/dockApi'
import { restartTerminal, stopTerminal } from '../lib/terminals'
import { findRun, isActive, runs } from './runs'
import { createStore } from './store'

interface RuntimesState {
  root: string | null
  detected: RuntimeDef[]
  custom: CustomRuntime[]
  loading: boolean
}

export const runtimes = createStore<RuntimesState>({ root: null, detected: [], custom: [], loading: false })

export async function loadRuntimes(root: string | null): Promise<void> {
  if (!root) {
    runtimes.set({ root: null, detected: [], custom: [] })
    return
  }
  runtimes.set({ root, loading: true })
  const [detected, store] = await Promise.all([window.api.runtimes.detect(root).catch(() => []), window.api.store.get('runtimes')])
  if (runtimes.get().root !== root) return // switched folders meanwhile
  runtimes.set({ detected, custom: store?.custom[root] ?? [], loading: false })
}

export function customToDef(c: CustomRuntime, root: string): RuntimeDef {
  const sep = root.includes('\\') ? '\\' : '/'
  return { id: `custom::${c.id}`, name: c.name, command: c.command, cwd: c.cwd ? `${root}${sep}${c.cwd}` : root, source: 'custom', group: 'Custom', detail: c.command }
}

export async function saveCustomRuntimes(list: CustomRuntime[]): Promise<void> {
  const root = runtimes.get().root
  if (!root) return
  runtimes.set({ custom: list })
  const store = await window.api.store.get('runtimes')
  await window.api.store.set('runtimes', { custom: { ...store.custom, [root]: list } })
}

/** Start a runtime, or focus it if it's already running. Runtimes share one dock group. */
export function runRuntime(def: RuntimeDef): void {
  const run = findRun('runtimeId', def.id)
  if (run) {
    focusPanel(run.panelId)
    if (!isActive(run)) restartTerminal(run.panelId, def.command)
    return
  }
  const sibling = Object.values(runs.get().byPanel).find((r) => r.runtimeId && getDockApi()?.getPanel(r.panelId))
  openTerminal({
    cwd: def.cwd,
    title: def.name,
    command: def.command,
    runtimeId: def.id,
    ...(sibling ? { referencePanel: sibling.panelId } : getDockApi()?.activePanel ? { direction: 'below' as const } : {})
  })
}

export function stopRuntime(id: string): void {
  const run = findRun('runtimeId', id)
  if (run) stopTerminal(run.panelId)
}

export function restartRuntime(id: string): void {
  const run = findRun('runtimeId', id)
  if (run) restartTerminal(run.panelId)
}
