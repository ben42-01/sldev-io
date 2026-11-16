import { ghRunSignal, type Signal } from './status'

/**
 * The Review tab's ship bar: where a mission's branch stands on its way into the base branch. Its pull
 * request, the workflow runs on the commit under review, whether GitHub would merge it, and what the next
 * step is. Pure: main gathers the facts through git and gh, this decides what they mean.
 *
 * Checks come from the Actions runs of the branch (`gh run list`), not the PR's statusCheckRollup, because
 * fine-grained tokens can't read the rollup ("Resource not accessible by personal access token").
 */

export type MergeMethod = 'squash' | 'merge' | 'rebase'

export interface ShipPr {
  number: number
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  url: string
  isDraft: boolean
  /** MERGEABLE, CONFLICTING or UNKNOWN (GitHub is still working it out) */
  mergeable: string
  /** CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, HAS_HOOKS, DRAFT or UNKNOWN */
  mergeState: string
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or '' */
  reviewDecision: string
  base: string
  headSha: string
}

export interface ShipRun {
  id: number
  workflow: string
  title: string
  status: string
  conclusion: string
  event: string
  url: string
  createdAt: string
  headSha: string
}

export interface ShipStatus {
  branch: string
  /** the commit checked out in the worktree */
  localSha: string
  /** commits on the branch that origin doesn't have yet; null when the branch was never pushed */
  unpushed: number | null
  /** files changed but not committed in the worktree */
  uncommitted: number
  pr: ShipPr | null
  runs: ShipRun[]
  /** why GitHub couldn't be asked (gh missing, logged out, not a GitHub repo); git facts are still there */
  error?: string
}

/** The pull request a branch is about: an open one first, else the newest. */
export function pickPr<T extends { state: string; number: number }>(list: T[]): T | null {
  return list.find((p) => p.state === 'OPEN') ?? [...list].sort((a, b) => b.number - a.number)[0] ?? null
}

/**
 * The runs that say something about `sha`: the newest of each workflow and event on that commit. Without
 * any on it (pushed a second ago, or no CI for that commit), the newest of each on the branch, marked stale.
 */
export function currentRuns(runs: ShipRun[], sha: string): { runs: ShipRun[]; stale: boolean } {
  const newest = (list: ShipRun[]): ShipRun[] => {
    const seen = new Map<string, ShipRun>()
    for (const r of [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const k = `${r.workflow}\0${r.event}`
      if (!seen.has(k)) seen.set(k, r)
    }
    return [...seen.values()].sort((a, b) => a.workflow.localeCompare(b.workflow) || a.event.localeCompare(b.event))
  }
  const on = runs.filter((r) => r.headSha === sha)
  if (on.length) return { runs: newest(on), stale: false }
  return { runs: newest(runs), stale: runs.length > 0 }
}

export interface ChecksSummary {
  passed: number
  failed: number
  pending: number
  signal: Signal
  label: string
}

export function summarizeChecks(runs: ShipRun[]): ChecksSummary {
  let passed = 0
  let failed = 0
  let pending = 0
  for (const r of runs) {
    const t = ghRunSignal(r).tone
    if (t === 'error') failed++
    else if (r.status !== 'completed') pending++
    else passed++
  }
  const n = runs.length
  if (!n) return { passed, failed, pending, signal: { tone: 'neutral', label: 'No workflow runs', pulse: false }, label: 'No checks' }
  if (failed) return { passed, failed, pending, signal: { tone: 'error', label: `${failed} of ${n} failed`, pulse: pending > 0 }, label: `${failed} failed` }
  if (pending) return { passed, failed, pending, signal: { tone: 'working', label: `${pending} of ${n} running`, pulse: true }, label: `${pending} running` }
  return { passed, failed, pending, signal: { tone: 'done', label: `All ${n} passed`, pulse: false }, label: n === 1 ? 'Passed' : `${n} passed` }
}

/** What the next step is, and why the ones before it don't apply. */
export type ShipStep =
  | { kind: 'commit'; why: string }
  | { kind: 'push-pr'; why: string }
  | { kind: 'push'; why: string }
  | { kind: 'merge'; ready: boolean; why: string }
  | { kind: 'merged'; why: string }
  | { kind: 'closed'; why: string }

export function nextStep(s: ShipStatus, checks: ChecksSummary): ShipStep {
  const pr = s.pr
  if (pr?.state === 'MERGED') return { kind: 'merged', why: `#${pr.number} is merged into ${pr.base}` }
  if (s.uncommitted > 0) return { kind: 'commit', why: `${plural(s.uncommitted, 'file')} not committed yet` }
  if (!pr || pr.state === 'CLOSED') {
    if (pr?.state === 'CLOSED' && s.unpushed === 0) return { kind: 'closed', why: `#${pr.number} was closed without merging` }
    return { kind: 'push-pr', why: s.unpushed === null ? 'The branch is not on GitHub yet' : 'No pull request for this branch yet' }
  }
  if (s.unpushed) return { kind: 'push', why: `${plural(s.unpushed, 'commit')} not pushed: the PR doesn't have ${s.unpushed === 1 ? 'it' : 'them'} yet` }
  const block = mergeBlock(pr, checks)
  return { kind: 'merge', ready: !block, why: block ?? 'Ready to merge' }
}

/** Why merging now is a bad idea, or null when nothing stands in the way. GitHub has the last word. */
export function mergeBlock(pr: ShipPr, checks: ChecksSummary): string | null {
  if (pr.isDraft) return 'The PR is a draft'
  if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') return `Conflicts with ${pr.base}`
  if (checks.failed) return `${plural(checks.failed, 'check')} failed`
  if (checks.pending) return `${plural(checks.pending, 'check')} still running`
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'A reviewer asked for changes'
  if (pr.mergeState === 'BEHIND') return `Behind ${pr.base}: update the branch first`
  if (pr.mergeState === 'BLOCKED') return pr.reviewDecision === 'REVIEW_REQUIRED' ? 'Needs an approving review' : 'Blocked by a branch rule'
  return null
}

export const METHOD_LABEL: Record<MergeMethod, string> = { squash: 'Squash and merge', merge: 'Create a merge commit', rebase: 'Rebase and merge' }

export function isMergeMethod(v: unknown): v is MergeMethod {
  return v === 'squash' || v === 'merge' || v === 'rebase'
}

/** Worth asking again soon: a run is going, or GitHub hasn't worked out mergeability yet. */
export const shipBusy = (s: ShipStatus | null, checks: ChecksSummary): boolean =>
  !!s && s.pr?.state === 'OPEN' && (checks.pending > 0 || s.pr.mergeable === 'UNKNOWN')

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`
