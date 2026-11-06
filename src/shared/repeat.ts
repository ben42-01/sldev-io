import type { DiffStat, WorktreeInfo } from './types'

/**
 * Repeat runs one brief several times, each pass building on the last: same folder (its worktree),
 * a commit after every pass, and the previous pass's report and check result handed to the next.
 * Iterating on a brief ("polish the UI") often gets further than one long run.
 *
 * When is a pass over? Guessing from a quiet terminal isn't safe enough to start the next one, so a
 * pass ends on a signal that can't be mistaken: the agent's process exits (print mode, where it can't
 * stop to ask anything), or you accept it. An optional check command then says whether it's good.
 * The app (state/automations.ts) and the CLI daemon both run their loops through this file.
 */

export interface RepeatPlan {
  /** passes in all; 0 = until a pass changes nothing (or it's stopped) */
  times: number
  /** minutes from one pass finishing to the next starting */
  gapMinutes: number
  /** a shell command run in the work folder after each pass; exit 0 means the pass is good */
  check?: string
  /** exit: the agent runs in print mode and its exit ends the pass; accept: interactive, you accept each pass */
  doneWhen: 'exit' | 'accept'
  /** keep going when a pass changes nothing (by default that ends the loop: nothing is left to improve) */
  keepGoingUnchanged?: boolean
}

export type PassOutcome = 'done' | 'unchanged' | 'check-failed' | 'failed' | 'limited' | 'stopped'

export interface Pass {
  n: number
  /** the mission (app) or pane (CLI) that ran it */
  mission: string
  startedAt: number
  /** HEAD when it started */
  base?: string
  /** uncommitted changes when it started (passes in place, without a worktree, don't commit) */
  startStat?: DiffStat
  endedAt?: number
  outcome?: PassOutcome
  /** the check's last lines, when it failed */
  checkOutput?: string
  /** what the agent reported, handed to the next pass */
  report?: string
}

export interface RepeatProgress {
  /** waiting: for the next pass (nextAt); paused: switched off, or the app closed mid-pass */
  state: 'waiting' | 'running' | 'checking' | 'paused' | 'finished'
  passes: Pass[]
  /** where every pass works: the first pass's worktree, or the project folder */
  cwd?: string
  worktree?: WorktreeInfo
  nextAt?: number
  /** why it finished or paused */
  reason?: string
}

/** How long after its time a pass still starts (the computer slept); later than that it moves on a gap instead of catching up. */
export const REPEAT_GRACE_MS = 15 * 60_000
/** the report and check output each pass hands on: enough to act on, short enough for a command line */
const REPORT_MAX = 2500
const CHECK_MAX = 2500

export const freshProgress = (now: number): RepeatProgress => ({ state: 'waiting', passes: [], nextAt: now })

export const lastPass = (p: RepeatProgress | undefined): Pass | undefined => p?.passes[p.passes.length - 1]

/** Pass numbers count from 1; the next is one more than the passes so far. */
export const nextPassNumber = (p: RepeatProgress | undefined): number => (p?.passes.length ?? 0) + 1

export function beginPass(p: RepeatProgress, pass: Omit<Pass, 'n'>, at: { cwd: string; worktree?: WorktreeInfo }): RepeatProgress {
  return { ...p, state: 'running', nextAt: undefined, reason: undefined, cwd: p.cwd ?? at.cwd, worktree: p.worktree ?? at.worktree, passes: [...p.passes, { ...pass, n: p.passes.length + 1 }] }
}

/** Did the pass change anything? Committed (HEAD moved) or not (the working tree's diff is different). */
export function passChanged(pass: Pick<Pass, 'base' | 'startStat'>, headNow: string | null | undefined, statNow: DiffStat | undefined): boolean {
  if (pass.base && headNow && headNow !== pass.base) return true
  const a = pass.startStat ?? { files: 0, insertions: 0, deletions: 0 }
  const b = statNow ?? { files: 0, insertions: 0, deletions: 0 }
  return a.files !== b.files || a.insertions !== b.insertions || a.deletions !== b.deletions
}

export interface PassResult {
  outcome: PassOutcome
  checkOutput?: string
  report?: string
}

