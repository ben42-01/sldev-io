import type { GhIssue, GhRun } from './types'

/**
 * Automations start factory runs or missions on their own: on a schedule, when CI fails on a branch,
 * or when an issue gets a label. They run while the app is open. They never push: a run's pr stage
 * still waits for a click. This file is the pure part: when something is due and what is new.
 */

export type Trigger =
  | { type: 'schedule'; every: 'hour' | 'day' | 'weekdays' | 'week'; /** HH:MM, local time */ at: string; /** 0 = Sunday, for every: week */ day?: number }
  | { type: 'ci-failed'; branch: string }
  | { type: 'issue-label'; label: string }

export type Action =
  | { type: 'recipe'; recipe: string; /** what to build; for triggers the failure or the issue is added */ intent: string }
  | { type: 'mission'; kind: string; brief: string; agent?: string }

export interface Automation {
  id: string
  name: string
  /** the repository it watches and works in */
  root: string
  enabled: boolean
  trigger: Trigger
  action: Action
  createdAt: number
  /** when it last started something */
  lastRunAt?: number
  /** when GitHub was last asked (CI and issue triggers) */
  lastCheckAt?: number
  /** CI run ids and issue numbers it has already acted on */
  seen?: number[]
  /** the factory run or mission it started last; it doesn't start another while that one is live */
  lastStarted?: { type: 'run' | 'mission'; id: string }
  /** one line about the last thing that happened, shown in the list */
  lastNote?: string
}

/** How long after its time a schedule still runs (the app was busy or just woke up); later than this it's skipped, not caught up. */
export const SCHEDULE_GRACE_MS = 15 * 60_000
/** How often CI and issue triggers ask GitHub. */
export const POLL_MS = 5 * 60_000
/** Remembered ids per automation; plenty for 5-minute polling. */
const SEEN_LIMIT = 200

const parseAt = (at: string): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim())
  const h = m ? Math.min(23, Number(m[1])) : 9
  const min = m ? Math.min(59, Number(m[2])) : 0
  return [h, min]
}

/** The first time the schedule fires after `after` (local time). */
export function nextRun(t: Extract<Trigger, { type: 'schedule' }>, after: number): number {
  const [h, min] = parseAt(t.at)
  const d = new Date(after)
  if (t.every === 'hour') {
    d.setSeconds(0, 0)
    d.setMinutes(min)
    if (d.getTime() <= after) d.setHours(d.getHours() + 1)
    return d.getTime()
  }
  d.setHours(h, min, 0, 0)
  for (let i = 0; i < 8; i++) {
    const day = d.getDay()
    const ok = t.every === 'day' || (t.every === 'weekdays' && day >= 1 && day <= 5) || (t.every === 'week' && day === (t.day ?? 1))
    if (ok && d.getTime() > after) return d.getTime()
    d.setDate(d.getDate() + 1)
    d.setHours(h, min, 0, 0)
  }
  return d.getTime()
}

/**
 * due: start now. missed: its time passed while the app was closed or asleep, longer ago than the
 * grace period; nothing runs, the schedule just moves on. wait: not yet.
 */
export function scheduleState(a: Automation, now: number): 'due' | 'missed' | 'wait' {
  if (a.trigger.type !== 'schedule') return 'wait'
  const at = nextRun(a.trigger, a.lastRunAt ?? a.createdAt)
  if (at > now) return 'wait'
  return now - at <= SCHEDULE_GRACE_MS ? 'due' : 'missed'
}

export const shouldPoll = (a: Automation, now: number): boolean => a.trigger.type !== 'schedule' && now - (a.lastCheckAt ?? 0) >= POLL_MS

/** Failed CI runs on the branch, newest first, that started after the automation was made and weren't handled yet. */
export function newFailures(runs: GhRun[], a: Automation): GhRun[] {
  if (a.trigger.type !== 'ci-failed') return []
  const branch = a.trigger.branch
  const seen = new Set(a.seen ?? [])
  return runs.filter((r) => r.headBranch === branch && r.conclusion === 'failure' && !seen.has(r.databaseId) && Date.parse(r.createdAt) >= a.createdAt)
}

/** Labelled issues it hasn't acted on. Issues labelled before it existed count too: adding the label is the request. */
export function newIssues(issues: GhIssue[], a: Automation): GhIssue[] {
  const seen = new Set(a.seen ?? [])
  return issues.filter((i) => !seen.has(i.number))
}

export const remember = (a: Automation, ids: number[]): number[] => [...ids, ...(a.seen ?? [])].slice(0, SEEN_LIMIT)

/** What the started run or mission is asked to do: the automation's text, plus the CI failure it reacts to. */
export function ciIntent(text: string, r: GhRun): string {
  return [text.trim(), `CI failed: ${r.workflowName} (run ${r.databaseId}) on ${r.headBranch}: ${r.displayTitle}`, `Logs: gh run view ${r.databaseId} --log-failed`, r.url].filter(Boolean).join('\n\n')
}

/** "Every weekday at 09:00", "When CI fails on main", … */
export function describeTrigger(t: Trigger): string {
  if (t.type === 'ci-failed') return `When CI fails on ${t.branch}`
  if (t.type === 'issue-label') return `When an issue is labelled "${t.label}"`
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  if (t.every === 'hour') return `Every hour at :${parseAt(t.at)[1].toString().padStart(2, '0')}`
  const at = parseAt(t.at).map((n) => n.toString().padStart(2, '0')).join(':')
  if (t.every === 'day') return `Every day at ${at}`
  if (t.every === 'weekdays') return `Every weekday at ${at}`
  return `Every ${days[t.day ?? 1]} at ${at}`
}
