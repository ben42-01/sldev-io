import type { AgentOptions, HookEvent, Mission, MissionStatus, SavedMission } from '@shared/types'
import { closePanel, focusPanel, getDockApi, openPanel, openTerminal, type OpenTerminalOptions } from '../dock/dockApi'
import { patchMission, pushStatus } from '@shared/missionHistory'
import { branchName, cleanBranchName } from '@shared/branch'
import { clipReport, followUpBrief, missionPrompt, secondOpinionBrief } from '@shared/missionPrompt'
import { agentCommand, commandText, installedBin, sldevMcp, type McpServerCommand } from '../lib/agents'
import { failoverBrief, limitLine, TAIL_ROWS, nextAgent } from '@shared/failover'
import { screenReport } from '@shared/screenReport'
import { ASK_GENERIC, askLine } from '@shared/attention'
import { playChime } from '../lib/sound'
import { onTerminalEvent, restartTerminal, stopTerminal, terminalCursor, terminalStatus, terminalTail } from '../lib/terminals'
import { getAgent } from './agents'
import { getProfile, roleFor } from './profiles'
import { getKind } from './missionKinds'
import { withMemory } from '@shared/memory'
import { contextPointer } from '@shared/context'
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
  // missions whose last reply was written after the Stop hook read the transcript (fixed since; this recovers older ones)
  for (const m of list) if (!m.report && m.transcriptPath && !m.factory && !m.eval) void rereadReply(m.id)
}

/**
 * Claude writes its last reply to the transcript about when the Stop hook fires, sometimes just after,
 * and the hook then reads an older message or nothing. Reading again a moment later catches it.
 */
async function rereadReply(id: string): Promise<void> {
  const path = getMission(id)?.transcriptPath
  const text = path ? await window.api.missions.lastReply(path).catch(() => undefined) : undefined
  const m = getMission(id)
  if (!m || !text || text === m.report) return
  update(id, { report: text, reportFrom: undefined, lastMessage: text.slice(0, 600) })
}

const save = (): Promise<unknown> => window.api.store.set('missions', { missions: missions.get().list.slice(0, 200) })

function persist(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), 400)
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
export function missionResumeCommand(id: string): string[] | undefined {
  const m = getMission(id)
  if (!m) return undefined
  const agent = getAgent(m.options.agent)
  // a resumed session is one you talk to, even when the mission ran in print mode (a factory stage)
  const options = { ...m.options, print: undefined }
  if (agent.hooks && m.sessionId) return agentCommand(agent, options, undefined, m.title, { settingsPath: hook?.settingsPath, resume: m.sessionId, mcp: mcpFor(id) })
  if (!agent.hooks && agent.canResume && m.status !== 'starting') return agentCommand(agent, options, undefined, m.title, { resume: true, mcp: mcpFor(id) })
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
  eval?: Mission['eval']
  brief?: string
  criteria?: string
  parent?: Mission['parent']
  kind?: Mission['kind']
  repeat?: Mission['repeat']
  /** its worktree's branch; default: feature/…, fix/… from the brief (src/shared/branch.ts) */
  branch?: string
  /** where its terminal opens; default: a tab in the active group */
  placement?: Pick<OpenTerminalOptions, 'referencePanel' | 'referenceGroup' | 'direction'>
}

/**
 * The project-context lines for a mission's prompt: the notes that match its brief, where the memory
 * is, and how to add to it. '' when memory is off, for Freeform missions, or when there's nothing to say.
 */
export async function missionMemory(root: string, agentId: string | undefined, kind: string | undefined, brief = ''): Promise<string> {
  if (workspace.get().projectMemory === false || kind === 'freeform') return ''
  const [info, hits] = await Promise.all([window.api.memory.info(root).catch(() => null), brief.trim() ? window.api.context.search(root, brief, CONTEXT_HITS).catch(() => []) : Promise.resolve([])])
  if (!info) return ''
  const tools = workspace.get().agentTools !== false && !!getAgent(agentId).mcpArgs
  // the memory file is already named as a whole; its lines are listed only when they match
  return contextPointer(hits, root, { memoryPath: info.path, memoryExists: info.exists, tools })
}

/** how many notes a mission's prompt lists at most: enough to help, few enough to read */
const CONTEXT_HITS = 6

