import { contestantKey, scoreboard, type EvalAttempt } from './evals'
import { resolveAgentSpec } from './factory'
import { durationText, tokenText } from './board'
import type { AgentProfile, Mission } from './types'

/**
 * A Lead mission plans a big goal and delegates the pieces to other agents (sldev_delegate), each in
 * its own worktree branched from the Lead's, then reviews what comes back (sldev_wait, the diff),
 * sends work back (sldev_followup) and merges the finished branches into its own (sldev_integrate).
 * Workers can't delegate, nothing is pushed, and the limits below are hard. This file is the pure part.
 */

export interface LeadLimits {
  /** workers it may start in total */
  maxWorkers: number
  /** workers that may run at once */
  parallel: number
}

export const DEFAULT_LEAD: LeadLimits = { maxWorkers: 6, parallel: 3 }

/** a worker as the Lead sees it */
export interface WorkerView {
  id: string
  title: string
  agent: string
  /** the profile it works as (sldev_delegate's role) */
  role?: string
  status: 'starting' | 'working' | 'needs-input' | 'waiting' | 'ended' | 'failed'
  branch?: string
  report?: string
  diff?: { files: number; lines: number }
  /** the Lead was already told it finished */
  reported?: boolean
  merged?: boolean
}

export const workerDone = (w: Pick<WorkerView, 'status'>): boolean => w.status === 'ended' || w.status === 'failed'

/** Whether the Lead may start another worker now, and if not, what to tell it. */
export function canDelegate(limits: LeadLimits, workers: WorkerView[]): string | null {
  if (workers.length >= limits.maxWorkers) return `You have used all ${limits.maxWorkers} workers this Lead may start. Integrate what is done, or finish.`
  const live = workers.filter((w) => !workerDone(w)).length
  if (live >= limits.parallel) return `${live} workers are running, the most at once. Call sldev_wait for one of them first.`
  return null
}

/**
 * Which agent takes a task when the Lead says "auto": the best of the installed agents on this
 * project's evals (pass rate, then partial credit, then speed), else the default. With a role, evals
 * tagged with that role (`role:` in the eval file) decide first, then all evals. Explains which was used.
 * A profile that pins an agent never gets here: the caller uses the profile's agent.
 */
export function routeAgent(attempts: EvalAttempt[], installed: string[], fallback: string, role?: string): { agent: string; model?: string; why: string } {
  // prompt variants measure instructions, not agents: route by the plain attempts
  const plain = attempts.filter((a) => !a.contestant.prompt)
  const best = (list: EvalAttempt[]) => {
    const s = scoreboard(list).find((x) => installed.includes(x.contestant.agent))
    return s && s.passed ? s : undefined
  }
  const said = (s: NonNullable<ReturnType<typeof best>>, where: string) => ({ agent: s.contestant.agent, model: s.contestant.model, why: `${where}: ${s.passed}/${s.attempts} passed (${contestantKey(s.contestant)})` })
  const r = role?.trim().toLowerCase()
  if (r) {
    const forRole = best(plain.filter((a) => a.role?.trim().toLowerCase() === r))
    if (forRole) return said(forRole, `best ${role!.trim()} on your evals`)
  }
  const overall = best(plain)
  if (overall) return said(overall, r ? `best on your evals overall (no ${role!.trim()} eval results yet)` : 'best on your evals')
  return { agent: fallback, why: 'your default agent (no eval results to route by yet)' }
}

/**
 * The agent a delegated worker runs on: the one the Lead named, else the role's profile's (a pinned agent,
 * or "Role@cli"), which is never re-routed, else routing by the evals, for that role first.
 */
export function workerAgent(o: { named?: string; role?: { name: string; agent?: string }; attempts: EvalAttempt[]; installed: string[]; fallback: string }): { agent: string; model?: string; why: string } {
  if (o.named) return { agent: o.named, why: 'chosen by the Lead' }
  if (o.role?.agent) return { agent: o.role.agent, why: `the ${o.role.name} role's agent` }
  return routeAgent(o.attempts, o.installed, o.fallback, o.role?.name)
}

