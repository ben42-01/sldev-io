import { ciIntent, newFailures, newIssues, remember, scheduleState, shouldPoll, type Automation } from '@shared/automations'
import { stageMode } from '@shared/agents'
import { issueText } from '@shared/factory'
import { renderKind } from '@shared/missionKinds'
import { beginPass, endPass, freshProgress, lastPass, nextPassNumber, passBrief, passChanged, repeatDue, type PassOutcome, type RepeatPlan, type RepeatProgress } from '@shared/repeat'
import { wasInterrupted } from '@shared/status'
import type { Mission } from '@shared/types'
import { openTerminal } from '../dock/dockApi'
import { onTerminalEvent, restartTerminal, terminalInfo, terminalStatus, terminalTail } from '../lib/terminals'
import { getAgent } from './agents'
import { getRun, readRecipes, startRun } from './factory'
import { getKind } from './missionKinds'
import { getMission, isLive, missions, startMission, stopMission } from './missions'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

/**
 * Runs automations while the app is open: schedules are checked every half minute, CI and issue
 * triggers ask GitHub (through gh) every few minutes. A time missed while the app was closed is
 * skipped, never caught up, and an automation never starts a second thing while its last one is live.
 */

export const automations = createStore<{ list: Automation[] }>({ list: [] })
export const useAutomations = (): Automation[] => useStore(automations, (s) => s.list)

const TICK_MS = 30_000
let timer: ReturnType<typeof setInterval> | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined

function persist(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.api.store.set('automations', { automations: automations.get().list }), 300)
}

const get = (id: string): Automation | undefined => automations.get().list.find((a) => a.id === id)

function patch(id: string, p: Partial<Automation>): void {
  automations.set((s) => ({ list: s.list.map((a) => (a.id === id ? { ...a, ...p } : a)) }))
  persist()
}

export async function loadAutomations(): Promise<void> {
  const list = (await window.api.store.get('automations'))?.automations ?? []
  // a pass that was running when the app closed doesn't run again on its own: the loop waits for Run now
  automations.set({ list: list.map((a) => (a.repeat && (a.repeat.state === 'running' || a.repeat.state === 'checking') ? { ...a, repeat: { ...a.repeat, state: 'paused', reason: `The app closed during pass ${lastPass(a.repeat)?.n}; Run now continues` } } : a)) })
  clearInterval(timer)
  timer = setInterval(() => void tick(), TICK_MS)
  // give the app a moment to load runs and missions before anything can start
  setTimeout(() => void tick(), 5000)
}

export function saveAutomation(a: Automation): void {
  automations.set((s) => ({ list: s.list.some((x) => x.id === a.id) ? s.list.map((x) => (x.id === a.id ? a : x)) : [a, ...s.list] }))
  persist()
  // a new repeat starts its first pass now, not at the next half-minute tick
  setTimeout(() => void tick(), 300)
}

export function setEnabled(id: string, enabled: boolean): void {
  const a = get(id)
  if (a?.trigger.type === 'repeat') {
    // off pauses the loop (a running pass finishes); on continues it, or starts over once it finished
    const r = a.repeat
    if (!enabled) return patch(id, { enabled, repeat: r && r.state === 'waiting' ? { ...r, state: 'paused', nextAt: undefined, reason: 'Switched off' } : r })
    const next: RepeatProgress = !r || r.state === 'finished' ? freshProgress(Date.now()) : r.state === 'paused' ? { ...r, state: 'waiting', nextAt: Date.now(), reason: undefined } : r
    patch(id, { enabled, repeat: next })
    return void tick()
  }
  // switching on starts from now: no backlog of old failures or a schedule time from before
  patch(id, enabled ? { enabled, createdAt: Date.now(), lastRunAt: undefined, lastCheckAt: undefined } : { enabled })
}

/** Ask first: see removeAutomationFlow. What it started stays. */
export function removeAutomation(id: string): void {
  automations.set((s) => ({ list: s.list.filter((a) => a.id !== id) }))
  persist()
}