export async function startMission(input: StartMissionInput): Promise<Mission> {
  if (!hook) hook = await window.api.missions.hookInfo()
  const agent = getAgent(input.options.agent)
  // the prompt stored on the mission is exactly what the agent got
  input = { ...input, prompt: withMemory(input.prompt, await missionMemory(input.root, agent.id, input.kind?.id, input.brief ?? input.prompt)) }
  const title = input.title?.trim() || input.prompt.trim().split('\n')[0].slice(0, 60) || `${agent.name} session`
  const id = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  let cwd = input.cwd ?? input.root
  let worktree: Mission['worktree']
  const repo = await window.api.git.isRepo(input.root)
  if (input.worktree && repo) {
    const base = input.base || (await window.api.git.branch(input.root)) || 'HEAD'
    worktree = await window.api.git.addWorktree(input.root, input.branch ? cleanBranchName(input.branch) : branchName(input.brief || title), base)
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
    eval: input.eval,
    brief: input.brief,
    criteria: input.criteria?.trim() || undefined,
    parent: input.parent,
    kind: input.kind,
    repeat: input.repeat,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: pushStatus(undefined, 'starting', Date.now())
  }
  missions.set((s) => ({ list: [mission, ...s.list] }))
  // saved before the agent starts: main answers its sldev tool calls from the stored missions
  clearTimeout(saveTimer)
  await save()
  const prompt = await launchPrompt(id, input.prompt)
  openTerminal({
    cwd,
    title,
    command: agentCommand(agent, input.options, prompt, title, { settingsPath: hook?.settingsPath, role: roleFor(input.options), mcp: mcpFor(id) }),
    displayCommand: commandText(agentCommand(agent, input.options, prompt, title, { role: roleFor(input.options) })),
    env: missionEnv(id),
    missionId: id,
    ...input.placement
  })
  return mission
}

/**
 * Windows caps a command line at 32,767 characters (and slows down long before): a long brief goes
 * to a file, and the agent is told to read it.
 */
const MAX_INLINE_PROMPT = 12_000

async function launchPrompt(id: string, prompt: string): Promise<string> {
  if (prompt.length <= MAX_INLINE_PROMPT) return prompt
  const file = await window.api.missions.briefFile(id, prompt)
  return `Your task is in ${file} (it was too long to pass on the command line). Read the whole file first, then do what it says.`
}

export async function focusOrResume(id: string): Promise<void> {
  const m = getMission(id)
  if (!m) return
  const panel = missions.get().panels[id]
  // its terminal is still open but the agent exited (a print-mode stage): continue the session right there,
  // instead of showing the old output, where Enter would run the whole prompt again
  if (panel && !isLive(m.status) && terminalStatus(panel) === 'exited') {
    const again = missionResumeCommand(id)
    if (again && focusPanel(panel)) {
      restartTerminal(panel, again)
      update(id, { status: 'starting' })
      return
    }
  }
  if (panel && focusPanel(panel)) return
  const resume = missionResumeCommand(id)
  const agent = getAgent(m.options.agent)
  openTerminal({
    cwd: m.cwd,
    title: m.title,
    command: resume ?? agentCommand(agent, m.options, await launchPrompt(id, m.prompt), m.title, { settingsPath: hook?.settingsPath, role: roleFor(m.options), mcp: mcpFor(id) }),
    env: missionEnv(id),
    missionId: id
  })
  update(id, { status: 'starting' })
}

export function stopMission(id: string): void {
  const panel = missions.get().panels[id]
  if (panel) stopTerminal(panel)
}

/** Ask first: see removeMissionFlow in lib/removals.tsx. Removing the worktree runs before anything else, so a refusal leaves the mission listed. */
export async function removeMission(id: string, opts: { removeWorktree: boolean; deleteBranch: boolean; discard?: boolean }): Promise<void> {
  const m = getMission(id)
  if (!m) return
  if (m.worktree && opts.removeWorktree) await window.api.git.removeWorktree(m.worktree, { deleteBranch: opts.deleteBranch, discard: !!opts.discard })
  const panel = missions.get().panels[id]
  if (panel) closePanel(panel)
  closePanel(`diff-${id}`)
  missions.set((s) => ({ list: s.list.filter((x) => x.id !== id) }))
  persist()
}

export function reviewMission(id: string): void {
  const m = getMission(id)
  // a tab of its own, not a split: a diff needs the width (the tab hides the sidebars while it's shown)
  if (m) openPanel('diff', `diff-${id}`, `Review: ${m.title}`, { missionId: id })
}

/** A second agent reviews a mission's changes, read-only, in the same folder, with its brief and handoff. */
export async function reviewWithAgent(id: string, agentId: string): Promise<Mission | undefined> {
  const m = getMission(id)
  if (!m) return undefined
  const options = { ...applyProfile({ agent: agentId }, getProfile('builtin:reviewer')), agent: agentId }
  const brief = secondOpinionBrief(m, getAgent(m.options.agent).name, missionBase(m))
  return startMission({ prompt: brief, brief, title: `Review: ${m.title}`.slice(0, 60), root: m.root, cwd: m.cwd, options, worktree: false, parent: { id, kind: 'second-opinion' } })
}

