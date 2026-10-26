import type { AgentOptions, HookEvent, Mission, MissionStatus } from '@shared/types'
import { closePanel, focusPanel, getDockApi, openPanel, openTerminal, type OpenTerminalOptions } from '../dock/dockApi'
import { patchMission, pushStatus } from '@shared/missionHistory'
import { agentCommand, sldevMcp, slugify, type McpServerCommand } from '../lib/agents'
import { playChime } from '../lib/sound'
import { onTerminalEvent, stopTerminal } from '../lib/terminals'
import { getAgent } from './agents'
import { getProfile, roleFor } from './profiles'
import { applyProfile } from '@shared/profiles'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

interface MissionsState {
  list: Mission[]
  /** missionId → panelId of its live terminal */
  panels: Record<string, string>
}

export const missions = createStore<MissionsState>({ list: [], panels: {} })

let hook: { port: number; token: string; settingsPath: string; mcp: { command: string; script: string } } | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined

export async function loadMissions(): Promise<void> {
  const [store, info] = await Promise.all([window.api.store.get('missions'), window.api.missions.hookInfo()])
  hook = info
  // anything that was live when the app quit is no longer running
  const now = Date.now()
  const list = (store?.missions ?? []).map((m) => (isLive(m.status) ? patchMission(m, { status: 'ended' }, m.updatedAt || now) : m))
  missions.set({ list })
}

function persist(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.api.store.set('missions', { missions: missions.get().list.slice(0, 200) }), 400)
}

function update(id: string, patch: Partial<Mission>): Mission | undefined {
  let updated: Mission | undefined
  missions.set((s) => ({
    list: s.list.map((m) => (m.id === id ? (updated = patchMission(m, patch, Date.now())) : m))
  }))
  persist()
  return updated
}

export const getMission = (id: string): Mission | undefined => missions.get().list.find((m) => m.id === id)
export const isLive = (s: MissionStatus): boolean => s === 'starting' || s === 'working' || s === 'waiting' || s === 'needs-input'

export function useMission(id: string): Mission | undefined {
  return useStore(missions, (s) => s.list.find((m) => m.id === id))
}

/** The sldev MCP server for this mission, when the setting is on. */
const mcpFor = (id: string): McpServerCommand | undefined => (workspace.get().agentTools !== false && hook?.mcp ? sldevMcp(hook.mcp, id) : undefined)

export function missionEnv(id: string): Record<string, string> {
  return hook ? { SLDEV_MISSION_ID: id, SLDEV_HOOK_PORT: String(hook.port), SLDEV_HOOK_TOKEN: hook.token } : { SLDEV_MISSION_ID: id }
}

/** Resume the mission's session: by id when hooks reported one, else the agent's "continue latest" (if it has one). */
export function missionResumeCommand(id: string): string | undefined {
  const m = getMission(id)
  if (!m) return undefined
  const agent = getAgent(m.options.agent)
  if (agent.hooks && m.sessionId) return agentCommand(agent, m.options, undefined, m.title, { settingsPath: hook?.settingsPath, resume: m.sessionId, mcp: mcpFor(id) })
  if (!agent.hooks && agent.canResume && m.status !== 'starting') return agentCommand(agent, m.options, undefined, m.title, { resume: true, mcp: mcpFor(id) })
  return undefined
}

export function linkMissionPanel(missionId: string, panelId: string): void {
  missions.set((s) => ({ panels: { ...s.panels, [missionId]: panelId } }))
}

export interface StartMissionInput {
  prompt: string
  title?: string
  root: string
  cwd?: string
  options: AgentOptions
  worktree: boolean
  base?: string
  taskId?: string
  factory?: Mission['factory']
  /** where its terminal opens; default: a tab in the active group */
  placement?: Pick<OpenTerminalOptions, 'referencePanel' | 'referenceGroup' | 'direction'>
}

export async function startMission(input: StartMissionInput): Promise<Mission> {
  if (!hook) hook = await window.api.missions.hookInfo()
  const agent = getAgent(input.options.agent)
  const title = input.title?.trim() || input.prompt.trim().split('\n')[0].slice(0, 60) || `${agent.name} session`
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
    options: { ...input.options, agent: agent.id },
    status: 'starting',
    taskId: input.taskId,
    factory: input.factory,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: pushStatus(undefined, 'starting', Date.now())
  }
  missions.set((s) => ({ list: [mission, ...s.list] }))
  persist()
  openTerminal({
    cwd,
    title,
    command: agentCommand(agent, input.options, input.prompt, title, { settingsPath: hook?.settingsPath, role: roleFor(input.options), mcp: mcpFor(id) }),
    displayCommand: agentCommand(agent, input.options, input.prompt, title, { role: roleFor(input.options) }),
    env: missionEnv(id),
    missionId: id,
    ...input.placement
  })
  return mission
}