export const newAutomationId = (): string => `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

let ticking = false

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    for (const a of automations.get().list) {
      if (!a.enabled) continue
      try {
        await check(a)
      } catch (e) {
        patch(a.id, { lastNote: `Error: ${(e as Error).message.split('\n')[0]}`, lastCheckAt: Date.now() })
      }
    }
  } finally {
    ticking = false
  }
}

const time = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

async function check(a: Automation): Promise<void> {
  const now = Date.now()
  if (a.trigger.type === 'repeat') {
    if (!a.repeat) return startPass(a.id)
    const state = repeatDue(a.repeat, now)
    if (state === 'missed') patch(a.id, { repeat: { ...a.repeat, nextAt: now + a.trigger.gapMinutes * 60_000 }, lastNote: `Missed a pass while the computer slept; the next one is a gap from now` })
    if (state === 'due') await startPass(a.id)
    return
  }
  if (a.trigger.type === 'schedule') {
    const state = scheduleState(a, now)
    if (state === 'missed') patch(a.id, { lastRunAt: now, lastNote: `Missed a run while the app was closed (checked at ${time(now)})` })
    if (state === 'due') await fire(a.id, undefined)
    return
  }
  if (!shouldPoll(a, now)) return
  patch(a.id, { lastCheckAt: now })
  if (a.trigger.type === 'ci-failed') {
    const fresh = newFailures(await window.api.gh.runs(a.root), a)
    if (!fresh.length) return
    // one fix at a time: the newest failure gets the run, the older ones are counted as handled
    patch(a.id, { seen: remember(a, fresh.map((r) => r.databaseId)) })
    await fire(a.id, { intent: (text) => ciIntent(text, fresh[0]) })
  } else {
    const fresh = newIssues(await window.api.gh.issues(a.root, a.trigger.label), a)
    for (const issue of fresh) {
      const cur = get(a.id)!
      // each issue gets its own run, but only when the previous one is no longer live
      if (busy(cur)) break
      patch(a.id, { seen: remember(cur, [issue.number]) })
      await fire(a.id, { intent: (text) => [text.trim(), issueText(issue)].filter(Boolean).join('\n\n'), issue: issue.number, title: issue.title })
    }
  }
}

function busy(a: Automation): boolean {
  const last = a.lastStarted
  if (!last) return false
  if (last.type === 'mission') {
    const m = getMission(last.id)
    return !!m && isLive(m.status)
  }
  const r = getRun(last.id)
  return !!r && (r.status === 'running' || r.status === 'paused')
}

interface FireContext {
  intent: (text: string) => string
  issue?: number
  title?: string
}

/** Starts the automation's run or mission now. Also behind "Run now". */
export async function fire(id: string, ctx: FireContext | undefined): Promise<void> {
  const a = get(id)
  if (!a) return
  const now = Date.now()
  if (a.trigger.type === 'repeat') {
    const r = a.repeat
    if (r && (r.state === 'running' || r.state === 'checking')) return patch(id, { lastNote: `Pass ${lastPass(r)?.n} is still going` })
    // Run now continues a paused or waiting loop, and starts a finished one over
    if (r?.state === 'finished') patch(id, { repeat: undefined })
    return startPass(id)
  }
  if (busy(a)) return patch(id, { lastRunAt: now, lastNote: `Skipped at ${time(now)}: what it started last is still running` })
  const action = a.action
  if (action.type === 'recipe') {
    const { recipes } = await readRecipes(a.root)
    const entry = recipes.find((r) => r.recipe.name === action.recipe)
    if (!entry) return patch(id, { lastRunAt: now, lastNote: `No recipe called "${action.recipe}" in ${a.root}` })
    const intent = ctx ? ctx.intent(action.intent) : action.intent
    const run = await startRun({ recipe: entry.recipe, intent, root: a.root, base: a.trigger.type === 'ci-failed' ? a.trigger.branch : undefined, issue: ctx?.issue })
    patch(id, { lastRunAt: now, lastStarted: { type: 'run', id: run.id }, lastNote: `Started ${entry.recipe.name} at ${time(now)}` })
  } else {
    const kind = getKind(action.kind)
    const brief = ctx ? ctx.intent(action.brief) : action.brief
    const title = (ctx?.title ?? a.name).slice(0, 60)
    const agent = getAgent(action.agent || workspace.get().defaultAgent)
    const repo = await window.api.git.isRepo(a.root)
    const m = await startMission({
      prompt: renderKind(kind, { title, brief }),
      brief,
      title,
      root: a.root,
      options: { agent: agent.id, permissionMode: kind.readOnly ? agent.readOnlyMode : undefined },
      worktree: kind.worktree && repo,
      kind: { id: kind.id, name: kind.name, readOnly: kind.readOnly }
    })
    patch(id, { lastRunAt: now, lastStarted: { type: 'mission', id: m.id }, lastNote: `Started a mission (${kind.name}) at ${time(now)}` })
  }
  if (workspace.get().notifications && !document.hasFocus()) new Notification(`Automation: ${a.name}`, { body: get(id)?.lastNote ?? '' })
}

// ── repeat: the same mission pass after pass (src/shared/repeat.ts) ─────────

/** passes being started or wrapped up, so a tick or a store update doesn't do it twice */
const busyLoops = new Set<string>()
/** missions whose pass the user accepted (repeats that end on your click) */
const accepted = new Set<string>()
/** each loop's check terminal, reused from pass to pass */
const checkPanels = new Map<string, string>()

const planOf = (a: Automation | undefined): RepeatPlan | undefined => (a?.trigger.type === 'repeat' ? a.trigger : undefined)

/** Starts the loop's next pass: pass 1 in a new worktree (if the kind wants one), the rest in the same folder. */
async function startPass(id: string): Promise<void> {
  const a = get(id)
  const plan = planOf(a)
  if (!a || !plan || busyLoops.has(id)) return
  const action = a.action
  if (action.type !== 'mission') return patch(id, { lastNote: 'A repeat runs a mission, not a recipe' })
  busyLoops.add(id)
  try {
    const now = Date.now()
    const prog = a.repeat && a.repeat.state !== 'finished' ? a.repeat : freshProgress(now)
    const n = nextPassNumber(prog)
    const kind = getKind(action.kind)
    const agent = getAgent(action.agent || workspace.get().defaultAgent)
    const print = plan.doneWhen === 'exit'
    // nobody approves tool calls in print mode: the same unattended mode as factory stages
    const permissionMode = kind.readOnly ? agent.readOnlyMode : print ? stageMode(agent, workspace.get().factoryModes) : undefined
    const repo = await window.api.git.isRepo(a.root)
    // what a stopped pass left behind is kept, so this pass's own changes can be told apart
    if (prog.cwd && prog.worktree) await window.api.git.commitAll(prog.cwd, `${a.name}: work left before pass ${n}`).catch(() => undefined)
    const brief = passBrief(action.brief, plan, n, lastPass(prog))
    const m = await startMission({
      prompt: renderKind(kind, { title: a.name, brief }),
      brief,
      title: `${a.name} · pass ${n}${plan.times ? `/${plan.times}` : ''}`.slice(0, 60),
      root: a.root,
      cwd: prog.cwd,
      options: { agent: agent.id, permissionMode, print },
      worktree: !prog.cwd && kind.worktree && repo,
      kind: { id: kind.id, name: kind.name, readOnly: kind.readOnly },
      repeat: { loop: id, pass: n, of: plan.times, accept: !print }
    })
    const base = repo ? ((await window.api.git.head(m.cwd)) ?? undefined) : undefined
    const startStat = repo && base && !m.worktree && !prog.worktree ? await window.api.git.diffStat(m.cwd, base).catch(() => undefined) : undefined
    patch(id, {
      repeat: beginPass(prog, { mission: m.id, startedAt: now, base, startStat }, { cwd: m.cwd, worktree: m.worktree }),
      lastRunAt: now,
      lastStarted: { type: 'mission', id: m.id },
      lastNote: `Started pass ${n} at ${time(now)}`
    })
  } catch (e) {
    patch(id, { lastNote: `Couldn't start a pass: ${(e as Error).message.split('\n')[0]}` })
  } finally {
    busyLoops.delete(id)
  }
  // a quick pass can be over before its start was recorded
  const pass = lastPass(get(id)?.repeat)
  const m = pass && getMission(pass.mission)
  if (m && get(id)?.repeat?.state === 'running' && !isLive(m.status)) void wrapUp(id, m)
}