/** The pass is over: record how it went, then finish the loop or schedule the next pass. */
export function endPass(plan: RepeatPlan, p: RepeatProgress, r: PassResult, now: number): RepeatProgress {
  const passes = p.passes.slice()
  const i = passes.length - 1
  if (i < 0) return p
  const prev = passes[i - 1]
  passes[i] = { ...passes[i], endedAt: now, outcome: r.outcome, checkOutput: clip(r.checkOutput, CHECK_MAX, true), report: clip(r.report, REPORT_MAX) }
  const n = passes[i].n
  const stop = (reason: string): RepeatProgress => ({ ...p, passes, state: 'finished', nextAt: undefined, reason })
  if (r.outcome === 'failed') return stop(`Pass ${n} failed`)
  if (r.outcome === 'limited') return stop(`Pass ${n} stopped at the agent's usage limit`)
  if (r.outcome === 'stopped') return stop(`Stopped during pass ${n}`)
  if (r.outcome === 'unchanged' && !plan.keepGoingUnchanged) return stop(`Pass ${n} changed nothing: nothing left to improve`)
  if (r.outcome === 'check-failed' && prev?.outcome === 'check-failed') return stop(`The check failed twice in a row (passes ${n - 1} and ${n})`)
  if (plan.times > 0 && n >= plan.times) return stop(r.outcome === 'check-failed' ? `${plan.times === 1 ? 'The pass ran' : `All ${plan.times} passes ran`}; the check failed after the last one` : plan.times === 1 ? 'The pass is done' : `All ${plan.times} passes done`)
  return { ...p, passes, state: 'waiting', reason: undefined, nextAt: now + Math.max(0, plan.gapMinutes) * 60_000 }
}

/** due: start the next pass now. missed: its time passed long ago (the computer slept); it moves on a gap, no catching up. */
export function repeatDue(p: RepeatProgress | undefined, now: number): 'due' | 'missed' | 'wait' {
  if (!p || p.state !== 'waiting' || p.nextAt === undefined || p.nextAt > now) return 'wait'
  return now - p.nextAt <= REPEAT_GRACE_MS ? 'due' : 'missed'
}

/** The brief a pass gets: the user's brief, where it stands in the loop, and what the last pass left. The kind adds its closing lines. */
export function passBrief(brief: string, plan: RepeatPlan, n: number, prev?: Pass): string {
  const of = plan.times > 0 ? ` of ${plan.times}` : ''
  const lines = [brief.trim(), '']
  if (n === 1 && plan.times === 1) {
    lines.pop()
  } else if (n === 1) {
    lines.push(
      `This is pass 1${of} of a repeated mission: more passes follow, each building on what the one before left. Make one solid, complete round of improvements rather than trying to do everything at once.`
    )
  } else {
    lines.push(
      `This is pass ${n}${of} of a repeated mission. Earlier passes already worked on this in this folder${prev?.base ? ' and committed their changes (see `git log`)' : ''}. Build on them: improve what's there, don't start over or undo good work. If nothing is left that's worth changing, change nothing and say so.`
    )
    if (prev?.outcome === 'check-failed' && plan.check) {
      lines.push('', `After the last pass the check \`${plan.check}\` failed. Fix that first. Its output:`, '', '```', prev.checkOutput?.trim() || '(no output)', '```')
    }
    if (prev?.report?.trim()) lines.push('', 'The last pass reported:', '', prev.report.trim())
  }
  return lines.join('\n')
}

/** "5 passes, 30 min apart, checked with `npm test`", "Until nothing changes, back to back" */
export function describeRepeat(plan: RepeatPlan): string {
  const count = plan.times > 0 ? `${plan.times} pass${plan.times === 1 ? '' : 'es'}` : 'Until nothing changes'
  const gap = plan.gapMinutes > 0 ? `${formatGap(plan.gapMinutes)} apart` : 'back to back'
  const how = plan.doneWhen === 'accept' ? 'you accept each' : 'unattended'
  return [count, gap, how, plan.check?.trim() ? `checked with \`${plan.check.trim()}\`` : ''].filter(Boolean).join(', ')
}

/** "Pass 2 of 5", "Checking pass 3", "Next pass at 14:30", or why it finished. */
export function progressLabel(plan: RepeatPlan, p: RepeatProgress | undefined, now: number, time: (t: number) => string): string {
  if (!p || (!p.passes.length && p.state === 'waiting')) return 'Not started'
  const n = lastPass(p)?.n ?? 0
  const of = plan.times > 0 ? ` of ${plan.times}` : ''
  if (p.state === 'running') return `Pass ${n}${of} running`
  if (p.state === 'checking') return `Checking pass ${n}${of}`
  if (p.state === 'waiting') return p.nextAt !== undefined && p.nextAt > now ? `Pass ${n + 1}${of} at ${time(p.nextAt)}` : `Pass ${n + 1}${of} next`
  return p.reason ?? (p.state === 'paused' ? `Paused after pass ${n}` : `Finished after pass ${n}`)
}

export function formatGap(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)} s`
  if (minutes < 60 || minutes % 60) return `${Math.round(minutes)} min`
  return `${minutes / 60} h`
}

/** "30m", "1h", "90s", "45" (minutes), "0" → minutes; undefined when it isn't a duration. */
export function parseGap(text: string): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr)?\s*$/i.exec(text)
  if (!m) return undefined
  const n = Number(m[1])
  const unit = (m[2] ?? 'm').toLowerCase()
  return unit.startsWith('s') ? n / 60 : unit.startsWith('h') ? n * 60 : n
}

function clip(text: string | undefined, max: number, tail = false): string | undefined {
  const t = text?.trim()
  if (!t) return undefined
  if (t.length <= max) return t
  return tail ? `…${t.slice(-max)}` : `${t.slice(0, max)}…`
}
