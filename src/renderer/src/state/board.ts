import { PR_POLL_MS, approveItem, baseMovedCleared, flagBaseMoved, sameBase, type BranchFacts, boardFileText, cardBrief, prDescription, defaultBoardSettings, followPr, followWork, issueCard, itemIntent, mergeBoardFile, moveItem, nextKey, nextPickups, parseBoardFile, parseLessons, parseStories, resolveAfter, retroPrompt, storiesPrompt, type BoardColumn, type BoardItem, type BoardSettings, type Spent, type StoryJob, type WorkState } from '@shared/board'
import type { FactoryRun } from '@shared/factory'
import type { GhIssue, Mission } from '@shared/types'
import { NO_TOKENS, addTokens, timeIn, tokenTotal, type TokenUsage } from '@shared/usage'
import { activatePanel, activePanelId } from '../dock/dockApi'
import { startAction } from './automations'
import { factory } from './factory'
import { missions, startMission } from './missions'
import { getAgent } from './agents'
import { workspace } from './workspace'
import { createStore, useStore } from './store'

/**
 * The work board's store and its pick-up loop. Cards follow the run or mission started for them
 * whenever missions or runs change; pick-up looks for Agent ready cards every few seconds while the
 * app is open. Nothing starts on its own right after launch beyond what the board asks for, and
 * nothing is pushed: a recipe's pr stage still waits for its click.
 */

export const board = createStore<{ items: BoardItem[]; settings: BoardSettings[]; jobs: StoryJob[]; syncError: Record<string, string> }>({ items: [], settings: [], jobs: [], syncError: {} })

export const useBoardItems = (root: string | null): BoardItem[] => {
  const items = useStore(board, (s) => s.items)
  return root ? items.filter((i) => i.root === root) : []
}
export const useBoardSettings = (root: string | null): BoardSettings => {
  const s = useStore(board, (b) => b.settings.find((x) => x.root === root))
  return s ?? defaultBoardSettings(root ?? '')
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { items, settings, jobs } = board.get()
    void window.api.store.set('board', { items, settings, jobs })
    for (const s of settings) if (s.sync) void flushFile(s.root)
  }, 300)
}

const TICK_MS = 10_000
let timer: ReturnType<typeof setInterval> | undefined
let unsub: Array<() => void> = []

// agents file stories and follow-up work with sldev_board_add: always into Proposed, so a person approves
// them before pick-up sees them (agents can't feed pick-up themselves)
window.api.missions.onMcp((e) => {
  if (e.type !== 'board-add' && e.type !== 'board-update') return
  const m = missions.get().list.find((x) => x.id === e.mission)
  if (!m) return
  const by = m.options.agent ?? 'claude'
  bumpJob(m.id)
  if (e.type === 'board-update') {
    const target = board.get().items.find((i) => i.root === m.root && i.key === e.key)
    if (!target || (target.column !== 'backlog' && target.column !== 'proposed')) return
    const { after, ...card } = e.card
    updateItem(target.id, { ...card, by, refining: undefined, note: undefined, ...(after ? { blockedBy: resolveAfter(after, board.get().items, m.root).filter((k) => k !== target.key) } : {}) })
    if (target.column !== 'proposed') moveTo(target.id, 'proposed')
    return
  }
  const { after, ...card } = e.card
  if (!onBoard(m.root, card.title)) addItem(m.root, { ...card, column: 'proposed', by, blockedBy: resolveAfter(after, board.get().items, m.root) })
})

/** a card with this title is already open on the board (agents re-file what they find) */
const onBoard = (root: string, title: string): boolean => board.get().items.some((i) => i.root === root && i.column !== 'done' && i.title.toLowerCase() === title.toLowerCase())

export async function loadBoard(): Promise<void> {
  const data = (await window.api.store.get('board')) ?? { items: [], settings: [] }
  board.set({ items: data.items ?? [], settings: data.settings ?? [], jobs: data.jobs ?? [], syncError: {} })
  for (const s of board.get().settings) if (s.sync) void flushFile(s.root)
  for (const u of unsub) u()
  unsub = [missions.subscribe(scheduleSync), factory.subscribe(scheduleSync)]
  clearInterval(timer)
  timer = setInterval(() => void tick(), TICK_MS)
  window.removeEventListener('focus', onFocus)
  window.addEventListener('focus', onFocus)
  // like automations: give runs and missions a moment to load before anything is picked up
  setTimeout(() => void tick(), 4000)
}

