import { useEffect, useMemo } from 'react'
import { criteriaOf, findPrReview, prReviewKey, putPrReview, type ReviewSubject } from '@shared/review'
export { targetOf } from '@shared/review'
import type { GhPrReview, Mission, PrReview, ReviewState, ReviewTarget } from '@shared/types'
import { getMission, isLive, missionBase, refreshStats, update, useMission } from './missions'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

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
  }
}

// ── pull requests ─────────────────────────────────────────────────────

type PrMeta = Omit<GhPrReview, 'diff'>

/** prReviews.json, read once, and what gh said about each PR this session (by prReviewKey) */
export const prReviews = createStore<{ list: PrReview[]; loaded: boolean; meta: Record<string, PrMeta> }>({ list: [], loaded: false, meta: {} })

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

function fromPr(t: PrTarget, entry: PrReview | undefined, meta: PrMeta | undefined): ReviewSource {
  const body = meta?.body ?? ''
  return {
    target: t,
    key: `pr-${t.number}-${t.root.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-40)}`,
    title: meta?.title ?? `Pull request #${t.number}`,
    caption: meta?.branch ? `#${t.number} · ${meta.branch} → ${meta.base}` : `#${t.number}`,
    cwd: t.root,
    root: t.root,
    ask: body || meta?.title || `Pull request #${t.number}`,
    criteria: criteriaOf({ brief: body }),
    review: entry?.review ?? {},
    mission: undefined
  }
}

const prResolver: Resolver<PrTarget> = {
  use(t) {
    const key = keyOf(t)
    const entry = useStore(prReviews, (s) => findPrReview(s.list, t.root, t.number))
    const meta = useStore(prReviews, (s) => s.meta[key])
    useEffect(() => void loadPrReviews(), [])
    return useMemo(() => fromPr(t, entry, meta), [t, entry, meta])
  },
  get(t) {
    const s = prReviews.get()
    return fromPr(t, findPrReview(s.list, t.root, t.number), s.meta[keyOf(t)])
  },
  async read(t) {
    await loadPrReviews()
    const { diff, ...meta } = await window.api.gh.prReview(t.root, t.number)
    prReviews.set((s) => ({ meta: { ...s.meta, [keyOf(t)]: meta } }))
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
      brief: meta?.body || undefined,
      criteria: criteriaOf({ brief: meta?.body ?? '' }),
      base: meta?.base ? `origin/${meta.base}` : 'HEAD',
      diff: `gh pr diff ${t.number}`
    }
  }
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

/** Is an agent at work on the change right now (nothing to send back to yet)? */
export const workingOn = (s: ReviewSource): boolean => !!s.mission && isLive(s.mission.status)

/** The agent offered first for walkthroughs and questions: the one that did the work, else the default. */
export const firstAgent = (s: ReviewSource): string => s.agent ?? (s.mission ? 'claude' : workspace.get().defaultAgent)
