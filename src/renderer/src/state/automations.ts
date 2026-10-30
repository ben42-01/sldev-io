import { ciIntent, newFailures, newIssues, remember, scheduleState, shouldPoll, type Automation } from '@shared/automations'
import { issueText } from '@shared/factory'
import { renderKind } from '@shared/missionKinds'
import { getAgent } from './agents'
import { getRun, readRecipes, startRun } from './factory'
import { getKind } from './missionKinds'
import { getMission, isLive, startMission } from './missions'
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
  automations.set({ list: (await window.api.store.get('automations'))?.automations ?? [] })
  clearInterval(timer)
  timer = setInterval(() => void tick(), TICK_MS)
  // give the app a moment to load runs and missions before anything can start
  setTimeout(() => void tick(), 5000)
}

export function saveAutomation(a: Automation): void {
  automations.set((s) => ({ list: s.list.some((x) => x.id === a.id) ? s.list.map((x) => (x.id === a.id ? a : x)) : [a, ...s.list] }))
  persist()
}

export function setEnabled(id: string, enabled: boolean): void {
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