const now = (): number => Date.now()
const newId = (): string => `b-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

function setItems(f: (items: BoardItem[]) => BoardItem[]): void {
  board.set((s) => ({ ...s, items: f(s.items) }))
  persist()
}

export function getItem(id: string): BoardItem | undefined {
  return board.get().items.find((i) => i.id === id)
}

export function addItem(root: string, fields: Pick<BoardItem, 'title' | 'body' | 'labels' | 'priority' | 'column'> & Partial<Pick<BoardItem, 'work' | 'issue' | 'by' | 'blockedBy'>>): BoardItem {
  const t = now()
  const { blockedBy, ...rest } = fields
  const item: BoardItem = { id: newId(), root, key: nextKey(board.get().items, root), createdAt: t, updatedAt: t, order: t, ...rest, ...(blockedBy?.length ? { blockedBy } : {}) }
  setItems((items) => [...items, item])
  scheduleTick()
  return item
}

/** Cards from GitHub issues, into one column; issues already on the board are skipped by the dialog. */
export function importIssues(root: string, issues: GhIssue[], column: BoardColumn): void {
  for (const x of issues) addItem(root, { ...issueCard(x), column })
}

export function updateItem(id: string, patch: Partial<BoardItem>): void {
  setItems((items) => items.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: now() } : i)))
}

/** Ask first (removeBoardItemFlow); a run or mission it started stays. */
export function removeItem(id: string): void {
  const i = getItem(id)
  setItems((items) => items.filter((x) => x.id !== id))
  // a shared board remembers the deletion, so a teammate's older copy doesn't bring the card back
  const s = i && board.get().settings.find((x) => x.root === i.root)
  if (s?.sync) saveBoardSettings({ ...s, removed: [...(s.removed ?? []), id].slice(-300) })
}

/** Drops a card into a column, above `before` or at the bottom. */
export function moveTo(id: string, column: BoardColumn, before?: string): void {
  const items = board.get().items
  const target = before ? items.find((i) => i.id === before) : undefined
  // just above the card it was dropped on; at the bottom otherwise
  const order = target ? target.order - 0.5 : Math.max(0, ...items.filter((i) => i.column === column).map((i) => i.order)) + 1
  setItems((list) => list.map((i) => (i.id === id ? moveItem(i, column, now(), order) : i)))
  if (column === 'ready') scheduleTick()
}

/** Proposed → Agent ready: the person read the story and lets the agents have it. */
export function approve(ids: string[]): void {
  const t = now()
  const top = Math.max(0, ...board.get().items.filter((i) => i.column === 'ready').map((i) => i.order))
  setItems((items) => items.map((i) => (ids.includes(i.id) && i.column === 'proposed' ? approveItem(i, t, top + 1 + ids.indexOf(i.id)) : i)))
  scheduleTick()
}

// ── story writing ────────────────────────────────────────────────────

function setJobs(f: (jobs: StoryJob[]) => StoryJob[]): void {
  board.set((s) => ({ ...s, jobs: f(s.jobs).slice(0, 40) }))
  persist()
}

function bumpJob(mission: string): void {
  if (board.get().jobs.some((j) => j.mission === mission)) setJobs((jobs) => jobs.map((j) => (j.mission === mission ? { ...j, filed: j.filed + 1 } : j)))
}

export const useStoryJobs = (root: string | null): StoryJob[] => {
  const jobs = useStore(board, (s) => s.jobs)
  return root ? jobs.filter((j) => j.root === root) : []
}

/**
 * Starts a read-only mission that turns a feature (or one card) into well-defined stories. With the
 * sldev tools the agent files them itself; otherwise its reply's ```stories block is read when it ends.
 * Either way they land in Proposed.
 */