/** Ends a pass that waits for you: the agent is stopped, its work stays and the loop moves on. */
export function acceptPass(missionId: string): void {
  const m = getMission(missionId)
  if (!m?.repeat) return
  accepted.add(missionId)
  if (missions.get().panels[missionId] && isLive(m.status)) stopMission(missionId)
  else void wrapUp(m.repeat.loop, m)
}

/** How the pass's mission ended, before any check: a clean exit (or your accept) is done, Ctrl+C or a closed tab stopped it. */
function missionOutcome(plan: RepeatPlan, m: Mission): PassOutcome {
  if (accepted.delete(m.id)) return 'done'
  if (m.limited) return 'limited'
  if (plan.doneWhen === 'accept') return 'stopped'
  const panel = missions.get().panels[m.id]
  if (!panel || wasInterrupted(terminalInfo(panel)?.exitCode)) return 'stopped'
  return m.status === 'failed' ? 'failed' : 'done'
}

async function wrapUp(id: string, m: Mission): Promise<void> {
  const a = get(id)
  const plan = planOf(a)
  const prog = a?.repeat
  const pass = lastPass(prog)
  if (!a || !plan || !prog || !pass || pass.mission !== m.id || busyLoops.has(id)) return
  busyLoops.add(id)
  try {
    let outcome = missionOutcome(plan, m)
    let checkOutput: string | undefined
    const cwd = prog.cwd ?? m.cwd
    const repo = await window.api.git.isRepo(cwd)
    if (outcome === 'done' && repo) {
      const headNow = await window.api.git.head(cwd)
      const stat = await window.api.git.diffStat(cwd, pass.base ?? headNow ?? 'HEAD').catch(() => undefined)
      if (!passChanged(pass, headNow, stat)) outcome = 'unchanged'
    }
    if (outcome === 'done' && plan.check?.trim()) {
      patch(id, { repeat: { ...prog, state: 'checking' }, lastNote: `Checking pass ${pass.n}: ${plan.check}` })
      const r = await runCheck(id, a.name, cwd, plan.check.trim())
      if (!r.ok) {
        outcome = 'check-failed'
        checkOutput = r.log
      }
    }
    // each pass is its own commit, so the next one (and you) can see what it did; in place nothing is committed
    if (repo && prog.worktree && outcome !== 'unchanged') await window.api.git.commitAll(cwd, `${a.name}: pass ${pass.n}`.slice(0, 100)).catch(() => undefined)
    const cur = get(id)
    if (!cur?.repeat) return
    const report = m.report?.trim() || m.lastMessage?.trim()
    let next = endPass(plan, { ...cur.repeat, state: 'running' }, { outcome, checkOutput, report }, Date.now())
    if (!cur.enabled && next.state === 'waiting') next = { ...next, state: 'paused', nextAt: undefined, reason: `Switched off after pass ${pass.n}` }
    const note = next.state === 'finished' ? next.reason : `Pass ${pass.n}: ${PASS_NOTE[outcome]}`
    patch(id, { repeat: next, lastNote: note })
    if (next.state === 'finished' && workspace.get().notifications && !document.hasFocus()) new Notification(`Repeat: ${a.name}`, { body: next.reason ?? '' })
  } finally {
    busyLoops.delete(id)
  }
  // back to back: the next pass starts now rather than at the next tick
  const after = get(id)
  if (after?.enabled && repeatDue(after.repeat, Date.now()) === 'due') void startPass(id)
}