const who = (w: Pick<WorkerView, 'agent' | 'role'>): string => (w.role ? `${w.agent} as ${w.role}` : w.agent)

/** What sldev_wait tells the Lead about finished workers: status, branch, diff and the report. */
export function workerSummary(w: WorkerView): string {
  const head = `${w.id} · ${who(w)} · ${w.status === 'ended' ? 'finished' : w.status === 'failed' ? 'FAILED' : w.status} · ${w.title}`
  const where = [w.branch && `branch ${w.branch}`, w.diff && `${w.diff.lines} changed lines in ${w.diff.files} files`].filter(Boolean).join(', ')
  const report = w.report?.trim() ? w.report.trim().slice(0, 1800) : '(no report)'
  return [head, where, `Report:\n${report}`].filter(Boolean).join('\n')
}

/** The answer to sldev_wait: what finished, and what is still going. */
export function waitText(finished: WorkerView[], running: WorkerView[]): string {
  if (!finished.length && !running.length) return 'No workers yet. Start one with sldev_delegate.'
  const parts: string[] = []
  if (finished.length) parts.push(`Finished:\n\n${finished.map(workerSummary).join('\n\n---\n\n')}`)
  if (running.length) parts.push(`Still running: ${running.map((w) => `${w.id} (${who(w)}, ${w.title})`).join('; ')}.${finished.length ? '' : ' Call sldev_wait again.'}`)
  if (finished.length) parts.push('Review each diff with sldev_mission_diff before you integrate it; send work back with sldev_followup.')
  return parts.join('\n\n')
}

/** The brief a worker gets: the task, what done means, and that it is one part of a bigger goal. */
export function workerBrief(o: { goal: string; task: string; criteria?: string }): string {
  return [o.task.trim(), o.criteria?.trim() ? `Acceptance criteria:\n${o.criteria.trim()}` : '', `This is one part of a bigger goal another agent is coordinating: ${o.goal.trim().split('\n')[0].slice(0, 160)}. Do only this part; don't start on the others.`].filter(Boolean).join('\n\n')
}

/** The roles a worker can take: every profile there is, by name. */
export const roleNames = (profiles: Pick<AgentProfile, 'name'>[]): string[] => [...new Set(profiles.map((p) => p.name))]

/**
 * sldev_delegate's `role`: a profile by name, or "Profile@cli" for that profile on another agent. An agent's
 * own name is not a role, and an unknown one is refused with the roles there are, so nothing starts.
 */
export function resolveRole(role: string, profiles: AgentProfile[], agentIds: string[]): { profile: AgentProfile; agent?: string } | { error: string } {
  const r = resolveAgentSpec(role, profiles, agentIds)
  if ('profile' in r && r.profile) return { profile: r.profile, agent: r.agent }
  const names = roleNames(profiles)
  const why = 'error' in r && r.error.startsWith('Unknown agent') ? `${r.error}.` : `No role called "${role.split('@')[0].trim()}".`
  return { error: `${why} Roles: ${names.length ? names.join(', ') : 'none (add profiles in .sldev/agents)'}. Or leave role out.` }
}

