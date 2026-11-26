import { prNumber } from './gitGraph'
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

/**
 * A pull request reviewed in the Review tab: merging is about the commit that was reviewed. New commits since
 * (GitHub's head isn't the reviewed one) come first, since GitHub refuses --match-head-commit anyway.
 */
export function prMergeBlock(pr: ShipPr, checks: ChecksSummary, reviewed: string | undefined): string | null {
  if (pr.state === 'MERGED') return `#${pr.number} is already merged`
  if (pr.state === 'CLOSED') return `#${pr.number} is closed`
  if (reviewed && pr.headSha && reviewed !== pr.headSha) return `New commits since you looked (${reviewed.slice(0, 7)} → ${pr.headSha.slice(0, 7)}): refresh the review first`
  return mergeBlock(pr, checks)
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export const EVENT_LABEL: Record<ReviewEvent, string> = { APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes', COMMENT: 'Comment' }

/** One review as GitHub's REST API takes it (POST /repos/{owner}/{repo}/pulls/{n}/reviews), pinned to the reviewed commit. */
export interface ReviewPayload {
  event: ReviewEvent
  body: string
  commit_id?: string
  comments: Array<{ path: string; line: number; side: 'RIGHT' | 'LEFT'; body: string }>
}

/** The payload, or why it can't be sent: GitHub wants a body for Request changes and Comment unless there are comments. */
export function reviewPayload(event: ReviewEvent, body: string, comments: ReviewPayload['comments'], commit?: string): ReviewPayload | { error: string } {
  const text = body.trim()
  const lines = comments.filter((c) => c.body.trim() && c.path && c.line > 0).map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body.trim() }))
  if (event !== 'APPROVE' && !text && !lines.length) return { error: event === 'REQUEST_CHANGES' ? 'Say what should change' : 'Write a comment first' }
  if (commit && !/^[0-9a-f]{7,40}$/i.test(commit)) return { error: 'The reviewed commit is unknown; refresh and try again' }
  return { event, body: text, ...(commit ? { commit_id: commit } : {}), comments: lines }
}

/** The summary of a review: the general text, then the notes that have no line to sit on. */
export function reviewSummary(text: string, loose: string[]): string {
  return [text.trim(), loose.length ? loose.map((l) => `- ${l}`).join('\n') : ''].filter(Boolean).join('\n\n')
}

export const METHOD_LABEL: Record<MergeMethod, string> = { squash: 'Squash and merge', merge: 'Create a merge commit', rebase: 'Rebase and merge' }

export function isMergeMethod(v: unknown): v is MergeMethod {
  return v === 'squash' || v === 'merge' || v === 'rebase'
}

/** Worth asking again soon: a run is going, or GitHub hasn't worked out mergeability yet. */
export const shipBusy = (s: ShipStatus | null, checks: ChecksSummary): boolean =>
  !!s && s.pr?.state === 'OPEN' && (checks.pending > 0 || s.pr.mergeable === 'UNKNOWN')

// ── the base moved ───────────────────────────────────────────────
// A branch can merge into its base without a git conflict and still break the build (two branches each
// declaring the same function). GitHub only says BEHIND/CONFLICTING after a push; this says it before.

export interface BaseCommit {
  sha: string
  subject: string
}

export interface BaseMoved {
  /** the mission's base as recorded ("master") */
  base: string
  /** what was compared: the base, or its upstream ("origin/master") when the local one only lags it */
  ref: string
  /** commits on `ref` the branch doesn't have */
  behind: number
  /** the newest of them (at most 50), newest first */
  commits: BaseCommit[]
  /** files a merge of `ref` would conflict in ([] none); null when this git can't tell (before 2.38) */
  conflicts: string[] | null
}