/** Continue a mission's work in its folder (its worktree, if it has one) with a new instruction and its handoff. */
export async function followUpMission(id: string, next: string, agentId?: string): Promise<Mission | undefined> {
  const m = getMission(id)
  if (!m || !next.trim()) return undefined
  const brief = followUpBrief(m, next)
  const title = next.trim().split('\n')[0].slice(0, 60)
  const options = { ...m.options, agent: agentId || m.options.agent }
  // a follow-up to a research mission is still research: it keeps the kind's framing
  const kind = getKind(m.kind?.id)
  return startMission({ prompt: missionPrompt({ title, brief }, kind), brief, title, root: m.root, cwd: m.cwd, options, worktree: false, parent: { id, kind: 'follow-up' }, kind: m.kind })
}

/**
 * Another agent takes over a mission whose agent stopped at its usage limit: same folder, same kind,
 * the original task, and the old agent's last output so it can pick up where that one stopped.
 */
export async function continueOnAgent(id: string, agentId: string): Promise<Mission | undefined> {
  const m = getMission(id)
  if (!m) return undefined
  const prev = getAgent(m.options.agent).name
  const panel = missions.get().panels[id]
  const brief = failoverBrief(m, prev, panel ? terminalTail(panel, TAIL_ROWS) : (m.lastMessage ?? ''), getAgent(m.options.agent).usageLimit)
  const kind = getKind(m.kind?.id)
  const agent = getAgent(agentId)
  // the old agent's model, mode and effort mean nothing to the new one; a read-only kind stays read-only
  const options = { ...m.options, agent: agentId, model: undefined, effort: undefined, permissionMode: kind.readOnly ? agent.readOnlyMode : undefined }
  const next = await startMission({ prompt: missionPrompt({ title: m.title, brief }, kind), brief, title: m.title, root: m.root, cwd: m.cwd, options, worktree: false, parent: { id, kind: 'failover' }, kind: m.kind })
  update(id, { continuedBy: next.id, notification: `Continued on ${agent.name}` })
  return next
}

/** Another mission took over this one's work (a factory stage that moved on after a limit). */
export function markContinued(id: string, by: string): void {
  update(id, { continuedBy: by })
}

/** The agent a mission (or factory stage) moves to when its own hits the limit: the first installed one in Settings → Agents. */
export function failoverAgent(current: string | undefined): string | undefined {
  return nextAgent(workspace.get().failoverOrder ?? [], current || 'claude', (id) => !!installedBin(getAgent(id)))
}

/** What the New mission form starts with: a Build mission whose brief is a plan's or a research mission's result. */
export interface MissionDraft {
  kind?: string
  brief?: string
  title?: string
  /** editing a saved mission: the form starts from it and saving replaces it */
  saved?: SavedMission
}

export function buildDraft(id: string): MissionDraft | undefined {
  const m = getMission(id)
  const report = m?.handoff?.trim() || m?.report?.trim() || m?.lastMessage?.trim()
  if (!m || !report) return undefined
  return { kind: 'build', title: m.title, brief: `Implement this ${m.kind?.id === 'plan' ? 'plan' : 'result'} from the mission "${m.title}":\n\n${report}` }
}