/** The line a Lead's goal ends with: the roles its workers can take on this project. */
export function leadRoles(profiles: AgentProfile[]): string {
  if (!profiles.length) return ''
  const seen = new Set<string>()
  const lines = profiles
    .filter((p) => !seen.has(p.name) && seen.add(p.name))
    .map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ''}${p.agent ? ` (runs on ${p.agent}${p.model ? ` ${p.model}` : ''})` : ''}`)
  return `Roles you can give a worker (role in sldev_delegate; "Name@agent" runs it on another agent):\n${lines.join('\n')}`
}

/** The Lead kind's working method, appended to its goal (see the 'lead' mission kind). */
export const LEAD_METHOD = [
  'You are the Lead: you plan and coordinate, other agents write the code. Do not edit files yourself, except to resolve a merge conflict.',
  'How to work:',
  '1. Read enough of the code to plan. Split the goal into independent tasks of one pull request each, with acceptance criteria.',
  '2. Start each with sldev_delegate (agent "auto" picks the best agent from this project\'s evals; or name one). Give it a role (a profile below, e.g. "Reviewer") to have it work in that role, on the profile\'s agent and model if it sets one. Workers run in parallel in their own branches, made from yours.',
  '3. Call sldev_wait to get their reports. Review every diff with sldev_mission_diff against the criteria. If it falls short, send it back with sldev_followup and say exactly what to fix.',
  '4. Merge good work into your branch with sldev_integrate (give it the test command), in an order that builds up. Later workers start from what you integrated.',
  '5. When everything is in, end with a summary for the human: what was built, by whom, what was checked, and what is left. Do not push: the human reviews your branch.',
  'Tell the user your plan before you delegate when the goal is ambiguous.'
].join('\n')

/** One branch of a Lead's org view: the workers in one role, or those without one (`role` null). */
export interface RoleGroup<T> {
  role: string | null
  label: string
  workers: T[]
}

export const NO_ROLE = 'No role'

/**
 * A Lead's workers as a small org chart: grouped by role, each group in the order its first worker
 * started and its workers in the order they started; workers without a role come last, under "No role".
 */
export function groupByRole<T extends { role?: string; startedAt: number }>(workers: T[]): RoleGroup<T>[] {
  const sorted = [...workers].sort((a, b) => a.startedAt - b.startedAt)
  const groups = new Map<string | null, RoleGroup<T>>()
  for (const w of sorted) {
    const role = w.role?.trim() || null
    let g = groups.get(role)
    if (!g) groups.set(role, (g = { role, label: role ?? NO_ROLE, workers: [] }))
    g.workers.push(w)
  }
  const none = groups.get(null)
  return [...[...groups.values()].filter((g) => g.role !== null), ...(none ? [none] : [])]
}

/** What a group of missions took (a role's workers and their follow-ups, or a whole Lead), from what each measured when it finished. */
export interface SpentSum {
  ms: number
  tokens: number
  cost: number
  /** missions measured so far */
  measured: number
  /** of those, how many have their time only (no tokens) */
  timeOnly: number
  /** missions not measured yet: still running, or about to be measured */
  pending: number
  /** why some have no tokens, each reason once */
  notes: string[]
}

export function sumSpent(list: Array<Pick<Mission, 'spent'>>): SpentSum {
  const out: SpentSum = { ms: 0, tokens: 0, cost: 0, measured: 0, timeOnly: 0, pending: 0, notes: [] }
  for (const { spent: s } of list) {
    if (!s) {
      out.pending++
      continue
    }
    out.measured++
    out.ms += s.ms
    out.cost += s.cost ?? 0
    if (s.tokens) out.tokens += s.tokens
    else {
      out.timeOnly++
      if (s.noTokens && !out.notes.includes(s.noTokens)) out.notes.push(s.noTokens)
    }
  }
  return out
}

/**
 * "12 min · 840k tokens · $1.20"; "3 min · time only" when none of them has tokens; "(1 time only)" when some
 * don't, so a sum never passes for the whole; "· 1 unfinished" while some aren't measured. Null until one is.
 */
export function spentLine(s: SpentSum): string | null {
  if (!s.measured) return null
  const tokens = !s.tokens ? 'time only' : `${tokenText(s.tokens)} tokens${s.timeOnly ? ` (${s.timeOnly} time only)` : ''}`
  const cost = s.tokens && s.cost ? `$${s.cost < 0.01 ? '<0.01' : s.cost.toFixed(2)}` : ''
  return [durationText(s.ms), tokens, cost, s.pending ? `${s.pending} unfinished` : ''].filter(Boolean).join(' · ')
}

/** The hover text of a spend line: where the numbers come from, and why some have time only. */
export function spentTitle(s: SpentSum): string {
  const lines = ['Time each agent ran, and tokens from its own logs on this machine, at API list prices']
  if (s.timeOnly) lines.push(...s.notes.map((n) => `Time only: ${n}`))
  return lines.join('\n')
}
