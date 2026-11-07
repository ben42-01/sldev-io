import { stageMode } from '@shared/agents'
import { parseDiff, type DiffFile } from '@shared/diff'
import { askPrompt, criteriaOf, hunksOf, parseWalkthrough, sendBackText, walkthroughPrompt, type Part, type ReviewSubject, type Walkthrough } from '@shared/review'
import type { Mission, ReviewState } from '@shared/types'
import { getAgent } from './agents'
import { missionEnd, quietly } from './evals'
import { followUpMission, getMission, isLive, missionBase, startMission, update } from './missions'
import { workspace } from './workspace'

/**
 * The review cockpit's side effects: a print-mode agent writes the walkthrough (or answers a question
 * about one part) to a file under .sldev/runs of the project, and the reviewer's marks live on the
 * mission. The helpers carry `explains`, so they stay off the boards and don't notify; like a judge,
 * they get the unattended mode (nobody is there to approve) and are told to touch nothing else.
 */

const WALK_MS = 15 * 60_000
const ASK_MS = 8 * 60_000
/** helper missions this window is waiting on; one left over from before a restart is read once when the review opens */
const inflight = new Set<string>()

const now = (): number => Date.now()

function patchReview(id: string, f: (r: ReviewState) => ReviewState): void {
  const m = getMission(id)
  if (m) update(id, { review: f(m.review ?? {}) })
}

/** What the diff looked like: a walkthrough of an older diff says so. */
export const diffSignature = (files: DiffFile[]): string => {
  const h = hunksOf(files)
  return `${h.length}:${h.reduce((a, x) => a + x.additions + x.deletions, 0)}`
}

export function subject(m: Mission): ReviewSubject {
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

async function helper(m: Mission, agentId: string, prompt: string, title: string): Promise<Mission> {
  const agent = getAgent(agentId)
  return quietly(() =>
    startMission({
      prompt,
      title: title.slice(0, 60),
      root: m.root,
      cwd: m.cwd,
      // it writes one file, so not the read-only mode (that can't write at all); the prompt says not to touch anything else
      options: { agent: agent.id, print: true, permissionMode: stageMode(agent, workspace.get().factoryModes) },
      worktree: false,
      kind: { id: 'walkthrough', name: 'Walkthrough', readOnly: true },
      explains: { mission: m.id }
    })
  )
}

const runDir = (m: Mission): string => `${m.root}/.sldev/runs/review-${m.id}`

/** An agent explains the mission's change part by part; resolves when the walkthrough is in (or failed). */
export async function explainChanges(id: string, agentId: string): Promise<void> {
  const m = getMission(id)
  if (!m) throw new Error('That mission is gone')
  const files = parseDiff(await window.api.git.diff(m.cwd, missionBase(m)))
  if (!files.length) throw new Error('There are no changes to explain yet')
  const counts = new Map<string, { path: string; hunks: number; lines: number }>()
  for (const h of hunksOf(files)) {
    if (h.noise) continue
    const c = counts.get(h.path) ?? { path: h.path, hunks: 0, lines: 0 }
    counts.set(h.path, { ...c, hunks: c.hunks + 1, lines: c.lines + h.additions + h.deletions })
  }
  const dir = runDir(m)
  await window.api.factory.prepare(dir)
  const file = `${dir}/walkthrough-${now().toString(36)}.json`
  const h = await helper(m, agentId, walkthroughPrompt(subject(m), [...counts.values()], file), `Walkthrough: ${m.title}`)
  inflight.add(h.id)
  patchReview(id, (r) => ({ ...r, walk: { file, mission: h.id, agent: agentId, status: 'writing', at: now(), diff: diffSignature(files) } }))
  try {
    const end = await missionEnd(h.id, WALK_MS)
    await finishWalk(id, end === 'timeout' ? 'It took longer than 15 minutes' : undefined)
  } finally {
    inflight.delete(h.id)
  }
}

async function finishWalk(id: string, why?: string): Promise<void> {
  const walk = getMission(id)?.review?.walk
  if (!walk) return
  const ok = parseWalkthrough((await window.api.factory.read(walk.file)) ?? '')
  const agent = getAgent(walk.agent).name
  patchReview(id, (r) => ({ ...r, walk: { ...walk, status: ok ? 'ready' : 'failed', note: ok ? undefined : why ?? `${agent} didn't write a walkthrough` } }))
}

/** The walkthrough's JSON, read from its file (null while it's being written or when there is none). */
export async function readWalkthrough(id: string): Promise<Walkthrough | null> {
  const walk = getMission(id)?.review?.walk
  if (!walk || walk.status !== 'ready') return null
  return parseWalkthrough((await window.api.factory.read(walk.file)) ?? '')
}

/** A walkthrough or question whose agent finished while the app was closed (or restarted): read what it left. */
export async function settleReview(id: string): Promise<void> {
  const r = getMission(id)?.review
  if (!r) return
  const done = (mid: string): boolean => !inflight.has(mid) && !isLive(getMission(mid)?.status ?? 'ended')
  if (r.walk?.status === 'writing' && done(r.walk.mission)) await finishWalk(id, 'The app closed before it finished')
  for (const a of r.asks ?? []) if (a.a === undefined && !a.failed && done(a.mission)) await finishAsk(id, a.id)
}

export function markPart(id: string, part: string, mark: { ok?: boolean; note?: string } | null): void {
  patchReview(id, (r) => {
    const marks = { ...r.marks }
    if (mark) marks[part] = mark
    else delete marks[part]
    return { ...r, marks }
  })
}

/** Ask an agent about one part; the answer shows under the part. */
export async function askAboutPart(id: string, p: Part, question: string, agentId: string): Promise<void> {
  const m = getMission(id)
  if (!m || !question.trim()) return
  const dir = runDir(m)
  await window.api.factory.prepare(dir)
  const askId = now().toString(36)
  const file = `${dir}/ask-${askId}.md`
  const h = await helper(m, agentId, askPrompt(subject(m), p, question, file), `Ask: ${question}`)
  inflight.add(h.id)
  patchReview(id, (r) => ({ ...r, asks: [...(r.asks ?? []), { id: askId, part: p.id, q: question.trim(), file, mission: h.id, agent: agentId, at: now() }] }))
  try {
    await missionEnd(h.id, ASK_MS)
    await finishAsk(id, askId)
  } finally {
    inflight.delete(h.id)
  }
}

async function finishAsk(id: string, askId: string): Promise<void> {
  const a = getMission(id)?.review?.asks?.find((x) => x.id === askId)
  if (!a) return
  const text = ((await window.api.factory.read(a.file)) ?? '').trim()
  patchReview(id, (r) => ({ ...r, asks: (r.asks ?? []).map((x) => (x.id === askId ? { ...x, a: text ? text.slice(0, 4000) : undefined, failed: !text } : x)) }))
}

/** The parts marked to change go back to the agent that did the work, as one follow-up. */
export async function sendBack(id: string, items: Array<{ part: Part; note: string }>): Promise<Mission | undefined> {
  if (!items.length) return undefined
  const next = await followUpMission(id, sendBackText(items))
  if (next) patchReview(id, (r) => ({ ...r, sent: { at: now(), mission: next.id, parts: items.length } }))
  return next
}
