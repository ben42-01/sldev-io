import type { DockviewApi } from 'dockview-react'
import { workspace } from '../state/workspace'
import { basename } from '../lib/paths'
import { disposeTerminal, focusTerminal, terminalCwd } from '../lib/terminals'

let api: DockviewApi | null = null
let counter = 0
/** Panels opened in this session (vs. restored from a saved layout); only these auto-run their command. */
const fresh = new Set<string>()

export interface TerminalPanelParams {
  cwd?: string
  initialInput?: string
  command?: string
  runtimeId?: string
  taskId?: string
}

export const TERMINAL_PREFIX = 'term-'

export function setDockApi(a: DockviewApi): void {
  api = a
}

export function getDockApi(): DockviewApi | null {
  return api
}

export interface OpenTerminalOptions {
  cwd?: string
  title?: string
  initialInput?: string
  /** Split relative to the active panel. Omit to open as a tab in the active group. */
  direction?: 'right' | 'below' | 'left' | 'above'
  referencePanel?: string
  referenceGroup?: string
  floating?: boolean
  command?: string
  runtimeId?: string
  taskId?: string
}

export function openTerminal(opts: OpenTerminalOptions = {}): string | null {
  if (!api) return null
  const id = `${TERMINAL_PREFIX}${Date.now().toString(36)}${(++counter).toString(36)}`
  const cwd = opts.cwd ?? workspace.get().rootFolder ?? undefined
  const title = opts.title ?? (cwd ? basename(cwd) : 'terminal')
  const params: TerminalPanelParams = { cwd, initialInput: opts.initialInput, command: opts.command, runtimeId: opts.runtimeId, taskId: opts.taskId }
  fresh.add(id)
  const ref = opts.referencePanel ?? api.activePanel?.id

  if (opts.floating) {
    api.addPanel({ id, component: 'terminal', title, params, floating: { width: 720, height: 420 } })
  } else if (opts.referenceGroup) {
    api.addPanel({ id, component: 'terminal', title, params, position: { referenceGroup: opts.referenceGroup, direction: opts.direction ?? 'within' } })
  } else if (ref) {
    api.addPanel({ id, component: 'terminal', title, params, position: { referencePanel: ref, direction: opts.direction ?? 'within' } })
  } else {
    api.addPanel({ id, component: 'terminal', title, params })
  }
  requestAnimationFrame(() => focusTerminal(id))
  return id
}

/** Split the active terminal, starting the new shell in the active terminal's current directory. */
export function splitActive(direction: 'right' | 'below'): void {
  const active = api?.activePanel
  const cwd = active?.id.startsWith(TERMINAL_PREFIX) ? terminalCwd(active.id) : undefined
  openTerminal({ cwd, direction })
}

export function consumeFresh(id: string): boolean {
  return fresh.delete(id)
}

export function focusPanel(id: string): boolean {
  const panel = api?.getPanel(id)
  if (!panel) return false
  panel.api.setActive()
  requestAnimationFrame(() => focusTerminal(id))
  return true
}

export function closePanel(id: string): void {
  api?.getPanel(id)?.api.close()
}

export function closeActive(): void {
  api?.activePanel?.api.close()
}

export function activeTerminalId(): string | null {
  const id = api?.activePanel?.id
  return id?.startsWith(TERMINAL_PREFIX) ? id : null
}

export function onPanelRemoved(id: string): void {
  if (id.startsWith(TERMINAL_PREFIX)) disposeTerminal(id)
}
