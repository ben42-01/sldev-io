import type { ClaudeTaskOptions, HookEvent, Mission, MissionStatus } from '@shared/types'
import { closePanel, focusPanel, getDockApi, openPanel, openTerminal } from '../dock/dockApi'
import { claudeCommand, slugify } from '../lib/claude'
import { onTerminalEvent, stopTerminal } from '../lib/terminals'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

interface MissionsState {
  list: Mission[]
  /** missionId → panelId of its live terminal */
  panels: Record<string, string>
}

export const missions = createStore<MissionsState>({ list: [], panels: {} })

let hook: { port: number; token: string; settingsPath: string } | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined

export async function loadMissions(): Promise<void> {
  const [store, info] = await Promise.all([window.api.store.get('missions'), window.api.missions.hookInfo()])
  hook = info
  // anything that was live when the app quit is no longer running
  const list = (store?.missions ?? []).map((m) => (isLive(m.status) ? { ...m, status: 'ended' as MissionStatus } : m))
  missions.set({ list })
}

function persist(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.api.store.set('missions', { missions: missions.get().list.slice(0, 200) }), 400)
}

function update(id: string, patch: Partial<Mission>): Mission | undefined {
  let updated: Mission | undefined
  missions.set((s) => ({
    list: s.list.map((m) => (m.id === id ? (updated = { ...m, ...patch, updatedAt: Date.now() }) : m))
  }))
  persist()
  return updated
}

export const getMission = (id: string): Mission | undefined => missions.get().list.find((m) => m.id === id)
export const isLive = (s: MissionStatus): boolean => s === 'starting' || s === 'working' || s === 'waiting' || s === 'needs-input'

export function useMission(id: string): Mission | undefined {
  return useStore(missions, (s) => s.list.find((m) => m.id === id))
}

export function missionEnv(id: string): Record<string, string> {
  return hook ? { SLDEV_MISSION_ID: id, SLDEV_HOOK_PORT: String(hook.port), SLDEV_HOOK_TOKEN: hook.token } : { SLDEV_MISSION_ID: id }
}

export function missionResumeCommand(id: string): string | undefined {
  const m = getMission(id)
  if (!m?.sessionId) return undefined
  return claudeCommand(m.options, undefined, m.title, { settingsPath: hook?.settingsPath, resume: m.sessionId })
}

export function linkMissionPanel(missionId: string, panelId: string): void {
  missions.set((s) => ({ panels: { ...s.panels, [missionId]: panelId } }))
}

export interface StartMissionInput {
  prompt: string
  title?: string
  root: string
  cwd?: string
  options: ClaudeTaskOptions
  worktree: boolean
  base?: string
  taskId?: string
}