export async function writeStories(root: string, o: { feature: string; agent?: string; max: number; card?: string }): Promise<string> {
  const agent = getAgent(o.agent || workspace.get().defaultAgent)
  const tools = workspace.get().agentTools !== false && !!agent.mcpArgs
  const card = o.card ? getItem(o.card) : undefined
  // without the sldev tools the stories come back as a file in the git-ignored run folder
  const dir = `${root}/.sldev/runs/stories-${now().toString(36)}`
  const file = tools ? undefined : `${dir}/stories.json`
  if (file) await window.api.factory.prepare(dir)
  const prompt = storiesPrompt({ feature: o.feature, tools, max: o.max, refine: card, file })
  const title = card ? `Refine #${card.key} ${card.title}` : `Stories: ${o.feature.trim().split('\n')[0]}`
  const m = await startMission({
    prompt,
    brief: card ? itemIntent(card) : o.feature,
    title: title.slice(0, 60),
    root,
    // read-only where the agent has such a mode, unless it has to write its stories file
    options: { agent: agent.id, permissionMode: tools ? agent.readOnlyMode : undefined },
    worktree: false,
    kind: { id: 'stories', name: card ? 'Refine' : 'Stories', readOnly: true }
  })
  setJobs((jobs) => [{ mission: m.id, root, feature: card ? `#${card.key} ${card.title}` : o.feature.trim(), card: card?.id, filed: 0, file, at: now() }, ...jobs])
  if (card) updateItem(card.id, { refining: m.id })
  return m.id
}

const jobBusy = new Set<string>()

/**
 * A story job whose agent stopped: stories it didn't file through the tools come from its file, or
 * from its reply's ```stories block. A refinement replaces its card with the first one. A job is
 * finished once, so nothing is added twice; a terminal agent that pauses before writing its file is
 * checked again the next time it stops.
 */
function followJobs(): void {
  for (const j of board.get().jobs) {
    if (j.done || jobBusy.has(j.mission)) continue
    const m = missions.get().list.find((x) => x.id === j.mission)
    const ended = !m || m.status === 'ended' || m.status === 'failed'
    const stopped = ended || m.status === 'waiting'
    if (!stopped) continue
    if (j.filed) {
      if (ended || m.report) finishJob(j)
      continue
    }
    jobBusy.add(j.mission)
    void (async () => {
      try {
        const text = j.file ? await window.api.factory.read(j.file) : m?.reportFrom !== 'terminal' ? (m?.report ?? null) : null
        const stories = text ? parseStories(text) : []
        if (stories.length) addStories(j, stories, m?.options.agent ?? 'claude')
        if (stories.length || ended || (!j.file && m?.report)) finishJob(j)
      } finally {
        jobBusy.delete(j.mission)
      }
    })()
  }
}

function finishJob(j: StoryJob): void {
  setJobs((jobs) => jobs.map((x) => (x.mission === j.mission ? { ...x, done: true } : x)))
  const card = j.card ? getItem(j.card) : undefined
  if (card?.refining === j.mission) updateItem(card.id, { refining: undefined })
}

function addStories(j: StoryJob, stories: ReturnType<typeof parseStories>, by: string): void {
  const card = j.card ? getItem(j.card) : undefined
  const ids: Array<string | undefined> = []
  stories.forEach((st, n) => {
    const fields = { title: st.title, body: st.details, labels: st.labels, priority: st.priority, by }
    if (n === 0 && card && (card.column === 'backlog' || card.column === 'proposed')) {
      updateItem(card.id, { ...fields, refining: undefined })
      if (card.column !== 'proposed') moveTo(card.id, 'proposed')
      ids.push(card.id)
    } else ids.push(onBoard(j.root, st.title) ? undefined : addItem(j.root, { ...fields, column: 'proposed' }).id)
  })
  // a story may wait for one later in the list: resolve `after` once they are all on the board
  stories.forEach((st, n) => {
    const id = ids[n]
    const me = id && getItem(id)
    if (me && st.after?.length) updateItem(me.id, { blockedBy: resolveAfter(st.after, board.get().items, j.root).filter((k) => k !== me.key) })
  })
  setJobs((jobs) => jobs.map((x) => (x.mission === j.mission ? { ...x, filed: stories.length } : x)))
}

