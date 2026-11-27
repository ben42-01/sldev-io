import { useEffect, useMemo } from 'react'
import { criteriaOf, findPrReview, prAsk, prCriteria, prReviewKey, putPrReview, type ReviewSubject } from '@shared/review'
export { targetOf } from '@shared/review'
import type { GhPrReview, Mission, PrReview, ReviewState, ReviewTarget } from '@shared/types'
import type { PrWorktree } from '@shared/prs'
import { getMission, isLive, missionBase, refreshStats, update, useMission } from './missions'
import { createStore, useStore } from './store'
import { prTabTitle } from '@shared/prs'
import { openPanel } from '../dock/dockApi'
import { updateSettings, workspace } from './workspace'

/**
 * What the Review tab reviews, resolved per kind of target: a mission's change (its folder, its base, the
 * marks kept on the mission) or a pull request (read through gh, the marks in prReviews.json). The panel,
 * the cockpit and the review helpers only ever see a ReviewSource; this file is the one place that knows
 * the kinds apart.
 */
export interface ReviewSource {
  target: ReviewTarget
  /** stable and file-name safe: the tab's id and the helpers' run folder */
  key: string
  title: string
  /** the line under the title: branches, or where the change starts */
  caption: string
  /** where the files are opened and the helpers run */
  cwd: string
  /** the project: helpers write under its .sldev/runs */
  root: string
  /** what the change is diffed against locally; none when it isn't in this checkout (a pull request) */
  base?: string
  /** what was asked: the brief, or the PR description */
  ask: string
  criteria: string[]
  /** the agent that did the work, when an agent did */
  agent?: string
  review: ReviewState
  /** only a mission's change can be committed, shipped and sent back to its agent */
  mission?: Mission
  /** the commit under review when the source knows it without asking git (a PR's head from gh) */
  head?: string
  /** a pull request on GitHub: it can be approved, commented on and merged from the tab (where gh runs, its number) */
  pr?: { number: number; root: string; url?: string }
}

/** Where Run checks runs: the folder with exactly the code under review, and the commit checked out there. */
export interface CheckFolder {
  path: string
  head: string
  /** a worktree of its own: dependencies may be installed there (never in the user's main checkout) */
  worktree: boolean
  /** something to say about it ("checked out PR #128 at abc1234") */
  note?: string
}

interface Resolver<T extends ReviewTarget> {
  /** the source, kept up to date (a React hook) */
  use(t: T): ReviewSource | undefined
  get(t: T): ReviewSource | undefined
  /** the diff as git prints it */
  read(t: T): Promise<string>
  patch(t: T, f: (r: ReviewState) => ReviewState): void
  /** what the helper agents are told about it */
  subject(t: T): ReviewSubject | undefined
  /** the folder Run checks runs in, made ready (a PR's head checked out) */
  checkFolder(t: T): Promise<CheckFolder>
  /** the commit the change is at now, and how many commits came after `since` (null: `since` is no longer in its history) */
  head(t: T, since?: string): Promise<ReviewHead>
}

export interface ReviewHead {
  head?: string
  commits?: number | null
}

// ── missions ──────────────────────────────────────────────────────────

function fromMission(m: Mission): ReviewSource {
  const wt = m.worktree
  return {
    target: { kind: 'mission', id: m.id },
    key: m.id,
    title: m.title,
    caption: wt ? `${wt.branch} ← ${wt.base}` : 'changes since mission start',
    cwd: m.cwd,
    root: m.root,
    base: missionBase(m),
    ask: m.brief ?? m.prompt,
    criteria: criteriaOf(m),
    agent: m.options.agent,
    review: m.review ?? {},
    mission: m
  }
}

const missionResolver: Resolver<Extract<ReviewTarget, { kind: 'mission' }>> = {
  use(t) {
    const m = useMission(t.id)
    return useMemo(() => (m ? fromMission(m) : undefined), [m])
  },
  get(t) {
    const m = getMission(t.id)
    return m && fromMission(m)
  },
  async read(t) {
    const m = getMission(t.id)
    if (!m) throw new Error('That mission is gone')
    const text = await window.api.git.diff(m.cwd, missionBase(m))
    void refreshStats(m.id)
    return text
  },
  patch(t, f) {
    const m = getMission(t.id)
    if (m) update(t.id, { review: f(m.review ?? {}) })
  },
  subject(t) {
    const m = getMission(t.id)
    if (!m) return undefined
    const base = missionBase(m)
    return {
      title: m.title,
      brief: m.brief ?? m.prompt,
      report: m.reportFrom === 'terminal' ? undefined : m.report,
      criteria: criteriaOf(m),
      // a worktree's base is a branch that may have moved on: the diff is from where they forked
      base: m.worktree ? `$(git merge-base ${base} HEAD)` : base
    }
  },
  async head(t, since) {
    const m = getMission(t.id)
    const head = m ? ((await window.api.git.head(m.cwd).catch(() => null)) ?? undefined) : undefined
    if (!m || !head || !since || since === head) return { head, commits: 0 }
    return { head, commits: await window.api.git.commitsSince(m.cwd, since).catch(() => undefined) }
  },
  async checkFolder(t) {
    const m = getMission(t.id)
    if (!m) throw new Error('That mission is gone')
    const head = await window.api.git.head(m.cwd)
    if (!head) throw new Error(`${m.cwd} is not a git checkout`)
    return { path: m.cwd, head, worktree: !!m.worktree }
  }
}