export function setHandoff(id: string, handoff: string): void {
  update(id, { handoff: handoff.trim() || undefined })
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

/**
 * Did the agent just stop at its usage limit? Checked when it goes quiet, asks for attention, stops
 * or exits, against the end of its output (and the hook's text). Flags the mission once; with
 * Settings → Agents → "continue automatically", a mission moves on to the next agent.
 */
function checkLimit(id: string, extra?: string): void {
  const m = getMission(id)
  if (!m || m.limited || m.continuedBy) return
  const agent = getAgent(m.options.agent)
  const panel = missions.get().panels[id]
  const hit = limitLine(`${panel ? terminalTail(panel, TAIL_ROWS) : ''}\n${extra ?? ''}`, agent.usageLimit)
  if (!hit) return
  const live = isLive(m.status) && !m.factory && !m.eval
  const next = update(id, { limited: { at: Date.now(), text: hit }, notification: `${agent.name} hit its usage limit`, ...(live ? { status: 'needs-input' as const } : {}) })
  if (!next || m.factory || m.eval) return
  const to = failoverAgent(m.options.agent)
  if (to && workspace.get().failoverAuto) void continueOnAgent(id, to)
  else notify(next, `${m.title}: ${agent.name} hit its usage limit`, to ? `Continue it on ${getAgent(to).name} from the mission card.` : hit)
}

/**
 * Agents that don't report back (no hooks, no sldev_done) get their terminal screen as the report
 * when they go quiet or exit, so a finished mission never shows an empty report. A real report wins;
 * on exit, a full-screen agent has already cleared its screen, so the snapshot from going quiet stays.
 */
function captureScreen(id: string, onExit = false): void {
  const m = getMission(id)
  const panel = missions.get().panels[id]
  if (!m || !panel || getAgent(m.options.agent).hooks) return
  if (m.report && (m.reportFrom !== 'terminal' || onExit)) return
  const report = screenReport(terminalTail(panel, TAIL_ROWS), m.prompt)
  if (report && report !== m.report) update(id, { report, reportFrom: 'terminal' })
}

/** Every agent, hooks or not, is checked for a limit message once its output settles. */
const LIMIT_QUIET_MS = 3000
const limitTimers = new Map<string, ReturnType<typeof setTimeout>>()

function watchLimit(id: string): void {
  clearTimeout(limitTimers.get(id))
  limitTimers.set(id, setTimeout(() => (limitTimers.delete(id), checkLimit(id)), LIMIT_QUIET_MS))
}

function notify(m: Mission, title: string, body: string): void {
  const { notifications, notificationSound } = workspace.get()
  if ((m.factory || m.eval) && m.status !== 'needs-input') return
  const panel = missions.get().panels[m.id]
  if (document.hasFocus() && panel && getDockApi()?.activePanel?.id === panel) return
  if (notificationSound && m.status === 'needs-input') playChime()
  if (!notifications) return
  const n = new Notification(title, { body: body.slice(0, 200) })
  n.onclick = () => {
    void window.api.app.focus()
    void focusOrResume(m.id)
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
      // a new message means the limit is behind it (a new model, a reset, an upgrade)
      update(m.id, { ...base, status: 'working', notification: undefined, limited: undefined, activity: e.text ? `Prompt: ${e.text}` : m.activity, activityAt: Date.now() })
      break
    case 'tool':
      update(m.id, { ...base, status: 'working', notification: undefined, activity: e.text, activityAt: Date.now() })
      break
    case 'notification': {
      const idle = /waiting for your input/i.test(e.text ?? '')
      const next = update(m.id, { ...base, status: idle ? 'waiting' : 'needs-input', notification: idle ? undefined : e.text })
      if (next && !idle) notify(next, `${m.title} needs you`, e.text ?? '')
      checkLimit(m.id, e.text)
      break
    }
    case 'stop': {
      const next = update(m.id, { ...base, status: 'waiting', lastMessage: e.text?.slice(0, 600) ?? m.lastMessage, report: e.text ?? m.report, ...(e.text ? { reportFrom: undefined } : {}), notification: undefined })
      setTimeout(() => void rereadReply(m.id), 1500)
      if (next) notify(next, `${m.title} finished`, e.text ?? `${getAgent(m.options.agent).name} is waiting for your next message`)
      void refreshStats(m.id)
      checkLimit(m.id, e.text)
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
      captureScreen(m.id)
      const next = update(m.id, { status: 'waiting', notification: undefined, lastMessage: e.text?.slice(0, 600) ?? m.lastMessage })
      if (next) notify(next, `${m.title} finished`, e.text ?? `${agent} says it's done`)
      void refreshStats(m.id)
    }
  } else if (e.type === 'done' || e.type === 'output') {
    if (e.text) update(m.id, { lastMessage: e.text.slice(0, 600), ...(e.type === 'done' ? { report: clipReport(e.text), reportFrom: undefined } : {}) })
  }
})

// Agents without hooks are tracked from their terminal: output means working, a quiet spell
// means it's your turn, and a bell / OSC 9 notification means it needs you.
const IDLE_MS = 5000
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

function onAgentActivity(m: Mission): void {
  clearTimeout(idleTimers.get(m.id))
  if (m.status !== 'working' && m.status !== 'needs-input') update(m.id, { status: 'working', notification: undefined, activityAt: Date.now() })
  // output comes in bursts: a few seconds is precise enough for "last output", and spares the store
  else if (Date.now() - (m.activityAt ?? 0) > 3000) update(m.id, { activityAt: Date.now() })
  idleTimers.set(
    m.id,
    setTimeout(() => {
      idleTimers.delete(m.id)
      const cur = getMission(m.id)
      if (cur?.status !== 'working' || checkAsk(m.id)) return
      captureScreen(m.id)
      const next = update(m.id, { status: 'waiting' })
      // updatedAt is when it started working: don't ping for a quick redraw, only after a real stretch of work
      if (next && Date.now() - cur.updatedAt > 2 * IDLE_MS) notify(next, `${m.title} is waiting`, `${getAgent(m.options.agent).name} went quiet; it's probably your turn`)
      void refreshStats(m.id)
    }, IDLE_MS)
  )
}