export function saveBoardSettings(s: BoardSettings): void {
  board.set((b) => ({ ...b, settings: [...b.settings.filter((x) => x.root !== s.root), s] }))
  persist()
  scheduleTick()
}

// ── following the work ───────────────────────────────────────────────

function runState(r: FactoryRun): WorkState {
  if (r.status === 'done') return 'finished'
  if (r.status === 'failed' || r.status === 'stopped') return 'failed'
  // paused after a restart, or a stage (the pr stage too) waiting for its click
  if (r.status === 'paused' || Object.values(r.nodes).some((n) => n.status === 'approval')) return 'needs-you'
  return 'working'
}

function missionState(m: Mission): WorkState {
  if (m.status === 'failed') return 'failed'
  if (m.status === 'needs-input' || (m.limited && !m.continuedBy)) return 'needs-you'
  if (m.status === 'working' || m.status === 'starting') return 'working'
  return 'finished'
}

/** The state of an item's work, or null when that run or mission is gone (removed from the list). */
export function workOf(i: BoardItem): { state: WorkState; run?: FactoryRun; mission?: Mission } | null {
  if (!i.started) return null
  if (i.started.type === 'run') {
    const run = factory.get().runs.find((r) => r.id === i.started!.id)
    return run ? { state: runState(run), run } : null
  }
  const mission = missions.get().list.find((m) => m.id === i.started!.id)
  return mission ? { state: missionState(mission), mission } : null
}

let syncQueued = false
function scheduleSync(): void {
  if (syncQueued) return
  syncQueued = true
  queueMicrotask(() => {
    syncQueued = false
    sync()
  })
}

function sync(): void {
  followJobs()
  followRetros()
  const t = now()
  let changed = false
  const items = board.get().items.map((i) => {
    // an item being started has no run yet: leave it be
    if (!i.started || starting.has(i.id)) return i
    const w = workOf(i)
    if (!w) {
      // its run or mission was removed: the card keeps its place, the slot frees up
      if (i.state === 'finished' || i.state === 'failed') return i
      changed = true
      return { ...i, started: undefined, state: undefined, note: 'Its run or mission was removed', updatedAt: t }
    }
    const next = followWork(i, w.state, t)
    if (!next) return i
    changed = true
    if ((next.state === 'finished' || next.state === 'failed') && next.state !== i.state) void measure(i.id)
    return next
  })
  if (changed) {
    board.set((s) => ({ ...s, items }))
    persist()
  }
}

// ── pick-up ──────────────────────────────────────────────────────────

/** items whose run is being created, so a tick or a click doesn't start them twice */
const starting = new Set<string>()

let tickQueued: ReturnType<typeof setTimeout> | undefined
function scheduleTick(): void {
  clearTimeout(tickQueued)
  tickQueued = setTimeout(() => void tick(), 300)
}

let ticking = false
async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    sync()
    syncBoardFiles()
    await checkPrs()
    await checkBaseMoved()
    for (const s of board.get().settings) {
      for (const i of nextPickups(board.get().items, s)) if (!starting.has(i.id)) await startItem(i.id)
    }
  } finally {
    ticking = false
  }
}

/** when each card's pull request was last asked about (not saved: a restart asks again) */
const prChecked = new Map<string, number>()

/**
 * Cards waiting in Review or In progress whose work opened a pull request: ask GitHub (through gh)
 * at most every few minutes whether it was merged. Merged moves the card to Done. A factory run
 * records its PR; a mission doesn't, so its PR is found by the worktree branch it was pushed from.
 */
async function checkPrs(): Promise<void> {
  const t = now()
  for (const i of board.get().items) {
    if ((i.column !== 'review' && i.column !== 'progress') || !i.started?.id) continue
    if (t - (prChecked.get(i.id) ?? 0) < PR_POLL_MS) continue
    const w = workOf(i)
    const number = w?.run?.pr?.number
    const branch = w?.mission?.worktree?.branch
    if (!number && !branch) continue
    prChecked.set(i.id, t)
    const pr = number
      ? await window.api.gh.prState(i.root, number).then((state) => (state ? { number, state } : null), () => null)
      : await window.api.gh.prForBranch(i.root, branch!).catch(() => null)
    const cur = getItem(i.id)
    const next = pr && cur ? followPr(cur, pr, now()) : null
    if (next) setItems((items) => items.map((x) => (x.id === i.id ? next : x)))
    if (next?.column === 'done') await flagOthers(i.id)
  }
}