// ── pull requests ─────────────────────────────────────────────────────

type PrMeta = Omit<GhPrReview, 'diff'>

/**
 * prReviews.json, read once, what gh said about each PR this session, the folder each PR's head is checked out in
 * for review (git:prWorktree, or one found already at its head), and the PRs being checked out now, all by prReviewKey
 */
export const prReviews = createStore<{ list: PrReview[]; loaded: boolean; meta: Record<string, PrMeta>; worktrees: Record<string, string>; checkingOut: Record<string, true> }>({
  list: [],
  loaded: false,
  meta: {},
  worktrees: {},
  checkingOut: {}
})

let loading: Promise<void> | null = null
export function loadPrReviews(): Promise<void> {
  if (prReviews.get().loaded) return Promise.resolve()
  loading ??= window.api.store
    .get('prReviews')
    .then((f) => prReviews.set((s) => ({ list: [...(f?.reviews ?? []), ...s.list.filter((r) => !findPrReview(f?.reviews ?? [], r.root, r.number))], loaded: true })))
    .catch(() => prReviews.set({ loaded: true }))
  return loading
}

type PrTarget = Extract<ReviewTarget, { kind: 'pr' }>
const keyOf = (t: PrTarget): string => prReviewKey(t.root, t.number)

const prKey = (t: PrTarget): string => `pr-${t.number}-${t.root.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-40)}`

function fromPr(t: PrTarget, entry: PrReview | undefined, meta: PrMeta | undefined, worktree: string | undefined): ReviewSource {
  const body = meta?.body ?? ''
  return {
    target: t,
    key: prKey(t),
    title: meta?.title ?? `Pull request #${t.number}`,
    caption: meta?.branch ? `#${t.number} · ${meta.branch} → ${meta.base}` : `#${t.number}`,
    // the PR's own files, once its head is checked out: files open there and the helpers read them there
    cwd: worktree ?? t.root,
    root: t.root,
    ask: body || meta?.title || `Pull request #${t.number}`,
    criteria: prCriteria(body, meta?.issues),
    review: entry?.review ?? {},
    mission: undefined,
    head: meta?.head,
    pr: { number: t.number, root: t.root, url: meta?.url }
  }
}

const prResolver: Resolver<PrTarget> = {
  use(t) {
    const key = keyOf(t)
    const entry = useStore(prReviews, (s) => findPrReview(s.list, t.root, t.number))
    const meta = useStore(prReviews, (s) => s.meta[key])
    const worktree = useStore(prReviews, (s) => s.worktrees[key])
    useEffect(() => void loadPrReviews(), [])
    return useMemo(() => fromPr(t, entry, meta, worktree), [t, entry, meta, worktree])
  },
  get(t) {
    const s = prReviews.get()
    return fromPr(t, findPrReview(s.list, t.root, t.number), s.meta[keyOf(t)], s.worktrees[keyOf(t)])
  },
  async read(t) {
    await loadPrReviews()
    const { diff, ...meta } = await window.api.gh.prReview(t.root, t.number)
    prReviews.set((s) => ({ meta: { ...s.meta, [keyOf(t)]: meta } }))
    // the diff is GitHub's: nothing is fetched or checked out to show it; a worktree left at this head is used for files
    if (!prReviews.get().worktrees[keyOf(t)]) void findCheckout(t, meta.head)
    return diff
  },
  patch(t, f) {
    const list = putPrReview(prReviews.get().list, t.root, t.number, f, prReviews.get().meta[keyOf(t)]?.head)
    prReviews.set({ list })
    void loadPrReviews().then(() => window.api.store.set('prReviews', { reviews: prReviews.get().list }))
  },
  subject(t) {
    const meta = prReviews.get().meta[keyOf(t)]
    return {
      title: meta?.title ?? `Pull request #${t.number}`,
      brief: meta ? prAsk(meta.title, meta.body, meta.issues) : undefined,
      criteria: prCriteria(meta?.body ?? '', meta?.issues),
      base: meta?.base ? `origin/${meta.base}` : 'HEAD',
      diff: `gh pr diff ${t.number}`
    }
  },
  async head(t, since) {
    const meta = prReviews.get().meta[keyOf(t)]
    const head = meta?.head || undefined
    if (!head || !since || since === head) return { head, commits: 0 }
    // gh lists the PR's commits: the ones after the reviewed head are new; a force push leaves it out
    const i = meta?.commits?.indexOf(since) ?? -1
    return { head, commits: !meta?.commits?.length ? undefined : i < 0 ? null : meta.commits.length - 1 - i }
  },
  async checkFolder(t) {
    // the PR's own worktree, at what GitHub has now: never the user's checkout
    const wt = await checkOutPr(t)
    const note = wt.action === 'created' ? `Checked out #${t.number}` : wt.action === 'moved' ? `Moved #${t.number}'s worktree to its new commits` : undefined
    return { path: wt.path, head: wt.head, worktree: true, note }
  }
}

