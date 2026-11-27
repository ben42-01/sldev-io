import { stageMode } from '@shared/agents'
import { parseDiff, type DiffFile } from '@shared/diff'
import { askPrompt, buildCockpit, hunksOf, markOn, nextSeen, parseWalkthrough, reviewDraft, sendBackText, walkthroughPrompt, type DraftComment, type Hunk, type Part, type ReviewSubject, type Walkthrough } from '@shared/review'
import { reviewPayload, reviewSummary, type ReviewEvent } from '@shared/ship'
import { createStore } from './store'
import type { Mission, ReviewTarget } from '@shared/types'
import { getAgent } from './agents'
import { missionEnd, quietly } from './evals'
import { followUpMission, getMission, isLive, startMission } from './missions'
import { checkFolder, getReviewSource, patchReview, readReviewDiffAt, reviewSubject, type ReviewSource } from './reviewTargets'
import { workspace } from './workspace'

/**
 * The review cockpit's side effects: a print-mode agent writes the walkthrough (or answers a question
 * about one part) to a file under .sldev/runs of the project, and the reviewer's marks are kept where the
 * target keeps them (state/reviewTargets.ts: on the mission, or in prReviews.json for a pull request).
 * The helpers carry `explains`, so they stay off the boards and don't notify; like a judge, they get the
 * unattended mode (nobody is there to approve) and are told to touch nothing else.
 */

const WALK_MS = 15 * 60_000
const ASK_MS = 8 * 60_000
/** helper missions this window is waiting on; one left over from before a restart is read once when the review opens */
const inflight = new Set<string>()

const now = (): number => Date.now()

/** What the diff looked like: a walkthrough of an older diff says so. */
export const diffSignature = (files: DiffFile[]): string => {
  const h = hunksOf(files)
  return `${h.length}:${h.reduce((a, x) => a + x.additions + x.deletions, 0)}`
}

const source = (t: ReviewTarget, what = 'That review'): ReviewSource => {
  const s = getReviewSource(t)
  if (!s) throw new Error(`${what} is gone`)
  return s
}
const subjectOf = (t: ReviewTarget): ReviewSubject => {
  const s = reviewSubject(t)
  if (!s) throw new Error('That review is gone')
  return s
}

/**
 * Where a helper works: in the code under review. A PR's own worktree, checked out first if it isn't yet (shared
 * with the tab's other actions, so one checkout at a time); a failure stops the helper and says why, never falling
 * back to the user's checkout. A mission's own folder.
 */
async function helperFolder(t: ReviewTarget, s: ReviewSource): Promise<{ path: string; head?: string }> {
  if (s.pr) return checkFolder(t)
  return (await checkFolder(t).catch(() => null)) ?? { path: s.cwd }
}

async function helper(s: ReviewSource, cwd: string, agentId: string, prompt: string, title: string): Promise<Mission> {
  const agent = getAgent(agentId)
  return quietly(() =>
    startMission({
      prompt,
      title: title.slice(0, 60),
      root: s.root,
      cwd,
      // it writes one file, so not the read-only mode (that can't write at all); the prompt says not to touch anything else
      options: { agent: agent.id, print: true, permissionMode: stageMode(agent, workspace.get().factoryModes) },
      worktree: false,
      kind: { id: 'walkthrough', name: 'Walkthrough', readOnly: true },
      explains: { mission: s.key }
    })
  )
}

const runDir = (s: ReviewSource): string => `${s.root}/.sldev/runs/review-${s.key}`

/** An agent explains the change part by part; resolves when the walkthrough is in (or failed). */
export async function explainChanges(t: ReviewTarget, agentId: string): Promise<void> {
  const s = source(t)
  const folder = await helperFolder(t, s)
  // the diff the tab already read, when the PR is still at the head just checked out
  const files = parseDiff(await readReviewDiffAt(t, s.pr ? folder.head : undefined))
  if (!files.length) throw new Error('There are no changes to explain yet')
  const head = s.pr ? (folder.head ?? s.head) : s.head
  const counts = new Map<string, { path: string; hunks: number; lines: number }>()
  for (const h of hunksOf(files)) {
    if (h.noise) continue
    const c = counts.get(h.path) ?? { path: h.path, hunks: 0, lines: 0 }
    counts.set(h.path, { ...c, hunks: c.hunks + 1, lines: c.lines + h.additions + h.deletions })
  }
  const dir = runDir(s)
  await window.api.factory.prepare(dir)
  const file = `${dir}/walkthrough-${now().toString(36)}.json`
  const h = await helper(s, folder.path, agentId, walkthroughPrompt(subjectOf(t), [...counts.values()], file), `Walkthrough: ${s.title}`)
  inflight.add(h.id)
  patchReview(t, (r) => ({ ...r, walk: { file, mission: h.id, agent: agentId, status: 'writing', at: now(), diff: diffSignature(files), ...(head ? { head } : {}) } }))
  try {
    const end = await missionEnd(h.id, WALK_MS)
    await finishWalk(t, end === 'timeout' ? 'It took longer than 15 minutes' : undefined)
  } finally {
    inflight.delete(h.id)
  }
}