const PASS_NOTE: Record<PassOutcome, string> = {
  done: 'done',
  unchanged: 'changed nothing',
  'check-failed': 'the check failed; the next pass gets its output',
  failed: 'failed',
  limited: 'stopped at the usage limit',
  stopped: 'stopped'
}

/** Runs the check in a terminal (visible, like a factory run step) and resolves with its exit and last lines. */
function runCheck(id: string, name: string, cwd: string, command: string): Promise<{ ok: boolean; log: string }> {
  const old = checkPanels.get(id)
  let panel: string | null = old && terminalStatus(old) ? old : null
  if (panel) restartTerminal(panel, command)
  else panel = openTerminal({ cwd, title: `Check · ${name}`, command })
  if (!panel) return Promise.resolve({ ok: false, log: 'The check terminal could not open' })
  checkPanels.set(id, panel)
  const id_ = panel
  return new Promise((resolve) => {
    const off = onTerminalEvent((e) => {
      if (e.id !== id_) return
      if (e.type === 'status' && e.status === 'exited') {
        off()
        resolve({ ok: e.exitCode === 0, log: terminalTail(id_, 60) })
      } else if (e.type === 'closed') {
        off()
        checkPanels.delete(id)
        resolve({ ok: false, log: 'The check terminal was closed before the check finished' })
      }
    })
  })
}

// a pass is over when its mission is: the agent exited (print mode), or you accepted it
missions.subscribe(() => {
  for (const a of automations.get().list) {
    const pass = a.repeat?.state === 'running' ? lastPass(a.repeat) : undefined
    if (!pass || busyLoops.has(a.id)) continue
    const m = getMission(pass.mission)
    if (!m) void wrapUp(a.id, { id: pass.mission, status: 'ended' } as Mission)
    else if (!isLive(m.status)) void wrapUp(a.id, m)
  }
})