export async function startMission(input: StartMissionInput): Promise<Mission> {
  if (!hook) hook = await window.api.missions.hookInfo()
  const title = input.title?.trim() || input.prompt.trim().split('\n')[0].slice(0, 60) || 'Claude session'
  const id = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  let cwd = input.cwd ?? input.root
  let worktree: Mission['worktree']
  const repo = await window.api.git.isRepo(input.root)
  if (input.worktree && repo) {
    const base = input.base || (await window.api.git.branch(input.root)) || 'HEAD'
    worktree = await window.api.git.addWorktree(input.root, slugify(title), base)
    cwd = worktree.path
  }
  const mission: Mission = {
    id,
    title,
    prompt: input.prompt,
    root: input.root,
    cwd,
    worktree,
    // without a worktree, review shows changes since the commit the mission started from
    baseCommit: !worktree && repo ? ((await window.api.git.head(cwd)) ?? undefined) : undefined,
    options: input.options,
    status: 'starting',
    taskId: input.taskId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  missions.set((s) => ({ list: [mission, ...s.list] }))
  persist()
  openTerminal({
    cwd,
    title,
    command: claudeCommand(input.options, input.prompt, title, { settingsPath: hook?.settingsPath }),
    displayCommand: claudeCommand(input.options, input.prompt, title),
    env: missionEnv(id),
    missionId: id
  })
  return mission
}

export function focusOrResume(id: string): void {
  const m = getMission(id)
  if (!m) return
  const panel = missions.get().panels[id]
  if (panel && focusPanel(panel)) return
  const resume = missionResumeCommand(id)
  openTerminal({
    cwd: m.cwd,
    title: m.title,
    command: resume ?? claudeCommand(m.options, m.prompt, m.title, { settingsPath: hook?.settingsPath }),
    env: missionEnv(id),
    missionId: id
  })
  update(id, { status: 'starting' })
}

export function stopMission(id: string): void {
  const panel = missions.get().panels[id]
  if (panel) stopTerminal(panel)
}

export async function removeMission(id: string, opts: { removeWorktree: boolean; deleteBranch: boolean }): Promise<void> {
  const m = getMission(id)
  if (!m) return
  const panel = missions.get().panels[id]
  if (panel) closePanel(panel)
  closePanel(`diff-${id}`)
  if (m.worktree && opts.removeWorktree) await window.api.git.removeWorktree(m.worktree, opts.deleteBranch)
  missions.set((s) => ({ list: s.list.filter((x) => x.id !== id) }))
  persist()
}

export function reviewMission(id: string): void {
  const m = getMission(id)
  if (m) openPanel('diff', `diff-${id}`, `Review: ${m.title}`, { missionId: id }, 'right')
}

export function missionBase(m: Mission): string {
  return m.worktree?.base ?? m.baseCommit ?? 'HEAD'
}

export async function refreshStats(id: string): Promise<void> {
  const m = getMission(id)
  if (!m) return
  try {
    update(id, { stats: await window.api.git.diffStat(m.cwd, missionBase(m)) })
  } catch {
    // not a repo or worktree removed
  }
}

// ── live updates ─────────────────────────────────────────────────

function notify(m: Mission, title: string, body: string): void {
  if (!workspace.get().notifications) return
  const panel = missions.get().panels[m.id]
  if (document.hasFocus() && panel && getDockApi()?.activePanel?.id === panel) return
  const n = new Notification(title, { body: body.slice(0, 200) })
  n.onclick = () => {
    void window.api.app.focus()
    focusOrResume(m.id)
  }
}

window.api.missions.onHook((e: HookEvent) => {
  const m = getMission(e.mission)
  if (!m) return
  const base: Partial<Mission> = e.sessionId ? { sessionId: e.sessionId } : {}
  switch (e.type) {
    case 'session-start':
      update(m.id, { ...base, status: m.status === 'starting' && m.prompt ? 'working' : 'waiting' })
      break
    case 'prompt':
      update(m.id, { ...base, status: 'working', notification: undefined, activity: e.text ? `Prompt: ${e.text}` : m.activity })
      break
    case 'tool':
      update(m.id, { ...base, status: 'working', notification: undefined, activity: e.text })
      break
    case 'notification': {
      const idle = /waiting for your input/i.test(e.text ?? '')
      const next = update(m.id, { ...base, status: idle ? 'waiting' : 'needs-input', notification: idle ? undefined : e.text })
      if (next && !idle) notify(next, `${m.title} needs you`, e.text ?? '')
      break
    }
    case 'stop': {
      const next = update(m.id, { ...base, status: 'waiting', lastMessage: e.text ?? m.lastMessage, notification: undefined })
      if (next) notify(next, `${m.title} finished`, e.text ?? 'Claude is waiting for your next message')
      void refreshStats(m.id)
      break
    }
    case 'session-end':
      update(m.id, { ...base, status: 'ended' })
      void refreshStats(m.id)
      break
  }
})

onTerminalEvent((e) => {
  const entry = Object.entries(missions.get().panels).find(([, p]) => p === e.id)
  if (!entry) return
  const [missionId] = entry
  const m = getMission(missionId)
  if (e.type === 'closed') {
    missions.set((s) => {
      const panels = { ...s.panels }
      delete panels[missionId]
      return { panels }
    })
    if (m && isLive(m.status)) update(missionId, { status: 'ended' })
  } else if (e.type === 'status' && e.status === 'exited' && m && isLive(m.status)) {
    const failed = e.exitCode !== undefined && e.exitCode !== 0 && e.exitCode !== 130
    update(missionId, { status: failed ? 'failed' : 'ended' })
    void refreshStats(missionId)
  } else if (e.type === 'status' && e.status === 'starting' && m && !isLive(m.status)) {
    update(missionId, { status: 'starting' })
  }
})