/**
 * Approval prompts on screen, for every agent without hooks: full-screen agents wait in a dialog
 * without a bell. Checked while output arrives (at most every ASK_CHECK_MS) and once it settles, so
 * the dialog's final frame is seen. The prompt comes from the CLI, not the model, so this runs even for
 * agents that report through the sldev tools.
 */
const ASK_CHECK_MS = 1000
const ASK_SETTLE_MS = 400
const askChecked = new Map<string, number>()
const askTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** missions that need you because of a prompt on screen; they're working again once it's gone or answered */
const asking = new Set<string>()
/**
 * Where the user last typed, per mission: a prompt above it was answered. Inline CLIs leave the answered
 * question on screen; full-screen ones redraw, so there the whole screen counts.
 */
const answeredAt = new Map<string, number>()
/** the question last notified about: moving through a dialog's options with the arrow keys doesn't ping again */
const askNotified = new Map<string, string>()

function onUserInput(id: string): void {
  const panel = missions.get().panels[id]
  const cur = panel ? terminalCursor(panel) : undefined
  if (cur && !cur.alt) answeredAt.set(id, cur.line + 1)
  const m = getMission(id)
  if (asking.delete(id) && m?.status === 'needs-input') update(id, { status: 'working', notification: undefined, activityAt: Date.now() })
}

function checkAsk(id: string): boolean {
  const m = getMission(id)
  const panel = missions.get().panels[id]
  if (!m || !panel || !isLive(m.status)) return false
  const agent = getAgent(m.options.agent)
  if (agent.hooks) return false
  askChecked.set(id, Date.now())
  const cur = terminalCursor(panel)
  const from = cur && !cur.alt ? (answeredAt.get(id) ?? 0) : 0
  const line = askLine(terminalTail(panel, TAIL_ROWS, from), agent.asks ?? ASK_GENERIC, m.prompt)
  if (line) {
    clearTimeout(idleTimers.get(id))
    if (asking.has(id) && m.status === 'needs-input') return true
    asking.add(id)
    const next = update(id, { status: 'needs-input', notification: line })
    if (next && m.status !== 'needs-input' && askNotified.get(id) !== line) notify(next, `${m.title} needs you`, line)
    askNotified.set(id, line)
    return true
  }
  askNotified.delete(id)
  if (asking.delete(id) && m.status === 'needs-input') update(id, { status: 'working', notification: undefined, activityAt: Date.now() })
  return false
}

function watchAsk(id: string): void {
  if (Date.now() - (askChecked.get(id) ?? 0) >= ASK_CHECK_MS) checkAsk(id)
  clearTimeout(askTimers.get(id))
  askTimers.set(id, setTimeout(() => (askTimers.delete(id), checkAsk(id)), ASK_SETTLE_MS))
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
  if (m && e.type === 'activity' && isLive(m.status)) watchLimit(m.id)
  if (m && e.type === 'attention') checkLimit(m.id, e.text)
  if (m && e.type === 'activity' && isLive(m.status) && !getAgent(m.options.agent).hooks) watchAsk(m.id)
  if (m && e.type === 'input' && isLive(m.status) && !getAgent(m.options.agent).hooks) onUserInput(m.id)
  if (m && (e.type === 'activity' || e.type === 'attention')) {
    if (getAgent(m.options.agent).hooks || !isLive(m.status) || reporting.has(m.id)) return
    if (e.type === 'activity') onAgentActivity(m)
    else onAgentAttention(m, e.text)
    return
  }
  if (e.type === 'closed' || e.type === 'status') {
    clearTimeout(askTimers.get(missionId))
    asking.delete(missionId)
    answeredAt.delete(missionId)
    askNotified.delete(missionId)
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
    clearTimeout(limitTimers.get(missionId))
    // before the status changes, so a factory stage sees the limit when it sees the exit
    checkLimit(missionId)
    captureScreen(missionId, true)
    update(missionId, { status: failed ? 'failed' : 'ended' })
    void refreshStats(missionId)
  } else if (e.type === 'status' && e.status === 'starting' && m && !isLive(m.status)) {
    update(missionId, { status: 'starting' })
  }
})
