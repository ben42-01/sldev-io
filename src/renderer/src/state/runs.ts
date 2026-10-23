import { onTerminalEvent, terminalInfo, type TerminalStatus } from '../lib/terminals'
import { createStore, useStore } from './store'

/** A terminal panel that is running (or ran) a runtime or a task. */
export interface Run {
  panelId: string
  runtimeId?: string
  taskId?: string
  status: TerminalStatus
  exitCode?: number
  ports: number[]
}

export const runs = createStore<{ byPanel: Record<string, Run> }>({ byPanel: {} })

function patch(panelId: string, p: Partial<Run> | null): void {
  runs.set((s) => {
    const byPanel = { ...s.byPanel }
    if (p === null) delete byPanel[panelId]
    else byPanel[panelId] = { ...byPanel[panelId], ...p }
    return { byPanel }
  })
}

export function linkPanel(panelId: string, link: { runtimeId?: string; taskId?: string }): void {
  if (!link.runtimeId && !link.taskId) return
  const info = terminalInfo(panelId)
  patch(panelId, { panelId, ...link, status: info?.status ?? 'idle', exitCode: info?.exitCode, ports: info?.ports ?? [] })
}

onTerminalEvent((e) => {
  const run = runs.get().byPanel[e.id]
  if (!run) return
  if (e.type === 'closed') patch(e.id, null)
  else if (e.type === 'status') patch(e.id, { status: e.status, exitCode: e.exitCode, ...(e.status === 'starting' ? { ports: [] } : {}) })
  else if (e.type === 'port') patch(e.id, { ports: [...run.ports, e.port] })
})

export function findRun(kind: 'runtimeId' | 'taskId', id: string): Run | undefined {
  return Object.values(runs.get().byPanel).find((r) => r[kind] === id)
}

export function useRun(kind: 'runtimeId' | 'taskId', id: string): Run | undefined {
  return useStore(runs, (s) => Object.values(s.byPanel).find((r) => r[kind] === id))
}

export function isActive(run: Run | undefined): boolean {
  return run?.status === 'running' || run?.status === 'starting'
}