/** "#2 Add teams" for a PR's commit ("Add teams (#2)", "Merge pull request #2 from …"), else its subject. */
export function baseCommitLabel(c: BaseCommit): string {
  const n = prNumber(c.subject)
  if (n === null) return c.subject
  if (/^Merge pull request #/.test(c.subject)) return `#${n}`
  return `#${n} ${c.subject.replace(/\s*\(#\d+\)\s*$/, '')}`
}

/** "master has 2 new commits since this branch: #2 Add teams, #3 Fix x", or null when it hasn't moved. */
export function baseMovedLine(b: BaseMoved, shown = 3): string | null {
  if (!b.behind) return null
  const labels = b.commits.slice(0, shown).map(baseCommitLabel)
  const rest = b.behind - labels.length
  const list = labels.join(', ') + (rest > 0 ? ` and ${rest} more` : '')
  return `${b.ref} has ${plural(b.behind, 'new commit')} since this branch: ${list}`
}

/** What the trial merge says, for the line's tone: amber when it moved, red when it would conflict. */
export function baseMovedSignal(b: BaseMoved): Signal {
  if (b.conflicts?.length) return { tone: 'error', label: `Conflicts with ${b.ref} in ${plural(b.conflicts.length, 'file')}`, pulse: false }
  if (b.behind) return { tone: 'attention', label: b.conflicts ? `Merges cleanly; the build may still break` : `${b.ref} moved`, pulse: false }
  return { tone: 'done', label: `Up to date with ${b.ref}`, pulse: false }
}

/** The project checks Update and check runs, as factory recipes name them: optional runtimes. */
export const UPDATE_CHECKS = ['typecheck?', 'test?']

export interface UpdateCheck {
  name: string
  command: string
  code: number | null
  output: string
  timedOut?: boolean
}

export interface UpdateResult {
  /** the base was merged into the worktree (a merge commit, or a fast-forward) */
  merged: boolean
  /** the merge conflicted in these files and was undone */
  conflicts: string[]
  checks: UpdateCheck[]
  /** checks the project doesn't have */
  skipped: string[]
}

export const checkPassed = (c: UpdateCheck): boolean => c.code === 0 && !c.timedOut

export type UpdateVerdict = { ok: boolean; label: string }

export function updateVerdict(r: UpdateResult, ref: string): UpdateVerdict {
  if (r.conflicts.length) return { ok: false, label: `${ref} conflicts in ${plural(r.conflicts.length, 'file')}; the merge was undone` }
  const failed = r.checks.filter((c) => !checkPassed(c))
  if (failed.length) return { ok: false, label: `Merged ${ref}; ${failed.map((c) => c.name).join(' and ')} failed` }
  if (!r.checks.length) return { ok: true, label: `Merged ${ref}; no typecheck or test to run in this project` }
  return { ok: true, label: `Merged ${ref}; ${r.checks.map((c) => c.name).join(' and ')} passed` }
}

/** The last lines of a check's output: what an agent (or a person) needs to see why it failed. */
export function tailOutput(out: string, max = 4000): string {
  const t = out.trimEnd()
  return t.length <= max ? t : `…${t.slice(-max)}`
}

/** The follow-up Send back gives the mission's own agent when the base moved and the branch no longer builds. */
export function sendBackText(r: UpdateResult, ref: string, branch: string): string {
  if (r.conflicts.length)
    return `${ref} moved and this branch (${branch}) no longer merges into it: merging ${ref} conflicts in\n${r.conflicts.map((f) => `- ${f}`).join('\n')}\n\nMerge ${ref} into this branch, resolve the conflicts keeping both sides' intent, run the checks, and commit. Don't push; I push from the review.`
  const failed = r.checks.filter((c) => !checkPassed(c))
  const parts = failed.map((c) => `\`${c.command}\` ${c.timedOut ? 'timed out' : `exited with ${c.code ?? 'an error'}`}:\n\n\`\`\`\n${tailOutput(c.output)}\n\`\`\``)
  return `${ref} moved and this no longer builds. I merged ${ref} into this branch (${branch}, committed locally) and ran the project checks:\n\n${parts.join('\n\n')}\n\nFix the cause, run the same checks again, and commit. Don't push; I push from the review.`
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`
