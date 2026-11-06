import { factory, openPipeline } from './factory'
import { focusOrResume, isLive, missions } from './missions'
import { remote } from './remote'
import { runs } from './runs'
import { useStore } from './store'

/**
 * What needs the human, counted once and shown everywhere (activity bar, status bar, mission
 * board), so nobody has to go looking.
 */

const needsMission = (status: string): boolean => status === 'needs-input'
export const runWaits = (r: { status: string; nodes: Record<string, { status: string }> }): boolean =>
  r.status === 'running' && Object.values(r.nodes).some((n) => n.status === 'approval')

export interface ViewBadge {
  /** a count bubble in this tone */
  count?: number
  tone?: 'attention' | 'error' | 'working'
  /** something runs, but nothing needs you: a small pinging dot */
  live?: boolean
  label?: string
}

export function useMissionCounts(): { needsYou: number; working: number } {
  const needsYou = useStore(missions, (s) => s.list.filter((m) => needsMission(m.status)).length)
  const working = useStore(missions, (s) => s.list.filter((m) => m.status === 'working' || m.status === 'starting').length)
  return { needsYou, working }
}

export function useViewBadges(): Partial<Record<string, ViewBadge>> {
  const { needsYou, working } = useMissionCounts()
  const approvals = useStore(factory, (s) => s.runs.filter(runWaits).length)
  const failedRuns = useStore(factory, (s) => s.runs.filter((r) => r.status === 'failed').length)
  const runningRuns = useStore(factory, (s) => s.runs.filter((r) => r.status === 'running').length)
  const connected = useStore(remote, (r) => r.connected.length)
  const runtimes = useStore(runs, (s) => Object.values(s.byPanel).filter((r) => r.runtimeId && r.status === 'running').length)
  return {
    agents: needsYou ? { count: needsYou, tone: 'attention', label: `${needsYou} need${needsYou === 1 ? 's' : ''} you` } : working ? { live: true, label: `${working} working` } : undefined,
    factory: approvals
      ? { count: approvals, tone: 'attention', label: `${approvals} waiting for approval` }
      : failedRuns
        ? { count: failedRuns, tone: 'error', label: `${failedRuns} failed` }
        : runningRuns
          ? { live: true, label: `${runningRuns} running` }
          : undefined,
    remote: connected ? { count: connected, tone: 'working', label: `${connected} connected` } : undefined,
    runtimes: runtimes ? { live: true, label: `${runtimes} running` } : undefined
  }
}

let cursor = -1

/** Jump to the next mission or factory run waiting for the human, round-robin. Returns false when nothing waits. */
export function nextNeedsYou(): boolean {
  const items: Array<() => void> = [
    ...missions
      .get()
      .list.filter((m) => needsMission(m.status) && isLive(m.status))
      .map((m) => () => void focusOrResume(m.id)),
    ...factory
      .get()
      .runs.filter(runWaits)
      .map((r) => () => openPipeline(r.id))
  ]
  if (!items.length) return false
  cursor = (cursor + 1) % items.length
  items[cursor]()
  return true
}