// ── the base moved: a merged PR flags the cards still in Review ──────────

/** Where a card's work is: its run's or mission's worktree and the base it branched from (null when it ran in place). */
function branchOf(i: BoardItem): { cwd: string; base: string } | null {
  const w = workOf(i)
  const wt = w?.run?.worktree ?? w?.mission?.worktree
  return wt?.path && wt.base ? { cwd: wt.path, base: wt.base } : null
}

/**
 * A card's PR merged: the other cards in Review on the same base get the re-check badge, told which files they share
 * with it. Only local git is read (the worktrees); nothing is merged, run or pushed, and the shared file doesn't change.
 */
async function flagOthers(id: string): Promise<void> {
  const merged = getItem(id)
  const at = merged && branchOf(merged)
  if (!merged || !at) return
  const mergedFacts: BranchFacts = { base: at.base, files: await window.api.git.changedFiles(at.cwd, at.base).catch(() => null) }
  const facts: Record<string, BranchFacts> = {}
  for (const i of board.get().items) {
    if (i.id === id || i.root !== merged.root || i.column !== 'review') continue
    const b = branchOf(i)
    if (!b || !sameBase(b.base, at.base)) continue
    const [files, head] = await Promise.all([window.api.git.changedFiles(b.cwd, b.base).catch(() => null), window.api.git.head(b.cwd).catch(() => null)])
    facts[i.id] = { base: b.base, files, head }
  }
  if (Object.keys(facts).length) setItems((items) => flagBaseMoved(items, merged, mergedFacts, facts, now()))
}

/** when each flagged card's branch was last looked at (not saved: a restart looks again) */
const movedChecked = new Map<string, number>()
const MOVED_CHECK_MS = 20_000

/** A flagged card's badge goes once its branch moved on (Update and check merged the base) and is no longer behind it. */
async function checkBaseMoved(): Promise<void> {
  const t = now()
  for (const i of board.get().items) {
    if (!i.baseMoved || i.column !== 'review') continue
    if (t - (movedChecked.get(i.id) ?? 0) < MOVED_CHECK_MS) continue
    movedChecked.set(i.id, t)
    const b = branchOf(i)
    if (!b) continue
    const head = await window.api.git.head(b.cwd).catch(() => null)
    // the branch hasn't changed since it was flagged: still to re-check, no need to ask git more
    if (!head || head === i.baseMoved.head) continue
    const moved = await window.api.git.baseMoved(b.cwd, b.base).catch(() => null)
    const cur = getItem(i.id)
    if (moved && cur?.baseMoved && baseMovedCleared(cur.baseMoved, head, moved.behind)) setItems((items) => items.map((x) => (x.id === i.id ? { ...x, baseMoved: undefined } : x)))
  }
}

/** "Check pull requests now": forget when they were last asked about and ask again. */
export function refreshPrs(): void {
  prChecked.clear()
  movedChecked.clear()
  scheduleTick()
}

/** Coming back to the app (after merging on GitHub, most likely) asks again, at most every 30 s. */
let focusChecked = 0
function onFocus(): void {
  if (now() - focusChecked < 30_000) return
  focusChecked = now()
  refreshPrs()
}

