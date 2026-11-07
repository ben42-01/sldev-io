import { contestantKey, scoreboard, type EvalAttempt } from './evals'

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
 * project's evals (pass rate, then partial credit, then speed), else the default. Explains why.
 */
export function routeAgent(attempts: EvalAttempt[], installed: string[], fallback: string): { agent: string; model?: string; why: string } {
  const best = scoreboard(attempts).find((s) => installed.includes(s.contestant.agent))
  if (!best || !best.passed) return { agent: fallback, why: 'your default agent (no eval results to route by yet)' }
  return { agent: best.contestant.agent, model: best.contestant.model, why: `best on your evals: ${best.passed}/${best.attempts} passed (${contestantKey(best.contestant)})` }
}

/** What sldev_wait tells the Lead about finished workers: status, branch, diff and the report. */
export function workerSummary(w: WorkerView): string {
  const head = `${w.id} · ${w.agent} · ${w.status === 'ended' ? 'finished' : w.status === 'failed' ? 'FAILED' : w.status} · ${w.title}`
  const where = [w.branch && `branch ${w.branch}`, w.diff && `${w.diff.lines} changed lines in ${w.diff.files} files`].filter(Boolean).join(', ')
  const report = w.report?.trim() ? w.report.trim().slice(0, 1800) : '(no report)'
  return [head, where, `Report:\n${report}`].filter(Boolean).join('\n')
}

/** The answer to sldev_wait: what finished, and what is still going. */
export function waitText(finished: WorkerView[], running: WorkerView[]): string {
  if (!finished.length && !running.length) return 'No workers yet. Start one with sldev_delegate.'
  const parts: string[] = []
  if (finished.length) parts.push(`Finished:\n\n${finished.map(workerSummary).join('\n\n---\n\n')}`)
  if (running.length) parts.push(`Still running: ${running.map((w) => `${w.id} (${w.agent}, ${w.title})`).join('; ')}.${finished.length ? '' : ' Call sldev_wait again.'}`)
  if (finished.length) parts.push('Review each diff with sldev_mission_diff before you integrate it; send work back with sldev_followup.')
  return parts.join('\n\n')
}

/** The brief a worker gets: the task, what done means, and that it is one part of a bigger goal. */
export function workerBrief(o: { goal: string; task: string; criteria?: string }): string {
  return [o.task.trim(), o.criteria?.trim() ? `Acceptance criteria:\n${o.criteria.trim()}` : '', `This is one part of a bigger goal another agent is coordinating: ${o.goal.trim().split('\n')[0].slice(0, 160)}. Do only this part; don't start on the others.`].filter(Boolean).join('\n\n')
}

/** The Lead kind's working method, appended to its goal (see the 'lead' mission kind). */
export const LEAD_METHOD = [
  'You are the Lead: you plan and coordinate, other agents write the code. Do not edit files yourself, except to resolve a merge conflict.',
  'How to work:',
  '1. Read enough of the code to plan. Split the goal into independent tasks of one pull request each, with acceptance criteria.',
  '2. Start each with sldev_delegate (agent "auto" picks the best agent from this project\'s evals; or name one). Workers run in parallel in their own branches, made from yours.',
  '3. Call sldev_wait to get their reports. Review every diff with sldev_mission_diff against the criteria. If it falls short, send it back with sldev_followup and say exactly what to fix.',
  '4. Merge good work into your branch with sldev_integrate (give it the test command), in an order that builds up. Later workers start from what you integrated.',
  '5. When everything is in, end with a summary for the human: what was built, by whom, what was checked, and what is left. Do not push: the human reviews your branch.',
  'Tell the user your plan before you delegate when the goal is ambiguous.'
].join('\n')
