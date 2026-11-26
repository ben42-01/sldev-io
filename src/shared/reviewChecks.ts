import type { Signal } from './status'
import type { ReviewCheck, ReviewChecks } from './types'
import { tailOutput, UPDATE_CHECKS } from './ship'

/**
 * Run checks, in the review cockpit: the project's typecheck and test (the same optional runtimes Update and
 * check runs), each in its own terminal in the folder under review (a PR's worktree, a mission's folder), after
 * the worktree's dependencies are installed once. Only on a click, killed on timeout, nothing pushed. The
 * result is keyed by the commit it ran on, so a new commit (or, in a mission's folder, new uncommitted edits)
 * makes it stale. Pure: state/reviewChecks.ts does the running.
 */

export const REVIEW_CHECKS = UPDATE_CHECKS

/** a project's typecheck or test suite */
export const REVIEW_CHECK_TIMEOUT_MS = 15 * 60_000

/** what is kept of a check's output on the review (the terminal has all of it) */
export const CHECK_TAIL = 4000

export type ChecksState = 'none' | 'running' | 'interrupted' | 'stale' | 'passed' | 'failed'

/**
 * Where the last Run checks stands against what the review shows now. `live` = it is running in this window
 * (a 'running' left by a restart is interrupted: its terminals are gone). `head` is the commit under review,
 * unknown ('') while it is being read: then nothing is called stale.
 */
export function checksState(c: ReviewChecks | undefined, head: string, diff: string | undefined, live: boolean): ChecksState {
  if (!c) return 'none'
  if (c.status === 'running') return live ? 'running' : 'interrupted'
  if (staleReason(c, head, diff)) return 'stale'
  return checksFailed(c) ? 'failed' : 'passed'
}

/** Why the result no longer says anything about the code under review, or null when it still does. */
export function staleReason(c: ReviewChecks, head: string, diff: string | undefined): string | null {
  if (head && c.head && !sameCommit(c.head, head)) return `Ran on ${c.head.slice(0, 7)}; the review is at ${head.slice(0, 7)} now`
  if (diff && c.diff && diff !== c.diff) return `Ran on ${c.head.slice(0, 7)}; files changed since`
  return null
}

const sameCommit = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a)

export const checkOk = (c: ReviewCheck): boolean => c.status === 'passed'

export function checksFailed(c: ReviewChecks): boolean {
  return !!c.error || c.setup?.ok === false || c.results.some((r) => r.status === 'failed')
}

/** How a finished command ended: passed only on exit 0, in time, with the terminal still open. */
export function endCheck(c: ReviewCheck, end: { code?: number | null; timedOut?: boolean; closed?: boolean; output?: string }): ReviewCheck {
  const ok = end.code === 0 && !end.timedOut && !end.closed
  return {
    ...c,
    status: ok ? 'passed' : 'failed',
    code: end.code ?? null,
    ...(end.timedOut ? { timedOut: true } : {}),
    ...(end.closed ? { closed: true } : {}),
    tail: tailOutput(withoutNotice(end.output ?? ''), CHECK_TAIL)
  }
}

/** The terminal's own "[npm test exited with code 1. Press Enter to run again]" isn't the command's output. */
const withoutNotice = (out: string): string => out.replace(/\n*\[[^\n]* exited with code -?\d+\. Press Enter to run again\]\s*$/, '')

/** "passed", "exit 2", "timed out"… for a check's row. */
export function checkLabel(c: ReviewCheck): string {
  if (c.status === 'waiting') return 'waiting'
  if (c.status === 'running') return 'running'
  if (c.status === 'passed') return 'passed'
  if (c.timedOut) return `timed out after ${Math.round(REVIEW_CHECK_TIMEOUT_MS / 60_000)} min`
  if (c.closed) return 'terminal closed'
  return `exit ${c.code ?? '?'}`
}

/** The strip's pill and line. */
export function checksSummary(c: ReviewChecks | undefined, state: ChecksState, head: string, diff?: string): { signal: Signal; line: string } {
  if (!c || state === 'none') return { signal: { tone: 'neutral', label: 'Not run', pulse: false }, line: 'Run the project\'s typecheck and tests on exactly this code, here, before you approve.' }
  const names = c.results.map((r) => r.name)
  const sha = c.head.slice(0, 7)
  if (state === 'running') {
    const now = c.results.find((r) => r.status === 'running')
    const doing = !c.setup || c.results.some((r) => r.status !== 'waiting') ? (now ? `Running ${now.name}` : 'Starting') : `Installing dependencies (${c.setup.command})`
    return { signal: { tone: 'working', label: 'Running', pulse: true }, line: `${doing} on ${sha}…` }
  }
  if (state === 'interrupted') return { signal: { tone: 'attention', label: 'Interrupted', pulse: false }, line: `The app closed while the checks ran on ${sha}. Run them again.` }
  const verdict = c.error
    ? c.error
    : c.setup?.ok === false
      ? `Installing dependencies failed (${c.setup.command})`
      : !names.length
        ? `No ${c.skipped.join(' or ') || 'checks'} in this project`
        : summaryOf(c.results)
  if (state === 'stale') return { signal: { tone: 'attention', label: 'Stale', pulse: false }, line: `${staleReason(c, head, diff)}. ${verdict}` }
  const on = names.length && !c.error && c.setup?.ok !== false ? ` on ${sha}` : ''
  if (state === 'failed') return { signal: { tone: 'error', label: 'Failed', pulse: false }, line: verdict + on }
  return { signal: { tone: 'done', label: 'Passed', pulse: false }, line: verdict + on }
}

function summaryOf(results: ReviewCheck[]): string {
  const failed = results.filter((r) => r.status === 'failed').map((r) => r.name)
  const passed = results.filter((r) => r.status === 'passed').map((r) => r.name)
  if (failed.length) return `${and(failed)} failed${passed.length ? `, ${and(passed)} passed` : ''}`
  return `${and(passed)} passed`
}

const and = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