/** Starts an item's work now: its own recipe or mission, or the board's. Behind pick-up and the Start button. */
export async function startItem(id: string): Promise<void> {
  const i = getItem(id)
  if (!i || starting.has(id)) return
  const s = board.get().settings.find((x) => x.root === i.root) ?? defaultBoardSettings(i.root)
  const work = i.work ?? s.work
  starting.add(id)
  // started from the board, the board stays in front: the new terminal or pipeline waits as a tab
  const front = activePanelId()
  // In progress right away, so the card doesn't sit in Agent ready while the worktree is made
  updateItem(id, { column: 'progress', order: now(), state: 'working', note: undefined, started: { type: work.type === 'recipe' ? 'run' : 'mission', id: '', at: now() } })
  // an item that can't start goes back to Backlog with the reason, or pick-up would retry it every tick
  try {
    // cards build on each other: start from the upstream when an earlier card's PR merged there and the local branch is behind
    const branch = await window.api.git.branch(i.root).catch(() => null)
    const base = branch ? await window.api.git.freshBase(i.root, branch).catch(() => branch) : undefined
    const started = await startAction(i.root, work, { intent: (text) => cardBrief(i, text), title: `#${i.key} ${i.title}`, issue: i.issue?.number, base })
    if ('error' in started) updateItem(id, { column: 'backlog', started: undefined, state: undefined, note: started.error })
    else updateItem(id, { started: { type: started.type, id: started.id, at: now() }, note: undefined })
  } catch (e) {
    updateItem(id, { column: 'backlog', started: undefined, state: undefined, note: (e as Error).message.split('\n')[0] })
  } finally {
    starting.delete(id)
    if (front === 'board' || front === 'mission-board') activatePanel(front)
  }
  scheduleSync()
}

// ── what a card's work took ──────────────────────────────────────────

/** Every mission that worked on a card: a run's stages, or the mission with its failovers, follow-ups and a Lead's workers. */
export function missionsOf(i: BoardItem): Mission[] {
  if (!i.started?.id) return []
  const all = missions.get().list
  if (i.started.type === 'run') return all.filter((m) => m.factory?.run === i.started!.id)
  const out = new Map<string, Mission>()
  const stack = [i.started.id]
  while (stack.length) {
    const id = stack.pop()!
    const m = all.find((x) => x.id === id)
    if (!m || out.has(id)) continue
    out.set(id, m)
    if (m.continuedBy) stack.push(m.continuedBy)
    for (const x of all) if ((x.parent?.id === id && x.parent.kind !== 'second-opinion') || x.delegate?.lead === id) stack.push(x.id)
  }
  return [...out.values()]
}

/** Wall time, agent time and, for agents whose logs say, tokens and cost, saved on the card when its work finishes. */
async function measure(id: string): Promise<void> {
  const i = getItem(id)
  if (!i?.started) return
  const t = now()
  const list = missionsOf(i)
  const end = Math.max(i.started.at, ...list.map((m) => m.updatedAt))
  const spent: Spent = { ms: Math.max(0, end - i.started.at), agentMs: timeIn(list, 'working', i.started.at, t, t), missions: list.length }
  const reqs = list
    .filter((m) => m.options.agent === 'codex' || (m.options.agent ?? 'claude') === 'claude')
    .map((m) => ({ id: m.id, agent: m.options.agent ?? 'claude', cwd: m.cwd, from: m.createdAt, to: m.updatedAt, transcriptPath: m.transcriptPath }))
  if (reqs.length) {
    const usage = await window.api.usage.tokens(reqs).catch((): Record<string, TokenUsage | null> => ({}))
    const sum = Object.values(usage).reduce<TokenUsage>((a, u) => (u ? addTokens(a, u) : a), NO_TOKENS)
    if (tokenTotal(sum)) Object.assign(spent, { tokens: tokenTotal(sum), cost: sum.cost || undefined })
  }
  // only what it took is saved, not a change to the card: its place in the file stays as it was
  setItems((items) => items.map((x) => (x.id === id ? { ...x, spent } : x)))
}

// ── retros: lessons from a card's work, into the project memory ──────

/**
 * A read-only mission looks back at how a card's work went (sent back, failed over, the review notes, the
 * diff) and saves at most three lessons to .sldev/memory.md, which every later mission reads. Agents with the
 * sldev tools save them with sldev_remember; others write them to a file the app adds.
 */
