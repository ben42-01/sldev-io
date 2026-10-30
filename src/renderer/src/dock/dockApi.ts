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
  /** a shell command line, or an agent's argv (spawned without a shell) */
  command?: string | string[]
  runtimeId?: string
  taskId?: string
  missionId?: string
  env?: Record<string, string>
  sshConnectionId?: string
  displayCommand?: string
  /** the user renamed the tab; the shell's own title no longer replaces it */
  customTitle?: string
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
  command?: string | string[]
  runtimeId?: string
  taskId?: string
  missionId?: string
  env?: Record<string, string>
  sshConnectionId?: string
  displayCommand?: string
}

export function openTerminal(opts: OpenTerminalOptions = {}): string | null {
  if (!api) return null
  const id = `${TERMINAL_PREFIX}${Date.now().toString(36)}${(++counter).toString(36)}`
  const cwd = opts.cwd ?? workspace.get().rootFolder ?? undefined
  const title = opts.title ?? (cwd ? basename(cwd) : 'terminal')
  const params: TerminalPanelParams = {
    cwd,
    initialInput: opts.initialInput,
    command: opts.command,
    runtimeId: opts.runtimeId,
    taskId: opts.taskId,
    missionId: opts.missionId,
    env: opts.env,
    sshConnectionId: opts.sshConnectionId,
    displayCommand: opts.displayCommand
  }
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

/** Open (or focus) a non-terminal panel such as a diff, note, preview or settings. */
export function openPanel(component: string, id: string, title: string, params: object = {}, direction?: 'right' | 'below'): void {
  if (!api) return
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.updateParameters(params)
    existing.api.setActive()
    return
  }
  const ref = api.activePanel?.id
  if (ref && direction) api.addPanel({ id, component, title, params, position: { referencePanel: ref, direction } })
  else if (ref) api.addPanel({ id, component, title, params, position: { referencePanel: ref, direction: 'within' } })
  else api.addPanel({ id, component, title, params })
}

/** Ids of the terminals currently on screen (the visible tab of every group). */
export function visibleTerminalIds(): string[] {
  return (api?.groups ?? []).map((g) => g.activePanel?.id).filter((id): id is string => !!id?.startsWith(TERMINAL_PREFIX))
}

export function consumeFresh(id: string): boolean {
  return fresh.delete(id)
}

/** The group a panel sits in, to open more panels next to it. */
export function groupOf(panelId: string): string | undefined {
  return api?.getPanel(panelId)?.group.id
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

/** Put every group's tabs on top or in a list down the left side (Settings → Terminal → Tab layout). */
export function applyTabLayout(): void {
  const position = workspace.get().tabLayout === 'side' ? 'left' : 'top'
  for (const g of api?.groups ?? []) {
    if (g.api.getHeaderPosition() !== position) g.api.setHeaderPosition(position)
  }
}