const checkingOut = new Map<string, Promise<PrWorktree>>()
const ipcError = (e: unknown): string => String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

/**
 * Check PR `t`'s head out in its own detached worktree (made, reused, or moved to new commits): only when something
 * needs the PR's files (Run checks, Explain the change, Ask why), never on open, since a big repository's checkout
 * takes minutes. One at a time per PR; `checkingOut` says so meanwhile, and a failure throws for the action to show.
 */
function checkOutPr(t: PrTarget): Promise<PrWorktree> {
  const key = keyOf(t)
  const busy = checkingOut.get(key)
  if (busy) return busy
  prReviews.set((s) => ({ checkingOut: { ...s.checkingOut, [key]: true } }))
  const p = window.api.git
    .prWorktree(t.root, t.number, prReviews.get().meta[key]?.head || undefined)
    .then(
      (wt) => {
        prReviews.set((s) => ({ worktrees: { ...s.worktrees, [key]: wt.path } }))
        return wt
      },
      (e) => {
        throw new Error(`Couldn't check out #${t.number}: ${ipcError(e)}`)
      }
    )
    .finally(() => {
      checkingOut.delete(key)
      prReviews.set((s) => {
        const busy = { ...s.checkingOut }
        delete busy[key]
        return { checkingOut: busy }
      })
    })
  checkingOut.set(key, p)
  return p
}

/** A worktree of PR `t` left from before, used for its files when it is at `head` already (read-only: no fetch, no checkout). */
async function findCheckout(t: PrTarget, head: string): Promise<void> {
  const found = await window.api.git.findPrWorktree(t.root, t.number).catch(() => null)
  if (!found || !head || found.head !== head) return
  prReviews.set((s) => (s.worktrees[keyOf(t)] ? {} : { worktrees: { ...s.worktrees, [keyOf(t)]: found.path } }))
}

/** "Checking out #n…" while a PR's head is being checked out for the action that needs it, else null. */
export function useCheckingOut(s: ReviewSource): string | null {
  const busy = useStore(prReviews, (st) => !!s.pr && !!st.checkingOut[prReviewKey(s.pr.root, s.pr.number)])
  return busy && s.pr ? `Checking out #${s.pr.number}…` : null
}

/** The Review tab's id for a target, so opening the same thing again focuses its tab. */
export const reviewTabId = (t: ReviewTarget): string => (t.kind === 'mission' ? `diff-${t.id}` : `diff-${prKey(t)}`)

/**
 * Open PR `pr` of the project at `root` in a Review tab titled `#<n> <title>` (focused when it is already open). Nothing
 * is checked out: the diff comes from GitHub. `sinceReview` opens the walkthrough on "Since last review".
 */
export function openPrReview(root: string, pr: { number: number; title: string; headSha?: string }, opts: { sinceReview?: boolean } = {}): void {
  const t: PrTarget = { kind: 'pr', number: pr.number, root }
  if (opts.sinceReview && workspace.get().reviewView === 'files') updateSettings({ reviewView: 'walk' })
  // a new stamp each time, so a tab that is already open turns the filter on again
  openPanel('diff', reviewTabId(t), prTabTitle(pr), opts.sinceReview ? { target: t, sinceReview: Date.now() } : { target: t })
}

// ── the one switch ────────────────────────────────────────────────────

const RESOLVERS: { [K in ReviewTarget['kind']]: Resolver<Extract<ReviewTarget, { kind: K }>> } = { mission: missionResolver, pr: prResolver }
const resolver = <T extends ReviewTarget>(t: T): Resolver<T> => RESOLVERS[t.kind] as unknown as Resolver<T>

/** A tab's target never changes kind, so the hooks inside stay in the same order. */
export const useReviewSource = (t: ReviewTarget): ReviewSource | undefined => resolver(t).use(t)
export const getReviewSource = (t: ReviewTarget): ReviewSource | undefined => resolver(t).get(t)
export const readReviewDiff = (t: ReviewTarget): Promise<string> => resolver(t).read(t)
export const patchReview = (t: ReviewTarget, f: (r: ReviewState) => ReviewState): void => resolver(t).patch(t, f)
export const reviewSubject = (t: ReviewTarget): ReviewSubject | undefined => resolver(t).subject(t)
export const reviewHead = (t: ReviewTarget, since?: string): Promise<ReviewHead> => resolver(t).head(t, since)
export const checkFolder = (t: ReviewTarget): Promise<CheckFolder> => resolver(t).checkFolder(t)

/** Is an agent at work on the change right now (nothing to send back to yet)? */
export const workingOn = (s: ReviewSource): boolean => !!s.mission && isLive(s.mission.status)

/** The agent offered first for walkthroughs and questions: the one that did the work, else the default. */
export const firstAgent = (s: ReviewSource): string => s.agent ?? (s.mission ? 'claude' : workspace.get().defaultAgent)