export async function startRetro(id: string): Promise<string> {
  const i = getItem(id)
  if (!i) throw new Error('That card is gone')
  const list = missionsOf(i).sort((a, b) => a.createdAt - b.createdAt)
  const first = list[0]
  const run = i.started?.type === 'run' ? factory.get().runs.find((r) => r.id === i.started!.id) : undefined
  const story: string[] = []
  if (run) story.push(`Ran as the ${run.recipe.name} recipe (${Object.keys(run.nodes).length} stages), ${run.status}${run.pr ? `, pull request #${run.pr.number}` : ''}.`)
  for (const m of list) {
    const agent = getAgent(m.options.agent).name
    const what = m.delegate ? `worker of the Lead` : m.parent?.kind === 'follow-up' ? 'sent back with a follow-up' : m.parent?.kind === 'failover' ? 'took over at a usage limit' : m.factory ? `stage ${m.factory.node}` : (m.kind?.name ?? 'Build')
    story.push(`${agent}, ${what}: "${m.title}", ${m.status === 'failed' ? 'FAILED' : m.status}${m.limited ? ', hit its usage limit' : ''}${m.handoff ? `. Review notes: ${m.handoff.trim().slice(0, 600)}` : ''}${m.report && m.reportFrom !== 'terminal' ? `. Its report: ${m.report.trim().slice(0, 500)}` : ''}`)
  }
  if (i.note) story.push(`On the card: ${i.note}`)
  const agent = getAgent(workspace.get().defaultAgent)
  const tools = workspace.get().agentTools !== false && !!agent.mcpArgs
  const dir = `${i.root}/.sldev/runs/retro-${now().toString(36)}`
  const file = tools ? undefined : `${dir}/lessons.json`
  if (file) await window.api.factory.prepare(dir)
  const cwd = first?.cwd && (await window.api.fs.isDir(first.cwd).catch(() => false)) ? first.cwd : i.root
  const base = first?.worktree?.base ?? first?.baseCommit
  const before = (await window.api.memory.info(i.root).catch(() => null))?.entries ?? 0
  // like story writing, the board stays in front; the retro's progress shows on its card
  const front = activePanelId()
  const m = await startMission({
    prompt: retroPrompt({ card: i, story, base: cwd !== i.root || first?.baseCommit ? base : undefined, tools, file }),
    brief: `Retro of #${i.key} ${i.title}`,
    title: `Retro #${i.key} ${i.title}`.slice(0, 60),
    root: i.root,
    cwd,
    options: { agent: agent.id, permissionMode: tools ? agent.readOnlyMode : undefined },
    worktree: false,
    kind: { id: 'retro', name: 'Retro', readOnly: true }
  }).finally(() => front && activatePanel(front))
  retroWatch.set(m.id, { card: i.id, file, before })
  updateItem(i.id, { retro: { mission: m.id } })
  return m.id
}

/** retros in flight: the lessons file, and how many memory entries there were before (tools add their own) */
const retroWatch = new Map<string, { card: string; file?: string; before: number }>()

function followRetros(): void {
  // a retro the app was closed during: it is over once its mission is, lessons unknown
  for (const i of board.get().items) {
    if (!i.retro || i.retro.done || retroWatch.has(i.retro.mission)) continue
    const m = missions.get().list.find((x) => x.id === i.retro!.mission)
    if (!m || m.status === 'ended' || m.status === 'failed') setItems((items) => items.map((x) => (x.id === i.id ? { ...x, retro: { ...x.retro!, done: true } } : x)))
  }
  for (const [mission, w] of retroWatch) {
    const m = missions.get().list.find((x) => x.id === mission)
    const ended = !m || m.status === 'ended' || m.status === 'failed'
    if (!ended && !(m.status === 'waiting' && (m.report || w.file))) continue
    retroWatch.delete(mission)
    void (async () => {
      const card = getItem(w.card)
      if (!card) return
      if (w.file) {
        const lessons = parseLessons((await window.api.factory.read(w.file)) ?? '')
        if (!lessons.length && !ended) return void retroWatch.set(mission, w)
        for (const l of lessons) await window.api.memory.remember(card.root, l.note, `retro of card #${card.key}`, l.paths).catch(() => undefined)
        setItems((items) => items.map((x) => (x.id === card.id ? { ...x, retro: { mission, done: true, lessons: lessons.length } } : x)))
      } else {
        const after = (await window.api.memory.info(card.root).catch(() => null))?.entries ?? w.before
        setItems((items) => items.map((x) => (x.id === card.id ? { ...x, retro: { mission, done: true, lessons: Math.max(0, after - w.before) } } : x)))
      }
    })()
  }
}

// ── release notes ────────────────────────────────────────────────────

/** The cards went out in a release: the next notes start after them. */
export function markReleased(ids: string[], version: string): void {
  setItems((items) => items.map((i) => (ids.includes(i.id) ? { ...i, released: version, updatedAt: now() } : i)))
}

// ── the board in git ─────────────────────────────────────────────────

/** what this window last wrote to (or read from) each project's file, to tell a teammate's change from its own */
const lastFile = new Map<string, string>()
const flushing = new Map<string, Promise<void>>()

/** Turning sharing on reads what's there first, so a teammate's board is merged, never overwritten. */
export function setBoardSync(root: string, on: boolean): void {
  const s = board.get().settings.find((x) => x.root === root) ?? defaultBoardSettings(root)
  saveBoardSettings({ ...s, sync: on })
  if (!on) board.set((b) => ({ ...b, syncError: { ...b.syncError, [root]: '' } }))
}

/** "Read the shared board now" and the window's focus: pick up a git pull. */
export function syncBoardFiles(): void {
  for (const s of board.get().settings) if (s.sync) void flushFile(s.root)
}
window.addEventListener('focus', syncBoardFiles)

/**
 * Brings `.sldev/board.json` and this board together: a file changed since we last saw it (a git pull, a
 * teammate) is merged in first, then the merged board is written back when it differs. Conflict markers
 * stop both, with the reason on the board, until they are resolved.
 */
function flushFile(root: string): Promise<void> {
  const prev = flushing.get(root) ?? Promise.resolve()
  const next = prev.then(async () => {
    const s = board.get().settings.find((x) => x.root === root)
    if (!s?.sync) return
    const disk = await window.api.board.readFile(root)
    if (disk !== null && disk !== lastFile.get(root)) {
      const parsed = parseBoardFile(disk)
      if (parsed.error) return void board.set((b) => ({ ...b, syncError: { ...b.syncError, [root]: parsed.error! } }))
      const merged = mergeBoardFile(board.get().items, root, parsed.file!, s.removed)
      if (merged.changed) {
        board.set((b) => ({ ...b, items: merged.items }))
        const { items, settings, jobs } = board.get()
        void window.api.store.set('board', { items, settings, jobs })
        scheduleTick()
      }
    }
    const text = boardFileText(board.get().items, root, s.removed)
    if (text !== disk) await window.api.board.writeFile(root, text)
    lastFile.set(root, text)
    if (board.get().syncError[root]) board.set((b) => ({ ...b, syncError: { ...b.syncError, [root]: '' } }))
  })
  const done = next.catch((e: Error) => board.set((b) => ({ ...b, syncError: { ...b.syncError, [root]: e.message.split('\n')[0] } })))
  flushing.set(root, done)
  return done
}

// ── a pull request description from a card ───────────────────────────

/** The card as a PR description: its story, the agent's report and the diff, ready to paste. */
export async function prDescriptionOf(id: string): Promise<string> {
  const i = getItem(id)
  if (!i) return ''
  const list = missionsOf(i).sort((a, b) => a.createdAt - b.createdAt)
  // the last word: a Lead's own report, or the last stage or follow-up that reported
  const lead = list.find((m) => m.id === i.started?.id)
  const reporter = (lead?.kind?.id === 'lead' ? lead : undefined) ?? [...list].reverse().find((m) => m.report && m.reportFrom !== 'terminal' && !m.delegate)
  const first = list[0]
  const base = first?.worktree?.base ?? first?.baseCommit
  const cwd = (lead ?? first)?.cwd
  const stat = cwd && base ? await window.api.git.diffStat(cwd, base).catch(() => undefined) : undefined
  const agents = [...new Set(list.filter((m) => !m.eval).map((m) => getAgent(m.options.agent).name))].join(', ')
  return prDescription(i, { report: reporter?.report, agent: agents || undefined, diff: stat && stat.files ? stat : undefined })
}