async function finishWalk(t: ReviewTarget, why?: string): Promise<void> {
  const walk = getReviewSource(t)?.review.walk
  if (!walk) return
  const ok = parseWalkthrough((await window.api.factory.read(walk.file)) ?? '')
  const agent = getAgent(walk.agent).name
  patchReview(t, (r) => ({ ...r, walk: { ...walk, status: ok ? 'ready' : 'failed', note: ok ? undefined : why ?? `${agent} didn't write a walkthrough` } }))
}

/** The walkthrough's JSON, read from its file (null while it's being written or when there is none). */
export async function readWalkthrough(t: ReviewTarget): Promise<Walkthrough | null> {
  const walk = getReviewSource(t)?.review.walk
  if (!walk || walk.status !== 'ready') return null
  return parseWalkthrough((await window.api.factory.read(walk.file)) ?? '')
}

/** A walkthrough or question whose agent finished while the app was closed (or restarted): read what it left. */
export async function settleReview(t: ReviewTarget): Promise<void> {
  const r = getReviewSource(t)?.review
  if (!r) return
  const done = (mid: string): boolean => !inflight.has(mid) && !isLive(getMission(mid)?.status ?? 'ended')
  if (r.walk?.status === 'writing' && done(r.walk.mission)) await finishWalk(t, 'The app closed before it finished')
  for (const a of r.asks ?? []) if (a.a === undefined && !a.failed && done(a.mission)) await finishAsk(t, a.id)
}

/**
 * A verdict on one part, kept with the hunks it was given on (so it lasts only while they don't change), and
 * the whole diff as the reviewer saw it then (what "Since last review" compares against). `head` is the
 * commit the change was at.
 */
export function markPart(t: ReviewTarget, part: Pick<Part, 'id' | 'hunks'>, mark: { ok?: boolean; note?: string } | null, all: Hunk[], head?: string): void {
  patchReview(t, (r) => {
    const marks = { ...r.marks }
    if (!mark) {
      delete marks[part.id]
      return { ...r, marks }
    }
    marks[part.id] = markOn(part, mark, head)
    return { ...r, marks, seen: nextSeen(r.seen, part, all, head) }
  })
}

/** Ask an agent about one part; the answer shows under the part. */
export async function askAboutPart(t: ReviewTarget, p: Part, question: string, agentId: string): Promise<void> {
  const s = getReviewSource(t)
  if (!s || !question.trim()) return
  const folder = await helperFolder(t, s)
  const dir = runDir(s)
  await window.api.factory.prepare(dir)
  const askId = now().toString(36)
  const file = `${dir}/ask-${askId}.md`
  const h = await helper(s, folder.path, agentId, askPrompt(subjectOf(t), p, question, file), `Ask: ${question}`)
  inflight.add(h.id)
  patchReview(t, (r) => ({ ...r, asks: [...(r.asks ?? []), { id: askId, part: p.id, q: question.trim(), file, mission: h.id, agent: agentId, at: now() }] }))
  try {
    await missionEnd(h.id, ASK_MS)
    await finishAsk(t, askId)
  } finally {
    inflight.delete(h.id)
  }
}

async function finishAsk(t: ReviewTarget, askId: string): Promise<void> {
  const a = getReviewSource(t)?.review.asks?.find((x) => x.id === askId)
  if (!a) return
  const text = ((await window.api.factory.read(a.file)) ?? '').trim()
  patchReview(t, (r) => ({ ...r, asks: (r.asks ?? []).map((x) => (x.id === askId ? { ...x, a: text ? text.slice(0, 4000) : undefined, failed: !text } : x)) }))
}

/** The parts marked to change go back to the agent that did the work, as one follow-up (only a mission has one). */
export async function sendBack(t: ReviewTarget, items: Array<{ part: Part; note: string }>): Promise<Mission | undefined> {
  const m = getReviewSource(t)?.mission
  if (!items.length || !m) return undefined
  const next = await followUpMission(m.id, sendBackText(items))
  if (next) patchReview(t, (r) => ({ ...r, sent: { at: now(), mission: next.id, parts: items.length } }))
  return next
}

// ── a pull request's review on GitHub ─────────────────────────────────

/** The Post review dialog: which Review tab (by source key) it is open for, and with which event first. */
export const postingReview = createStore<{ key: string | null; event: ReviewEvent }>({ key: null, event: 'COMMENT' })
export const openPostReview = (key: string, event: ReviewEvent): void => postingReview.set({ key, event })
export const closePostReview = (): void => postingReview.set({ key: null })

/** What the notes on the parts make, as the cockpit shows them now (the walkthrough's parts, or the folders). */
export async function draftReview(t: ReviewTarget, files: DiffFile[]): Promise<{ comments: DraftComment[]; summary: string[] }> {
  const s = source(t)
  const walk = await readWalkthrough(t).catch(() => null)
  return reviewDraft(buildCockpit(files, walk, s.criteria).parts, s.review.marks)
}

/** One review on GitHub, on the commit that was reviewed, only from the dialog's click. */
export async function postReview(t: ReviewTarget, event: ReviewEvent, text: string, loose: string[], comments: DraftComment[]): Promise<string> {
  const s = source(t)
  if (!s.pr) throw new Error('Only a pull request can get a review on GitHub')
  const payload = reviewPayload(event, reviewSummary(text, loose), comments, s.head)
  if ('error' in payload) throw new Error(payload.error)
  return window.api.gh.postReview(s.pr.root, s.pr.number, payload)
}
