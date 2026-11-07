import { PR_POLL_MS, defaultBoardSettings, followPr, followWork, issueCard, itemIntent, moveItem, nextKey, nextPickups, type BoardColumn, type BoardItem, type BoardSettings, type WorkState } from '@shared/board'
import type { FactoryRun } from '@shared/factory'
import type { GhIssue, Mission } from '@shared/types'
import { activatePanel, activePanelId } from '../dock/dockApi'
import { startAction } from './automations'
import { factory } from './factory'
import { missions } from './missions'
import { createStore, useStore } from './store'

/**
 * The work board's store and its pick-up loop. Cards follow the run or mission started for them
 * whenever missions or runs change; pick-up looks for Agent ready cards every few seconds while the
 * app is open. Nothing starts on its own right after launch beyond what the board asks for, and
 * nothing is pushed: a recipe's pr stage still waits for its click.
 */

export const board = createStore<{ items: BoardItem[]; settings: BoardSettings[] }>({ items: [], settings: [] })

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
  saveTimer = setTimeout(() => void window.api.store.set('board', board.get()), 300)
}

const TICK_MS = 10_000
let timer: ReturnType<typeof setInterval> | undefined
let unsub: Array<() => void> = []

// agents file follow-up work with sldev_board_add: always into Backlog, so they can't feed pick-up themselves
window.api.missions.onMcp((e) => {
  if (e.type !== 'board-add') return
  const m = missions.get().list.find((x) => x.id === e.mission)
  if (!m) return
  const dupe = board.get().items.some((i) => i.root === m.root && i.column !== 'done' && i.title.toLowerCase() === e.card.title.toLowerCase())
  if (!dupe) addItem(m.root, { ...e.card, column: 'backlog' })
})

export async function loadBoard(): Promise<void> {
  const data = (await window.api.store.get('board')) ?? { items: [], settings: [] }
  board.set({ items: data.items ?? [], settings: data.settings ?? [] })
  for (const u of unsub) u()
  unsub = [missions.subscribe(scheduleSync), factory.subscribe(scheduleSync)]
  clearInterval(timer)
  timer = setInterval(() => void tick(), TICK_MS)
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

export function addItem(root: string, fields: Pick<BoardItem, 'title' | 'body' | 'labels' | 'priority' | 'column'> & Partial<Pick<BoardItem, 'work' | 'issue'>>): BoardItem {
  const t = now()
  const item: BoardItem = { id: newId(), root, key: nextKey(board.get().items, root), createdAt: t, updatedAt: t, order: t, ...fields }
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
  setItems((items) => items.filter((i) => i.id !== id))
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
    await checkPrs()
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
 * Cards waiting in Review or In progress whose run opened a pull request: ask GitHub (through gh)
 * at most every few minutes whether it was merged. Merged moves the card to Done.
 */
async function checkPrs(): Promise<void> {
  const t = now()
  for (const i of board.get().items) {
    if ((i.column !== 'review' && i.column !== 'progress') || i.started?.type !== 'run') continue
    const pr = factory.get().runs.find((r) => r.id === i.started!.id)?.pr
    if (!pr || t - (prChecked.get(i.id) ?? 0) < PR_POLL_MS) continue
    prChecked.set(i.id, t)
    const state = await window.api.gh.prState(i.root, pr.number).catch(() => null)
    const cur = getItem(i.id)
    const next = state && cur ? followPr(cur, { number: pr.number, state }, now()) : null
    if (next) setItems((items) => items.map((x) => (x.id === i.id ? next : x)))
  }
}

/** "Check pull requests now": forget when they were last asked about and ask again. */
export function refreshPrs(): void {
  prChecked.clear()
  scheduleTick()
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
    const started = await startAction(i.root, work, { intent: (text) => [text.trim(), itemIntent(i)].filter(Boolean).join('\n\n'), title: `#${i.key} ${i.title}`, issue: i.issue?.number })
    if ('error' in started) updateItem(id, { column: 'backlog', started: undefined, state: undefined, note: started.error })
    else updateItem(id, { started: { type: started.type, id: started.id, at: now() }, note: undefined })
  } catch (e) {
    updateItem(id, { column: 'backlog', started: undefined, state: undefined, note: (e as Error).message.split('\n')[0] })
  } finally {
    starting.delete(id)
    if (front === 'mission-board') activatePanel(front)
  }
  scheduleSync()
}