export function focusOrResume(id: string): void {
  const m = getMission(id)
  if (!m) return
  const panel = missions.get().panels[id]
  if (panel && focusPanel(panel)) return
  const resume = missionResumeCommand(id)
  const agent = getAgent(m.options.agent)
  openTerminal({
    cwd: m.cwd,
    title: m.title,
    command: resume ?? agentCommand(agent, m.options, m.prompt, m.title, { settingsPath: hook?.settingsPath, role: roleFor(m.options), mcp: mcpFor(id) }),
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

/** A second agent reviews a mission's changes, read-only, in the same folder. */
export async function reviewWithAgent(id: string, agentId: string): Promise<Mission | undefined> {
  const m = getMission(id)
  if (!m) return undefined
  const base = missionBase(m)
  const options = { ...applyProfile({ agent: agentId }, getProfile('builtin:reviewer')), agent: agentId }
  const prompt = [
    `Review the changes in this folder since ${base}: run \`git diff ${base}\` and look at untracked files too.`,
    `${getAgent(m.options.agent).name} made them for this task:`,
    '',
    m.prompt,
    '',
    'List your findings, most important first. Do not edit any files.'
  ].join('\n')
  return startMission({ prompt, title: `Review: ${m.title}`.slice(0, 60), root: m.root, cwd: m.cwd, options, worktree: false })
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
  const { notifications, notificationSound } = workspace.get()
  if (m.factory && m.status !== 'needs-input') return
  const panel = missions.get().panels[m.id]
  if (document.hasFocus() && panel && getDockApi()?.activePanel?.id === panel) return
  if (notificationSound && m.status === 'needs-input') playChime()
  if (!notifications) return
  const n = new Notification(title, { body: body.slice(0, 200) })
  n.onclick = () => {
    void window.api.app.focus()
    focusOrResume(m.id)
  }
}

window.api.missions.onHook((e: HookEvent) => {
  const m = getMission(e.mission)
  if (!m) return
  const base: Partial<Mission> = { ...(e.sessionId ? { sessionId: e.sessionId } : {}), ...(e.transcriptPath ? { transcriptPath: e.transcriptPath } : {}) }
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
      if (next) notify(next, `${m.title} finished`, e.text ?? `${getAgent(m.options.agent).name} is waiting for your next message`)
      void refreshStats(m.id)
      break
    }
    case 'session-end':
      update(m.id, { ...base, status: 'ended' })
      void refreshStats(m.id)
      break
  }
})

// Agents with the sldev MCP tools can report their own status; once one does, its terminal is no longer guessed from.
const reporting = new Set<string>()

window.api.missions.onMcp((e) => {
  const m = getMission(e.mission)
  if (!m) return
  const agent = getAgent(m.options.agent).name
  if (e.type === 'status') {
    reporting.add(m.id)
    clearTimeout(idleTimers.get(m.id))
    if (e.state === 'working') update(m.id, { status: 'working', notification: undefined, activity: e.text ?? m.activity })
    else if (e.state === 'needs_input') {
      const next = update(m.id, { status: 'needs-input', notification: e.text ?? `${agent} needs you` })
      if (next) notify(next, `${m.title} needs you`, e.text ?? `${agent} needs you`)
    } else {
      const next = update(m.id, { status: 'waiting', notification: undefined, lastMessage: e.text ?? m.lastMessage })
      if (next) notify(next, `${m.title} finished`, e.text ?? `${agent} says it's done`)
      void refreshStats(m.id)
    }
  } else if (e.type === 'done' || e.type === 'output') {
    if (e.text) update(m.id, { lastMessage: e.text.slice(0, 600) })
  }
})

// Agents without hooks are tracked from their terminal: output means working, a quiet spell
// means it's your turn, and a bell / OSC 9 notification means it needs you.
const IDLE_MS = 5000
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

function onAgentActivity(m: Mission): void {
  clearTimeout(idleTimers.get(m.id))
  if (m.status !== 'working' && m.status !== 'needs-input') update(m.id, { status: 'working', notification: undefined })
  idleTimers.set(
    m.id,
    setTimeout(() => {
      idleTimers.delete(m.id)
      const cur = getMission(m.id)
      if (cur?.status !== 'working') return
      const next = update(m.id, { status: 'waiting' })
      // updatedAt is when it started working: don't ping for a quick redraw, only after a real stretch of work
      if (next && Date.now() - cur.updatedAt > 2 * IDLE_MS) notify(next, `${m.title} is waiting`, `${getAgent(m.options.agent).name} went quiet; it's probably your turn`)
      void refreshStats(m.id)
    }, IDLE_MS)
  )
}

function onAgentAttention(m: Mission, text?: string): void {
  clearTimeout(idleTimers.get(m.id))
  const message = text || `${getAgent(m.options.agent).name} needs your attention`
  const next = update(m.id, { status: 'needs-input', notification: message })
  if (next) notify(next, `${m.title} needs you`, message)
}

onTerminalEvent((e) => {
  const entry = Object.entries(missions.get().panels).find(([, p]) => p === e.id)
  if (!entry) return
  const [missionId] = entry
  const m = getMission(missionId)
  if (m && (e.type === 'activity' || e.type === 'attention')) {
    if (getAgent(m.options.agent).hooks || !isLive(m.status) || reporting.has(m.id)) return
    if (e.type === 'activity') onAgentActivity(m)
    else onAgentAttention(m, e.text)
    return
  }
  if (e.type === 'closed') {
    clearTimeout(idleTimers.get(missionId))
    missions.set((s) => {
      const panels = { ...s.panels }
      delete panels[missionId]
      return { panels }
    })
    if (m && isLive(m.status)) update(missionId, { status: 'ended' })
  } else if (e.type === 'status' && e.status === 'exited' && m && isLive(m.status)) {
    clearTimeout(idleTimers.get(missionId))
    const failed = e.exitCode !== undefined && e.exitCode !== 0 && e.exitCode !== 130
    update(missionId, { status: failed ? 'failed' : 'ended' })
    void refreshStats(missionId)
  } else if (e.type === 'status' && e.status === 'starting' && m && !isLive(m.status)) {
    update(missionId, { status: 'starting' })
  }
})
